import type { DBObj, UseStore } from "./types";

export function createStore(dbName: string, storeName: string): UseStore {
  const request = indexedDB.open(dbName);
  request.onupgradeneeded = () => request.result.createObjectStore(storeName);
  const dbp = promisifyRequest(request);
  return (txMode, callback) =>
    dbp.then((db) =>
      callback(db.transaction(storeName, txMode).objectStore(storeName)),
    );
}

export function eachCursor(
  store: IDBObjectStore,
  callback: (cursor: IDBCursorWithValue) => void,
): Promise<void> {
  store.openCursor().onsuccess = function () {
    if (!this.result) return;
    callback(this.result);
    this.result.continue();
  };
  return promisifyRequest(store.transaction);
}

export function promisifyRequest<T = undefined>(
  request: IDBRequest<T> | IDBTransaction,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    // @ts-expect-error - file size hacks
    request.oncomplete = request.onsuccess = () => resolve(request.result);
    // @ts-expect-error - file size hacks
    request.onabort = request.onerror = () => reject(request.error);
  });
}

export const allSettled = (
  promises: Promise<DBObj>[],
): Promise<
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
> => {
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
};

export const arrayBufferToBlob = (buffer: ArrayBuffer, mimeType: string) => {
  return new Blob([buffer], { type: mimeType });
};

export const blobToArrayBuffer = (blob: Blob) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("loadend", () => {
      resolve(reader.result);
    });
    reader.addEventListener("error", reject);
    reader.readAsArrayBuffer(blob);
  });
};

// Applies a Blob (if given), or the original obj.src URL to the given element.
export const applyElement = (obj: DBObj, blob?: Blob) => {
  if (!blob) return;
  let url = obj.src;
  if (blob) {
    url = window.URL.createObjectURL(blob);
  }
  switch (obj.el.tagName) {
    case "IMG":
      (obj.el as HTMLImageElement).src = url;
      break;
    case "LINK":
      (obj.el as HTMLLinkElement).href = url;
  }
  obj.el.dataset.indexed = "true";
};
