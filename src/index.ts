import type { CacheableEl, DBObj, IndexedCacheOpts, UseStore } from "./types";
import "url-search-params-polyfill";
import {
  allSettled,
  applyElement,
  createStore,
  eachCursor,
  promisifyRequest,
} from "./utils";

export default class IndexedCache {
  #customStore: UseStore;
  #opt: IndexedCacheOpts;
  constructor(options: Partial<IndexedCacheOpts>) {
    this.#opt = {
      tags: ["img", "link"],
      dbName: "indexed-cache",
      storeName: "objects",
      // If this is enabled, all objects in the cache with keys not
      // found on elements on the page (data-key) will be deleted by load().
      // This can be problematic in scenarios where there are multiple
      // pages on the same domain that have different assets, some on
      // certain pages and some on other.
      prune: false,
      // Enabling this skips IndexedDB caching entirely,
      // causing resources to be fetched over HTTP every time.
      // Useful in dev environments.
      skip: false,
      // Default expiry for an object in minutes (default 3 months).
      // Set to null for no expiry.
      expiry: 131400,
      ...options,
    };
    this.#customStore = createStore(this.#opt.dbName, this.#opt.storeName);
  }

  // Initialize the DB and then scan and setup DOM elements to cache.
  async load(elements?: CacheableEl[]) {
    // This will setup the elements on the page irrespective of whether
    // the DB is available or not.
    const objs = await this.#setupElements(elements);
    if (!objs?.length) {
      return;
    }

    // If pruning is enabled, delete all cached elements that are no longer
    // referenced on the page.
    if (this.#opt.prune) {
      // Pass the list of keys found on the page.
      const keys = objs.map((obj) => obj.key);
      await this.prune(keys);
    }
  }

  deleteKey(key: IDBValidKey): Promise<void> {
    return this.#customStore("readwrite", (store) => {
      store.delete(key);
      return promisifyRequest(store.transaction);
    });
  }

  // Prune all objects in the DB that are not in the given list of keys.
  async prune(keys: string[]) {
    // Prepare a { key: true } lookup map of all keys found on the page.
    const keyMap = keys.reduce(
      (obj, v) => {
        obj[v] = true;
        return obj;
      },
      {} as Record<string, boolean>,
    );
    const validKeys = await this.#keys();
    await this.#delMany(validKeys.filter((k) => !keyMap[String(k)]));
  }

  clear(): Promise<void> {
    return this.#customStore("readwrite", (store) => {
      store.clear();
      return promisifyRequest(store.transaction);
    });
  }

  // Scan all matching elements and either:
  // a) if indexedDB is not available, fallback to loading the assets natively.
  // b) if DB is available but the object is not cached, fetch(), cache in the DB, and apply the blob.
  // c) if DB is available and the object is cached, apply the cached blob.
  // elements should either be null or be a NodeList.
  async #setupElements(elements?: NodeList | Node[]) {
    const objs: DBObj[] = [];

    // If there are no elements, scan the entire DOM for groups of each tag type.
    if (elements instanceof NodeList) {
      elements = Array.from(elements);
    } else if (elements instanceof Node) {
      elements = [elements];
    } else {
      const sel = this.#opt.tags
        .map((t) => `${t}[data-src]:not([data-indexed])`)
        .join(",");
      elements = document.querySelectorAll(sel);
    }

    // Get all tags of a particular tag on the page that has the data-src attrib.
    // document.querySelectorAll(`${tag}[data-src]:not([data-indexed])`).forEach((el) => {
    Array.prototype.forEach.call(elements, (el) => {
      if ("indexed" in el.dataset) {
        return;
      }
      const obj: DBObj = {
        el: el,
        key: el.dataset.key || el.dataset.src,
        src: el.dataset.src,
        hash: el.dataset.hash || el.dataset.src,
        isAsync:
          el.hasAttribute("async") ||
          el.hasAttribute("defer") ||
          el.hasAttribute("lazy"),
        expiry: null,
        data: {},
      };

      // If there is a global expiry or an expiry on the object, compute that.
      const exp = el.dataset.expiry || this.#opt.expiry;
      if (exp) {
        obj.expiry = new Date(new Date().getTime() + parseInt(exp) * 60000);
      }

      objs.push(obj);
    });

    const promises: Promise<DBObj>[] = [];
    objs.forEach((obj) => {
      if (obj.isAsync) {
        // Load and apply async objects asynchronously.
        this.#getObject(obj)
          .then((result) => {
            applyElement(obj, result.data.blob);
          })
          .catch(() => {
            applyElement(obj);
          });
      } else {
        // Load non-async objects asynchronously (but apply synchronously).
        promises.push(this.#getObject(obj));
      }
    });

    if (promises.length === 0) {
      return objs;
    }

    // Load all elements successively.
    await allSettled(promises).then((results) => {
      // Promise returns [{value: { obj, data }} ...].
      // Transform to [{ ...obj, data: data} ...]
      const out = results.reduce((arr, r) => {
        if (!r.value) return arr;
        arr.push(r.value);
        return arr;
      }, [] as DBObj[]);
      this.#applyElements(out);
    });

    return objs;
  }

  // Get the object from the DB and if that fails, fetch() it over HTTP
  // This function should not reject a promise and in the case of failure,
  // will return a dummy data object as if it were fetched from the DB.
  #getObject(obj: DBObj): Promise<DBObj> {
    return new Promise((resolve) => {
      // Get the stored blob.
      this.#getDBblob(obj)
        .then((data) => {
          resolve({ ...obj, data });
        })
        .catch((e) => {
          // If there is no cause, the object is not cached or has expired.
          if (e.toString() !== "Error") {
            console.log("error getting cache blob:", e);
          }

          // Couldn't get the stored blog. Attempt to fetch() and cache.
          this.#fetchObject(obj)
            .then((data) => {
              resolve({ ...obj, data });
            })
            .catch(() => {
              // Everything failed. Failover to loading assets natively.
              resolve({
                ...obj,
                data: {
                  key: obj.key,
                  hash: obj.hash,
                  expiry: obj.expiry,
                  blob: undefined,
                },
              });
            });
        });
    });
  }

  #get<T = never>(key: IDBValidKey): Promise<T | undefined> {
    return this.#customStore("readonly", (store) =>
      promisifyRequest(store.get(key)),
    );
  }

  // Get the blob of an asset stored in the DB. If there is no entry or it has expired
  // (hash changed or date expired), fetch the asset over HTTP, cache it, and load it.
  async #getDBblob(obj: DBObj): Promise<DBObj["data"]> {
    const data = await this.#get<DBObj["data"]>(obj.key);

    if (!data?.key) {
      throw new Error("");
    }

    // Reject if there is no stored data, or if the hash has changed.
    if (!data || (obj.hash && data.hash !== obj.hash)) {
      throw new Error("");
    }

    // Reject and delete if the object has expired.
    if (data.expiry && new Date() > new Date(data.expiry)) {
      this.deleteKey(data.key);
      throw new Error("");
    }

    return data;
  }

  // Fetch an asset and cache it.
  async #fetchObject(obj: DBObj): Promise<DBObj["data"]> {
    const r = await fetch(obj.src);
    // HTTP request failed.
    if (!r.ok) {
      throw new Error(`error fetching asset: ${r.status}`);
    }
    // Write the fetched blob to the DB.
    const data = {
      key: obj.key,
      hash: obj.hash,
      expiry: obj.expiry,
      blob: await r.blob(),
    };
    await this.#set<DBObj["data"]>(obj.key, data);

    return data;
  }

  #set<T>(key: IDBValidKey, value: T): Promise<void> {
    return this.#customStore("readwrite", (store) => {
      store.put(value, key);
      return promisifyRequest(store.transaction);
    });
  }

  // Apply the Blob (if given), or the original obj.src URL to the given list of elements
  // by chaining each successive element to the previous one's onload so that they load
  // in order.
  #applyElements(objs: DBObj[]) {
    objs.forEach((obj, n) => {
      if (n >= objs.length - 1) {
        return;
      }

      obj.el.onload = obj.el.onerror = () => {
        applyElement(objs[n + 1], objs[n + 1].data.blob);
      };
    });

    // Start the chain by loading the first element.
    applyElement(objs[0], objs[0].data.blob);
  }

  #delMany(keys: IDBValidKey[]): Promise<void> {
    return this.#customStore("readwrite", (store: IDBObjectStore) => {
      keys.forEach((key: IDBValidKey) => store.delete(key));
      return promisifyRequest(store.transaction);
    });
  }

  #keys<KeyType extends IDBValidKey>(): Promise<KeyType[]> {
    return this.#customStore("readonly", (store) => {
      // Fast path for modern browsers
      if (store.getAllKeys) {
        return promisifyRequest(
          store.getAllKeys() as unknown as IDBRequest<KeyType[]>,
        );
      }
      const items: KeyType[] = [];
      return eachCursor(store, (cursor) =>
        items.push(cursor.key as KeyType),
      ).then(() => items);
    });
  }
}
