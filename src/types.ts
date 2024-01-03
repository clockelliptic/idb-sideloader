export type UseStore = <T>(
  txMode: IDBTransactionMode,
  callback: (store: IDBObjectStore) => T | PromiseLike<T>,
) => Promise<T>;
export interface IndexedCacheOpts {
  tags: string[];
  dbName: string;
  storeName: string;
  prune: boolean;
  skip: boolean;
  expiry: number;
}
export type CacheableEl = HTMLImageElement | HTMLLinkElement;
export type DBObj = {
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
