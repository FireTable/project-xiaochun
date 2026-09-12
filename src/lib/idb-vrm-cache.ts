/**
 * idb-vrm-cache.ts — IndexedDB 缓存 .vrmaddon / .vrmbase + 合成后的 GLB
 *
 * 两层缓存:
 *   1. raw (.vrmaddon / .vrmbase 原始 zip 字节) — 省网络下载
 *      idbGet / idbPut(url, sha)
 *
 *   2. composed (worker compose 产出的 GLB ArrayBuffer) — 省 unzip + bspatch + packGLB
 *      idbGetComposed / idbPutComposed(addonUrl, addonSha, baseUrl, baseSha)
 *
 * 两层都用 sha 进 key:build 后产物变了 → 自动 invalidate,不需手动清理。
 * 失败降级到无缓存路径,绝不能阻塞 swap。
 *
 * ponytail: 不引 idb / dexie 这类库 — 浏览器原生 indexedDB API 已够用,
 * 整个模块 ~80 行,加 dep 反而增加 bundle 体积和概念负担。
 */
const DB_NAME = 'vrm-assets-cache';
const DB_VERSION = 2;
const RAW_STORE = 'entries';
const COMPOSED_STORE = 'composed';

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase | null>((resolve) => {
    if (typeof indexedDB === 'undefined') {
      console.warn('[idb-vrm-cache] indexedDB unavailable (SSR/private mode), cache disabled');
      resolve(null);
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(RAW_STORE)) {
        db.createObjectStore(RAW_STORE);
      }
      if (!db.objectStoreNames.contains(COMPOSED_STORE)) {
        db.createObjectStore(COMPOSED_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      console.warn('[idb-vrm-cache] open failed:', req.error);
      resolve(null);
    };
    req.onblocked = () => {
      console.warn('[idb-vrm-cache] open blocked (另一 tab 持有旧 schema)');
      resolve(null);
    };
  });
  return dbPromise;
}

function rawKey(url: string, sha: string): string {
  return `${url}@sha=${sha}`;
}

function composedKey(addonUrl: string, addonSha: string, baseUrl: string, baseSha: string): string {
  // ponytail: 任一字段变 → key 变 → 自动 miss。addon 没传 sha 时退化成 'no-sha',
  // 避免跟有 sha 的 cache key 撞 (虽然概率极低)。
  return `${addonUrl}@sha=${addonSha || 'no-sha'}|${baseUrl}@sha=${baseSha || 'no-sha'}`;
}

export async function idbGet(url: string, sha: string): Promise<ArrayBuffer | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise<ArrayBuffer | null>((resolve) => {
    try {
      const tx = db.transaction(RAW_STORE, 'readonly');
      const req = tx.objectStore(RAW_STORE).get(rawKey(url, sha));
      req.onsuccess = () => resolve((req.result as ArrayBuffer | undefined) ?? null);
      req.onerror = () => {
        console.warn('[idb-vrm-cache] get failed:', req.error);
        resolve(null);
      };
    } catch (e) {
      console.warn('[idb-vrm-cache] get threw:', e);
      resolve(null);
    }
  });
}

export async function idbPut(url: string, sha: string, buf: ArrayBuffer): Promise<void> {
  const db = await openDb();
  if (!db) return;
  return new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(RAW_STORE, 'readwrite');
      tx.objectStore(RAW_STORE).put(buf, rawKey(url, sha));
      tx.oncomplete = () => resolve();
      tx.onerror = () => {
        console.warn('[idb-vrm-cache] put failed:', tx.error);
        resolve();
      };
    } catch (e) {
      console.warn('[idb-vrm-cache] put threw:', e);
      resolve();
    }
  });
}

/** ponytail: 第二层 cache — compose 后的 GLB。
 *  命中时 worker 直接 reply,跳过 unzip + bspatch + packGLB (50-300ms)。
 *  cache key 包含 addon + base 两个 URL+sha,任一变都自动 miss。 */
export async function idbGetComposed(
  addonUrl: string, addonSha: string, baseUrl: string, baseSha: string,
): Promise<ArrayBuffer | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise<ArrayBuffer | null>((resolve) => {
    try {
      const tx = db.transaction(COMPOSED_STORE, 'readonly');
      const req = tx.objectStore(COMPOSED_STORE).get(composedKey(addonUrl, addonSha, baseUrl, baseSha));
      req.onsuccess = () => resolve((req.result as ArrayBuffer | undefined) ?? null);
      req.onerror = () => {
        console.warn('[idb-vrm-cache] getComposed failed:', req.error);
        resolve(null);
      };
    } catch (e) {
      console.warn('[idb-vrm-cache] getComposed threw:', e);
      resolve(null);
    }
  });
}

export async function idbPutComposed(
  addonUrl: string, addonSha: string, baseUrl: string, baseSha: string, buf: ArrayBuffer,
): Promise<void> {
  const db = await openDb();
  if (!db) return;
  return new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(COMPOSED_STORE, 'readwrite');
      tx.objectStore(COMPOSED_STORE).put(buf, composedKey(addonUrl, addonSha, baseUrl, baseSha));
      tx.oncomplete = () => resolve();
      tx.onerror = () => {
        console.warn('[idb-vrm-cache] putComposed failed:', tx.error);
        resolve();
      };
    } catch (e) {
      console.warn('[idb-vrm-cache] putComposed threw:', e);
      resolve();
    }
  });
}

/** 清空整个 VRM cache(两层都清)。DeviceStatusDialog 的"释放"按钮调,失败也不抛。 */
export async function idbClearAll(): Promise<{ cleared: boolean; reason?: string }> {
  const db = await openDb();
  if (!db) return { cleared: false, reason: 'unavailable' };
  return new Promise((resolve) => {
    try {
      const tx = db.transaction([RAW_STORE, COMPOSED_STORE], 'readwrite');
      tx.objectStore(RAW_STORE).clear();
      tx.objectStore(COMPOSED_STORE).clear();
      tx.oncomplete = () => resolve({ cleared: true });
      tx.onerror = () => resolve({ cleared: false, reason: tx.error?.message ?? 'unknown' });
    } catch (e) {
      resolve({ cleared: false, reason: e instanceof Error ? e.message : String(e) });
    }
  });
}
