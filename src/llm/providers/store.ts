/**
 * providers/store.ts — 加密 + 持久化 provider profiles。
 *
 * ponytail: 每个 profile 一个 IndexedDB record,key 是 profile.id。apiKey 走 crypto.ts AES-GCM。
 * 不维护单独 active 字段 — 用 sessionStorage 缓存当前活跃 id,启动时回退到默认(第一个)。
 */

import type { ProviderProfile } from './types';
import { decryptString, encryptString } from './crypto';

const DB_NAME = 'xiaochun-providers';
const DB_STORE = 'profiles';
const DB_VER = 1;
const ACTIVE_KEY = 'xiaochun.provider.active';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function listEncrypted(): Promise<Array<ProviderProfile & { apiKey: string }>> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readonly');
    const req = tx.objectStore(DB_STORE).getAll();
    req.onsuccess = () => {
      db.close();
      resolve((req.result || []) as Array<ProviderProfile & { apiKey: string }>);
    };
    req.onerror = () => {
      db.close();
      reject(req.error);
    };
  });
}

function genId(): string {
  return `prov_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

export async function listProviders(): Promise<ProviderProfile[]> {
  const raw = await listEncrypted();
  // ponytail: apiKey 字段加密存储,UI 不需要明文(只有 active 用于发请求),list 只返密文
  // 字符串。解密推迟到 getActiveProvider 时。
  return raw.map((p) => ({ ...p, apiKey: '' }));
}

export async function getProvider(id: string): Promise<ProviderProfile | null> {
  const all = await listEncrypted();
  const found = all.find((p) => p.id === id);
  if (!found) return null;
  return found;
}

/** ponytail: 解密指定 id 的 apiKey,只用于"测试连接"等需要凭据但又不希望把 key 放 UI state 的场景。 */
export async function getDecryptedApiKey(id: string): Promise<string | null> {
  const p = await getProvider(id);
  if (!p) return null;
  try {
    return await decryptString(p.apiKey);
  } catch {
    return null;
  }
}

export async function getActiveProvider(): Promise<ProviderProfile | null> {
  if (typeof window === 'undefined') return null;
  let id: string | null = null;
  try {
    id = window.sessionStorage.getItem(ACTIVE_KEY);
  } catch { /* noop */ }
  if (!id) return null;
  const raw = await listEncrypted();
  const found = raw.find((p) => p.id === id);
  if (!found) return null;
  // ponytail: 解密 apiKey,发请求前才解,常态内存里不存明文。
  try {
    return { ...found, apiKey: await decryptString(found.apiKey) };
  } catch (err) {
    console.warn('[providers] decrypt failed:', err);
    return null;
  }
}

export async function getActiveProviderId(): Promise<string | null> {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage.getItem(ACTIVE_KEY);
  } catch {
    return null;
  }
}

export async function setActiveProviderId(id: string | null): Promise<void> {
  if (typeof window === 'undefined') return;
  try {
    if (id) window.sessionStorage.setItem(ACTIVE_KEY, id);
    else window.sessionStorage.removeItem(ACTIVE_KEY);
  } catch { /* noop */ }
}

export interface SaveInput {
  id?: string;
  name: string;
  protocol: 'openai-compatible';
  baseURL: string;
  apiKey: string;
  model: string;
  recentModels?: string[];
  lastProbeOk?: boolean;
  lastProbeAt?: number;
  availableModels?: string[];
}

export async function saveProvider(input: SaveInput): Promise<ProviderProfile> {
  const db = await openDb();
  const id = input.id ?? genId();
  const now = Date.now();
  const existing = input.id ? await getProvider(input.id) : null;
  const encryptedKey = await encryptString(input.apiKey);
  const profile: ProviderProfile & { apiKey: string } = {
    id,
    name: input.name.trim(),
    protocol: input.protocol,
    baseURL: input.baseURL.trim().replace(/\/+$/, ''),
    apiKey: encryptedKey,
    model: input.model.trim(),
    recentModels: dedupeModels([
      ...(input.recentModels ?? existing?.recentModels ?? []),
      input.model.trim(),
    ]),
    createdAt: existing?.createdAt ?? now,
    lastUsedAt: now,
    lastProbeOk: input.lastProbeOk ?? existing?.lastProbeOk,
    lastProbeAt: input.lastProbeAt ?? existing?.lastProbeAt,
    availableModels: input.availableModels ?? existing?.availableModels,
  };
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    const req = tx.objectStore(DB_STORE).put(profile, id);
    req.onsuccess = () => {
      db.close();
      resolve();
    };
    req.onerror = () => {
      db.close();
      reject(req.error);
    };
  });
  return { ...profile, apiKey: '' };
}

export async function deleteProvider(id: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    const req = tx.objectStore(DB_STORE).delete(id);
    req.onsuccess = () => {
      db.close();
      resolve();
    };
    req.onerror = () => {
      db.close();
      reject(req.error);
    };
  });
  if ((await getActiveProviderId()) === id) await setActiveProviderId(null);
}

function dedupeModels(list: string[]): string[] {
  return Array.from(new Set(list.filter(Boolean))).slice(0, 20);
}