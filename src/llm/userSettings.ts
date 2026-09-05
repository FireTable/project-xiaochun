/**
 * userSettings.ts — 用户在对话层面的偏好设置(系统提示词覆盖 + 记忆轮数覆盖)。
 *
 * ponytail: 单条 IDB 记录,key = 'main',整体读写。不加密 — 内容非敏感,
 * 加密只挡同源脚本偷看;用户改的 prompt / 轮数在 DevTools 里能看到也没关系。
 *
 * 默认值不在这里写 — system prompt 默认走 XIAOCHUN_SYSTEM_PROMPT[lang],
 * memory turns 默认走 deviceDetection.getDeviceMemoryTurns()。resolve 函数
 * 在读写时合并 override + 默认,UI 层只关心 override 字段。
 */

import type { Lang } from '@/i18n';
import { APP_CONFIG } from '@/config';
import { XIAOCHUN_SYSTEM_PROMPT } from './prompts';
import { getDeviceMemoryTurns } from './deviceDetection';

const DB_NAME = 'xiaochun-user-settings';
const DB_STORE = 'settings';
const DB_VER = 1;
const RECORD_KEY = 'main';

/** 单条 record 的 schema。undefined 字段等同"未设置",走默认。 */
export interface UserSettings {
  systemPromptOverride?: string;
  memoryTurnsOverride?: number;
}

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

/** ponytail: 读 main record,失败 / 不存在返空对象 — 调用方按空 override 走默认。 */
export async function getUserSettings(): Promise<UserSettings> {
  if (typeof indexedDB === 'undefined') return {};
  try {
    const db = await openDb();
    return await new Promise<UserSettings>((resolve) => {
      const tx = db.transaction(DB_STORE, 'readonly');
      const req = tx.objectStore(DB_STORE).get(RECORD_KEY);
      req.onsuccess = () => {
        db.close();
        resolve((req.result as UserSettings | undefined) ?? {});
      };
      req.onerror = () => {
        db.close();
        resolve({});
      };
    });
  } catch {
    return {};
  }
}

export async function saveUserSettings(next: UserSettings): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).put(next, RECORD_KEY);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

// ponytail: 内存缓存 + 订阅 — dialog 改完不用重 bind,vrmEngine 每次 getSystemContext
// 都走 getUserSettings() 拿最新值;但 UI(ChatBar 等)想立刻反映,可以用 subscribe
// 拉一次回调刷新自己的派生 state。
let cached: UserSettings | null = null;
const listeners = new Set<() => void>();

export function subscribeUserSettings(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function getCachedUserSettings(): UserSettings {
  return cached ?? {};
}

/** ponytail: 内部用 — 写入 IDB 后顺手刷缓存 + 通知订阅者,保证下次解析用新值。 */
async function persist(next: UserSettings): Promise<void> {
  cached = next;
  await saveUserSettings(next);
  listeners.forEach((cb) => cb());
}

export async function setSystemPromptOverride(text: string | null): Promise<void> {
  const trimmed = (text ?? '').trim();
  const next: UserSettings = { ...cached };
  if (trimmed) next.systemPromptOverride = trimmed;
  else delete next.systemPromptOverride;
  await persist(next);
}

export async function setMemoryTurnsOverride(n: number | null): Promise<void> {
  const next: UserSettings = { ...cached };
  if (typeof n === 'number' && n > 0 && Number.isFinite(n)) {
    const { userTurnsMin, userTurnsMax } = APP_CONFIG.memory;
    next.memoryTurnsOverride = Math.max(userTurnsMin, Math.min(userTurnsMax, Math.round(n)));
  } else {
    delete next.memoryTurnsOverride;
  }
  await persist(next);
}

/** ponytail: 系统提示词 — 有 override 用 override,否则按 lang 拿默认人设。 */
export function resolveSystemPrompt(settings: UserSettings, lang: Lang): string {
  const ov = settings.systemPromptOverride?.trim();
  if (ov) return ov;
  return XIAOCHUN_SYSTEM_PROMPT[lang] ?? XIAOCHUN_SYSTEM_PROMPT['zh-CN'];
}

/** ponytail: 记忆轮数 — 有 override 用 override,否则拿设备推荐值。 */
export function resolveMemoryTurns(settings: UserSettings): number {
  const ov = settings.memoryTurnsOverride;
  if (typeof ov === 'number' && ov > 0) return ov;
  return getDeviceMemoryTurns();
}

/** ponytail: 异步便利函数 — 一次 getUserSettings + 两次 resolve,给生成时单点调用。 */
export async function resolveEffectiveSettings(
  lang: Lang,
): Promise<{ systemPrompt: string; memoryTurns: number }> {
  const settings = cached ?? (await getUserSettings());
  cached = settings;
  return {
    systemPrompt: resolveSystemPrompt(settings, lang),
    memoryTurns: resolveMemoryTurns(settings),
  };
}