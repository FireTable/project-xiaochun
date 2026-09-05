/**
 * providers/crypto.ts — Web Crypto AES-GCM 加密 API key。
 *
 * ponytail: 加密密钥来自本地随机 salt + PBKDF2 派生的固定 session key,落 IndexedDB 时
 * 用随机 IV 拼 ciphertext。salt 第一次访问 IndexedDB 时生成并缓存,每次 install/clear
 * storage 才会重新生成(等同换锁)。这不是对抗性安全(本地浏览器可被调试器截获),
 * 只挡同源脚本随便读 storage。
 */

const ENC = new TextEncoder();
const DEC = new TextDecoder();

const DB_NAME = 'xiaochun-providers';
const DB_STORE_META = 'meta';
const DB_VER = 2;
const SALT_KEY = 'crypto.salt.v1';

async function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      // ponytail: store.ts 同一个 DB,只创建过 profiles;升级时补建 meta,
      // 防止 transaction 找不到 store 抛 NotFoundError。
      if (!db.objectStoreNames.contains(DB_STORE_META)) db.createObjectStore(DB_STORE_META);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getOrCreateSalt(): Promise<Uint8Array> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE_META, 'readwrite');
    const store = tx.objectStore(DB_STORE_META);
    const req = store.get(SALT_KEY);
    req.onsuccess = () => {
      if (req.result instanceof Uint8Array && req.result.length === 16) {
        db.close();
        resolve(req.result);
        return;
      }
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const putReq = store.put(salt, SALT_KEY);
      putReq.onsuccess = () => {
        db.close();
        resolve(salt);
      };
      putReq.onerror = () => {
        db.close();
        reject(putReq.error);
      };
    };
    req.onerror = () => {
      db.close();
      reject(req.error);
    };
  });
}

async function deriveKey(salt: Uint8Array): Promise<CryptoKey> {
  // ponytail: 固定 passphrase + 随机 salt + PBKDF2 → 256-bit AES-GCM key。
  // passphrase 是常量(同源策略),salt 保证每次 install 不同。
  const baseKey = await crypto.subtle.importKey(
    'raw',
    ENC.encode('xiaochun-static-salt-v1'),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' } as Pbkdf2Params,
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encryptString(plaintext: string): Promise<string> {
  const salt = await getOrCreateSalt();
  const key = await deriveKey(salt);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, ENC.encode(plaintext))
  );
  // ponytail: 把 salt + iv + ciphertext 拼成 base64,IV/salt 公开,key 在 IndexedDB,够用。
  const blob = new Uint8Array(salt.length + iv.length + ciphertext.length);
  blob.set(salt, 0);
  blob.set(iv, salt.length);
  blob.set(ciphertext, salt.length + iv.length);
  let binary = '';
  for (let i = 0; i < blob.length; i++) binary += String.fromCharCode(blob[i]);
  return btoa(binary);
}

export async function decryptString(payload: string): Promise<string> {
  const blob = Uint8Array.from(atob(payload), (c) => c.charCodeAt(0));
  if (blob.length < 28) throw new Error('payload too short');
  const salt = blob.slice(0, 16);
  const iv = blob.slice(16, 28);
  const ciphertext = blob.slice(28);
  const key = await deriveKey(salt);
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  return DEC.decode(plaintext);
}