/**
 * providers/store.ts — 加密 + 持久化 provider profiles（支持 LLM / STT / TTS 多模态）。
 *
 * ponytail: 每个 profile 一个 IndexedDB record，key 是 profile.id。apiKey 走 crypto.ts AES-GCM。
 * LLM「当前激活」走 ../activeModel 统一 key。
 * STT / TTS「当前激活」走 ../activeAudioModes。
 */

import type { ProviderProfile, ProviderType } from './types';
import { decryptString, encryptString } from './crypto';
import { readActiveModel, writeActiveModel } from '../activeModel';
import { unloadEngine } from '../webLLMProvider';

const DB_NAME = 'xiaochun-providers';
const DB_STORE = 'profiles';
const DB_VER = 2;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      // ponytail: 跟 crypto.ts 共享同一个 DB(v2)，升级时把两个 store 都建出来。
      if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE);
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
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

export async function listProviders(type?: ProviderType): Promise<ProviderProfile[]> {
  const raw = await listEncrypted();
  const filtered = type
    ? raw.filter((p) => (p.type ?? 'llm') === type)
    : raw;
  // ponytail: apiKey 字段加密存储，UI 不需要明文，list 只返密文空字符串。解密推迟到激活发请求时。
  return filtered.map((p) => ({ ...p, type: p.type ?? 'llm', apiKey: '' }));
}

/**
 * ponytail: 跟 listProviders 一样，但 apiKey 字段解出明文 — 只在设备间同步等导出场景使用。
 */
export async function listProvidersDecrypted(type?: ProviderType): Promise<ProviderProfile[]> {
  const raw = await listEncrypted();
  const filtered = type
    ? raw.filter((p) => (p.type ?? 'llm') === type)
    : raw;
  const out: ProviderProfile[] = [];
  for (const p of filtered) {
    let apiKey = '';
    try {
      apiKey = await decryptString(p.apiKey);
    } catch {
      /* decrypt failed — keep empty key */
    }
    out.push({ ...p, type: p.type ?? 'llm', apiKey });
  }
  return out;
}

export async function getProvider(id: string): Promise<ProviderProfile | null> {
  const all = await listEncrypted();
  const found = all.find((p) => p.id === id);
  if (!found) return null;
  return { ...found, type: found.type ?? 'llm' };
}

/** ponytail: 解密指定 id 的 apiKey，只用于"测试连接"等需要凭据但又不希望把 key 放 UI state 的场景。 */
export async function getDecryptedApiKey(id: string): Promise<string | null> {
  const p = await getProvider(id);
  if (!p) return null;
  try {
    return await decryptString(p.apiKey);
  } catch {
    return null;
  }
}

/** 获取并解密指定的 profile（供 LLM / STT / TTS 各执行器调用） */
export async function getProviderDecrypted(id: string): Promise<ProviderProfile | null> {
  const all = await listEncrypted();
  const found = all.find((p) => p.id === id);
  if (!found) return null;
  try {
    return { ...found, type: found.type ?? 'llm', apiKey: await decryptString(found.apiKey) };
  } catch (err) {
    console.warn('[providers] decrypt failed:', err);
    return null;
  }
}

export async function getActiveProvider(): Promise<ProviderProfile | null> {
  const active = readActiveModel();
  if (!active || active.kind !== 'custom') return null;
  return getProviderDecrypted(active.providerId);
}

export async function getActiveProviderId(): Promise<string | null> {
  const active = readActiveModel();
  return active?.kind === 'custom' ? active.providerId : null;
}

export async function setActiveProviderId(id: string | null): Promise<void> {
  const wasCustom = readActiveModel()?.kind === 'custom';
  writeActiveModel(id ? { kind: 'custom', providerId: id } : null);
  // ponytail: 切到 custom 时顺手把还在内存里的 webllm engine 释放掉
  if (id && !wasCustom) {
    try {
      unloadEngine();
    } catch { /* noop */ }
  }
  notifyProvidersChange();
}

// ponytail: providers 列表 / 激活态变化的订阅
const providersChangeListeners = new Set<() => void>();

export function subscribeProvidersChange(cb: () => void): () => void {
  providersChangeListeners.add(cb);
  return () => { providersChangeListeners.delete(cb); };
}

function notifyProvidersChange(): void {
  providersChangeListeners.forEach((cb) => {
    try { cb(); } catch { /* noop */ }
  });
}

export interface SaveInput {
  id?: string;
  type?: ProviderType;
  name: string;
  protocol: 'openai-compatible';
  baseURL: string;
  apiKey: string;
  model: string;
  voice?: string;
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
    type: input.type ?? existing?.type ?? 'llm',
    name: input.name.trim(),
    protocol: input.protocol,
    baseURL: input.baseURL.trim().replace(/\/+$/, ''),
    apiKey: encryptedKey,
    model: input.model.trim(),
    voice: input.voice?.trim() || undefined,
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
  notifyProvidersChange();
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
  notifyProvidersChange();
}

function dedupeModels(list: string[]): string[] {
  return Array.from(new Set(list.filter(Boolean))).slice(0, 20);
}
