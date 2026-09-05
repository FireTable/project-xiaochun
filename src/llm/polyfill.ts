/**
 * polyfill.ts — 针对移动端浏览器 / WebView / WebWorker 上下文的轻量垫片
 * 同时在主线程与 Dedicated Worker 最顶部执行，保证在所有重库加载前生效
 */

// 1. crypto.randomUUID 垫片 (旧版 Chrome / Android WebView / 受限 Worker)
if (typeof crypto !== 'undefined' && typeof crypto.randomUUID !== 'function') {
  (crypto as unknown as { randomUUID: () => string }).randomUUID = function randomUUID() {
    const r = (n: number) => Math.floor(Math.random() * n);
    const hex = (n: number, len: number) => n.toString(16).padStart(len, '0');
    return (
      hex(r(0xffffffff), 8) + '-' +
      hex(r(0xffff), 4) + '-' +
      '4' + hex(r(0xfff), 3) + '-' +
      hex(0x8 | r(0x4), 1) + hex(r(0xfff), 3) + '-' +
      hex(r(0xffffffff), 8) + hex(r(0xffff), 4)
    );
  };
}

// 2. CacheStorage shim (WebLLM 在非 HTTPS 或移动端 Worker 下 caches 可能是 undefined)
// 用 IndexedDB 实现一个兼容 Cache 接口的最小可用版本，防止 WebLLM 抛 ReferenceError: caches is not defined
const CACHE_DB_NAME = 'xiaochun-webllm-cache';
const CACHE_DB_STORE = 'responses';
const CACHE_DB_VERSION = 1;

const openCacheDB = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      return reject(new Error('IndexedDB not supported'));
    }
    const req = indexedDB.open(CACHE_DB_NAME, CACHE_DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(CACHE_DB_STORE)) db.createObjectStore(CACHE_DB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('cache DB open blocked'));
  });

const reqToPromise = <T,>(req: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

const makeIDBCache = (name: string): Cache => {
  let dbPromise: Promise<IDBDatabase> | null = null;
  const getDB = () => {
    if (!dbPromise) {
      dbPromise = openCacheDB().catch((e) => {
        dbPromise = null;
        throw e;
      });
    }
    return dbPromise;
  };
  const keyOf = (request: RequestInfo | URL) => name + '::' + String(request);
  return {
    match: async (request: RequestInfo | URL) => {
      try {
        const db = await getDB();
        const blob = await reqToPromise<Blob | undefined>(
          db.transaction(CACHE_DB_STORE, 'readonly').objectStore(CACHE_DB_STORE).get(keyOf(request)) as IDBRequest<Blob | undefined>
        );
        return blob ? new Response(blob) : undefined;
      } catch {
        return undefined;
      }
    },
    put: async (request: RequestInfo | URL, response: Response) => {
      try {
        const db = await getDB();
        const blob = await response.blob();
        await reqToPromise(
          db.transaction(CACHE_DB_STORE, 'readwrite').objectStore(CACHE_DB_STORE).put(blob, keyOf(request)) as IDBRequest
        );
      } catch {
        // 缓存写失败不阻塞
      }
    },
    delete: async (request: RequestInfo | URL) => {
      try {
        const db = await getDB();
        await reqToPromise(
          db.transaction(CACHE_DB_STORE, 'readwrite').objectStore(CACHE_DB_STORE).delete(keyOf(request)) as IDBRequest
        );
        return true;
      } catch {
        return false;
      }
    },
    keys: async () => [] as readonly Request[],
    add: async () => undefined,
    addAll: async () => undefined,
  } as unknown as Cache;
};

// 检查当前全局环境 (Window 或 DedicatedWorkerGlobalScope)
const g = typeof globalThis !== 'undefined' ? globalThis : self;

if (typeof g.caches === 'undefined') {
  try {
    (g as unknown as { caches: CacheStorage }).caches = {
      open: async (name: string) => makeIDBCache(name),
      match: async () => undefined,
      has: async () => false,
      delete: async () => true,
      keys: async () => [],
    } as unknown as CacheStorage;
  } catch (e) {
    console.warn('[Polyfill] Failed to shim caches:', e);
  }
}
