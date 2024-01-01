import "url-search-params-polyfill";

function allSettled(promises: Promise<DBObj>[]): Promise<
  (
    | {
        status: "fulfilled";
        value: DBObj;
      }
    | {
        status: "rejected";
        reason: Error | string;
        value?: undefined;
      }
  )[]
> {
  const wrappedPromises = promises.map((p) =>
    Promise.resolve(p).then(
      (val: DBObj) => ({ status: "fulfilled" as const, value: val }),
      (err: Error | string) => ({
        status: "rejected" as const,
        reason: err,
      }),
    ),
  );
  return Promise.all(wrappedPromises);
}

interface IndexedCacheOpts {
  tags: string[];
  dbName: string;
  storeName: string;
  prune: boolean;
  skip: boolean;
  expiry: number;
}
type CacheableEl = HTMLImageElement | HTMLScriptElement | HTMLLinkElement;
type DBObj = {
  el: CacheableEl;
  key: string;
  src: string;
  hash: string;
  isAsync: boolean;
  expiry: Date | null;
  data: {
    key?: string;
    blob?: Blob;
    hash?: string;
    expiry?: Date | null;
  };
};
export default class IndexedCache {
  opt: IndexedCacheOpts;
  db: null | IDBDatabase;
  constructor(options: Partial<IndexedCacheOpts>) {
    // if (_icLoaded) {
    //   throw new Error('indexed-cache is already loaded');
    // }
    // _icLoaded = true;

    this.opt = {
      tags: ["script", "img", "link"],
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
    this.db = null;
  }

  // This should be called before calling any other methods.
  async init() {
    if (this.db) {
      return;
    }
    if (this.opt.skip) {
      return;
    }
    await this._initDB(this.opt.dbName, this.opt.storeName)
      .then((db) => {
        this.db = db;
      })
      .catch((e) => {
        console.log("error initializing cache DB. failing over.", e);
      });
  }

  // Initialize the DB and then scan and setup DOM elements to cache.
  async load(elements?: CacheableEl[]) {
    // This will setup the elements on the page irrespective of whether
    // the DB is available or not.
    const objs = await this._setupElements(elements);

    if (!this.db || !objs?.length) {
      return;
    }

    // If pruning is enabled, delete all cached elements that are no longer
    // referenced on the page.
    if (this.opt.prune) {
      // Pass the list of keys found on the page.
      const keys = objs.map((obj) => obj.key);
      this._prune(keys);
    }
  }

  deleteKey(key: string) {
    if (!this.db) {
      return;
    }

    this._store()?.delete(key);
  }

  // Prune all objects in the DB that are not in the given list of keys.
  prune(keys: string[]) {
    this._prune(keys);
  }

  clear() {
    if (!this.db) {
      return;
    }

    this._store()?.clear();
  }

  // Initialize the indexedDB database and create the store.
  _initDB(dbName: string, storeName: string): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) {
        reject(new Error("indexedDB is not available"));
      }

      const req = window.indexedDB.open(dbName);

      // Setup the DB schema for the first time.
      req.onupgradeneeded = () => {
        const db = req.result;
        if (req.transaction && !db.objectStoreNames.contains(storeName)) {
          db.createObjectStore(storeName, { keyPath: "key" });
          req.transaction.oncomplete = () => {
            resolve(db);
          };
        }
      };

      req.onsuccess = () => resolve(req.result);

      req.onerror = () => reject(req.error);

      // Hacky fix for IndexedDB randomly locking up in Safari.
      setTimeout(() => {
        if (!this.db) {
          reject(new Error("Opening IndexedbDB timed out"));
        }
      }, 200);
    });
  }

  // Scan all matching elements and either:
  // a) if indexedDB is not available, fallback to loading the assets natively.
  // b) if DB is available but the object is not cached, fetch(), cache in the DB, and apply the blob.
  // c) if DB is available and the object is cached, apply the cached blob.
  // elements should either be null or be a NodeList.
  async _setupElements(elements?: NodeList | Node[]) {
    const objs: DBObj[] = [];

    // If there are no elements, scan the entire DOM for groups of each tag type.
    if (elements instanceof NodeList) {
      elements = Array.from(elements);
    } else if (elements instanceof Node) {
      elements = [elements];
    } else {
      const sel = this.opt.tags
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
          el.tagName !== "SCRIPT" ||
          el.hasAttribute("async") ||
          el.hasAttribute("defer"),
        expiry: null,
        data: {},
      };

      // If there is a global expiry or an expiry on the object, compute that.
      const exp = el.dataset.expiry || this.opt.expiry;
      if (exp) {
        obj.expiry = new Date(new Date().getTime() + parseInt(exp) * 60000);
      }

      objs.push(obj);
    });

    // If there's no IndexedDB, load all scripts synchronously.
    if (!this.db) {
      this._applyElements(objs);
      return;
    }

    const promises: Promise<DBObj>[] = [];
    objs.forEach((obj) => {
      if (obj.isAsync) {
        // Load and apply async objects asynchronously.
        this._getObject(obj)
          .then((result) => {
            this._applyElement(obj, result.data.blob);
          })
          .catch(() => {
            this._applyElement(obj);
          });
      } else {
        // Load non-async objects asynchronously (but apply synchronously).
        promises.push(this._getObject(obj));
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
      this._applyElements(out);
    });

    return objs;
  }

  // Get the object from the DB and if that fails, fetch() it over HTTP
  // This function should not reject a promise and in the case of failure,
  // will return a dummy data object as if it were fetched from the DB.
  _getObject(obj: DBObj): Promise<DBObj> {
    return new Promise((resolve) => {
      // Get the stored blob.
      this._getDBblob(obj)
        .then((data) => {
          resolve({ ...obj, data });
        })
        .catch((e) => {
          // If there is no cause, the object is not cached or has expired.
          if (e.toString() !== "Error") {
            console.log("error getting cache blob:", e);
          }

          // Couldn't get the stored blog. Attempt to fetch() and cache.
          this._fetchObject(obj)
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

  // Get the blob of an asset stored in the DB. If there is no entry or it has expired
  // (hash changed or date expired), fetch the asset over HTTP, cache it, and load it.
  _getDBblob(obj: DBObj): Promise<DBObj["data"]> {
    return new Promise((resolve, reject) => {
      try {
        const req = this._store()?.get(obj.key);
        if (!req) throw new Error(`DB Key Not Found: ${obj.key}`);
        req.onsuccess = () => {
          const data = req.result;

          // Reject if there is no stored data, or if the hash has changed.
          if (!data || (obj.hash && data.hash !== obj.hash)) {
            reject(new Error(""));
            return;
          }

          // Reject and delete if the object has expired.
          if (data.expiry && new Date() > new Date(data.expiry)) {
            this.deleteKey(data.key);
            reject(new Error(""));
            return;
          }

          resolve(data);
        };

        req.onerror = () => {
          reject(req.error);
        };
      } catch (e) {
        reject(e);
      }
    });
  }

  // Fetch an asset and cache it.
  _fetchObject(obj: DBObj): Promise<DBObj["data"]> {
    return new Promise((resolve, reject) => {
      fetch(obj.src)
        .then((r) => {
          // HTTP request failed.
          if (!r.ok) {
            reject(new Error(`error fetching asset: ${r.status}`));
            return;
          }

          // Write the fetched blob to the DB.
          r.blob().then((b) => {
            const data = {
              key: obj.key,
              hash: obj.hash,
              expiry: obj.expiry,
              blob: b,
            };

            // onerror() may not always trigger like in the private mode in Safari.
            try {
              const req = this._store()?.put(data);
              if (!req) throw new Error(`DB Key Not Found: ${obj.key}`);
              req.onsuccess = () => resolve(data);
              req.onerror = () => reject(req.error);
            } catch (e) {
              reject(e);
            }
          });
        })
        .catch((e) => reject(e));
    });
  }

  // Apply the Blob (if given), or the original obj.src URL to the given element.
  _applyElement(obj: DBObj, blob?: Blob) {
    if (!blob) return;
    let url = obj.src;
    if (blob) {
      url = window.URL.createObjectURL(blob);
    }

    switch (obj.el.tagName) {
      case "SCRIPT":
      case "IMG":
        (obj.el as HTMLImageElement).src = url;
        break;
      case "LINK":
        (obj.el as HTMLLinkElement).href = url;
    }
    obj.el.dataset.indexed = "true";
  }

  // Apply the Blob (if given), or the original obj.src URL to the given list of elements
  // by chaining each successive element to the previous one's onload so that they load
  // in order.
  _applyElements(objs: DBObj[]) {
    objs.forEach((obj, n) => {
      if (n >= objs.length - 1) {
        return;
      }

      obj.el.onload = obj.el.onerror = () => {
        this._applyElement(objs[n + 1], objs[n + 1].data.blob);
      };
    });

    // Start the chain by loading the first element.
    this._applyElement(objs[0], objs[0].data.blob);
  }

  // Delete all objects in cache that are not in the given list of objects.
  _prune(keys: string[]) {
    if (!this.db) {
      return;
    }

    // Prepare a { key: true } lookup map of all keys found on the page.
    const keyMap = keys.reduce(
      (obj, v) => {
        obj[v] = true;
        return obj;
      },
      {} as Record<string, boolean>,
    );

    const req = this._store()?.getAllKeys();
    if (!req) throw new Error(`req object does not exist`);
    req.onsuccess = () => {
      req.result.forEach((key) => {
        if (!((key as string) in keyMap)) {
          this.deleteKey(key as string);
        }
      });
    };
  }

  _store() {
    return this.db
      ?.transaction(this.opt.storeName, "readwrite")
      .objectStore(this.opt.storeName);
  }
}
