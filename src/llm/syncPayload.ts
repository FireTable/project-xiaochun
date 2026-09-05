/**
 * syncPayload.ts — 跨设备同步设置(纯前端)。
 *
 * ponytail: 一台设备 export → 加密 → QR + key → 另一台设备 import → 解密 → 预览 → 确认。
 * 不走任何服务器,API key 也只走加密通道(接收端需要密钥才能解密)。
 *
 * 设计:
 * - 加密用 Web Crypto AES-GCM-256,随机 12 字节 IV。
 * - 每条 sync 生成一个新密钥,发送端把密钥单独展示给用户(用户负责安全转移)。
 * - QR 只装密文 + IV(不含密钥,降低 QR 泄漏风险);文本格式才带密钥,方便远程 paste。
 *
 * 同步范围(selection-driven,用户勾选决定):
 * - 模型切换 + 自定义 provider 配置(含 apiKey)
 * - 思考模式
 * - 对话设置(system prompt override + memory turns override)
 */

import type { ProviderProfile } from './customProvider/types';
import type { UserSettings } from './userSettings';
import { readActiveKey } from './activeKey';

/** ponytail: 跟 webLLMProvider.ts 里的 THINKING_PREF_KEY 同值 — 这里不需要依赖 webLLM 模块。 */
const THINKING_PREF_KEY = 'xiaochun.thinking';

/** 同步协议版本 — 格式变了就 bump,接收端拒收不认识的高版本。 */
const PROTOCOL_VERSION = 1;
const PROTOCOL_TAG = 'xs'; // 小巧,QR 文本前缀

/** 用户可勾选的同步项(3 个选项,默认全选)。 */
export interface SyncSelection {
  models: boolean;
  thinking: boolean;
  chatSettings: boolean;
}

export const DEFAULT_SYNC_SELECTION: SyncSelection = {
  models: true,
  thinking: true,
  chatSettings: true,
};

/** 实际打包进密文的 payload。 */
export interface SyncPayload {
  v: number;
  ts: number;
  data: {
    activeKey?: string | null;       // 'custom:xxx' | 'webllm:xxx' | null
    providers?: ProviderProfile[];   // 自定义 provider 完整配置
    thinkingEnabled?: boolean;
    userSettings?: UserSettings;
  };
}

/** 加密包 — 三段 base64,中间用 '.' 隔开。 */
export interface EncryptedSync {
  iv: string;
  ct: string;
  key: string; // 单独 base64 的 AES-256 密钥
}

// ─── collect: 从本地状态读出待同步数据 ──────────────────────────

function readThinkingFromStorage(): boolean | undefined {
  if (typeof window === 'undefined') return undefined;
  const v = window.localStorage.getItem(THINKING_PREF_KEY);
  if (v === '1') return true;
  if (v === '0') return false;
  return undefined;
}

function readActiveKeyRaw(): string | null {
  const parsed = readActiveKey();
  if (!parsed) return null;
  return parsed.kind === 'custom' ? `custom:${parsed.providerId}` : `webllm:${parsed.modelId}`;
}

export interface CollectInputs {
  selection: SyncSelection;
  providers?: ProviderProfile[]; // 已经解密明文(由 caller 提供)
  thinkingEnabled?: boolean;
  userSettings?: UserSettings;
}

/**
 * ponytail: 构造待加密 payload。参数都是 caller 准备好的明文(避免这里跑 IDB 异步)。
 * 真实场景的"收集"在 SyncDialog 里 useEffect + Promise.all 完成。
 */
export function buildSyncPayload(input: CollectInputs): SyncPayload {
  const data: SyncPayload['data'] = {};
  if (input.selection.models) {
    if (input.providers !== undefined) data.providers = input.providers;
    const active = readActiveKeyRaw();
    if (active !== null) data.activeKey = active;
    else data.activeKey = null;
  }
  if (input.selection.thinking) {
    const t = input.thinkingEnabled !== undefined ? input.thinkingEnabled : readThinkingFromStorage();
    if (t !== undefined) data.thinkingEnabled = t;
  }
  if (input.selection.chatSettings) {
    if (input.userSettings !== undefined) data.userSettings = input.userSettings;
  }
  return { v: PROTOCOL_VERSION, ts: Date.now(), data };
}

// ─── encrypt / decrypt ────────────────────────────────────────

function bytesToB64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * 生成新的 AES-256 密钥(256 bit = 32 字节)。
 * ponytail: 不是 PBKDF2 派生的 — 同步密钥本身就是共享秘密,不需要口令拉伸。
 */
export function generateSyncKey(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32));
}

/** ponytail: 加密 payload — 返回 {iv, ct, key} 三段 base64。 */
export async function encryptSyncPayload(payload: SyncPayload, key?: Uint8Array): Promise<EncryptedSync> {
  const k = key ?? generateSyncKey();
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    k as BufferSource,
    { name: 'AES-GCM' },
    false,
    ['encrypt']
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  const ctBuf = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    cryptoKey,
    plaintext as BufferSource
  );
  return {
    iv: bytesToB64(iv),
    ct: bytesToB64(new Uint8Array(ctBuf)),
    key: bytesToB64(k),
  };
}

/** ponytail: 解密 — iv / ct / key 任一字段错就 throw,接收端明确告诉。 */
export async function decryptSyncPayload(encrypted: EncryptedSync): Promise<SyncPayload> {
  if (encrypted.iv.length === 0 || encrypted.ct.length === 0 || encrypted.key.length === 0) {
    throw new Error('invalid encrypted payload: missing iv/ct/key');
  }
  const keyBytes = b64ToBytes(encrypted.key);
  const ivBytes = b64ToBytes(encrypted.iv);
  const ctBytes = b64ToBytes(encrypted.ct);
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBytes as BufferSource,
    { name: 'AES-GCM' },
    false,
    ['decrypt']
  );
  const plainBuf = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: ivBytes as BufferSource },
    cryptoKey,
    ctBytes as BufferSource
  );
  const payload = JSON.parse(new TextDecoder().decode(plainBuf)) as SyncPayload;
  if (payload.v !== PROTOCOL_VERSION) {
    throw new Error(`unsupported protocol version: ${payload.v} (this app expects ${PROTOCOL_VERSION})`);
  }
  return payload;
}

// ─── text format: `xs:v1:iv.ct.key` 适合 QR + 复制粘贴 ───────

export function serializeForTransfer(encrypted: EncryptedSync): string {
  return `${PROTOCOL_TAG}:v${PROTOCOL_VERSION}:${encrypted.iv}.${encrypted.ct}.${encrypted.key}`;
}

/**
 * ponytail: 解析文本 — 严格校验 prefix + version,接受「纯密文」(无 key)用于扫描 QR 的场景。
 * - 完整文本 `xs:v1:iv.ct.key` → 三段都有
 * - 仅密文 `xs:v1:iv.ct` → 只返密文,key 留空,接收端需要单独填 key
 */
export function parseTransferText(text: string): EncryptedSync {
  const trimmed = (text ?? '').trim();
  const parts = trimmed.split(':');
  if (parts.length !== 3 || parts[0] !== PROTOCOL_TAG) {
    throw new Error('格式不符 — 需要 xs:v1:... 开头');
  }
  const versionPart = parts[1];
  if (!versionPart.startsWith('v')) {
    throw new Error('格式不符 — 缺少版本号');
  }
  const version = parseInt(versionPart.slice(1), 10);
  if (version !== PROTOCOL_VERSION) {
    throw new Error(`不支持的版本: v${version}`);
  }
  const body = parts[2].split('.');
  if (body.length < 2 || body.length > 3) {
    throw new Error('格式不符 — 主体必须是 iv.ct[.key]');
  }
  return {
    iv: body[0],
    ct: body[1],
    key: body[2] ?? '',
  };
}

/** ponytail: 接收端拿到加密包后,生成可读的导入预览文案。 */
export interface ImportPreview {
  activeKey?: { kind: 'custom' | 'webllm'; value: string } | null;
  providersCount: number;
  providerNames: string[];
  thinkingEnabled?: boolean;
  hasCustomPrompt: boolean;
  memoryTurnsOverride?: number;
}

export function previewImport(payload: SyncPayload): ImportPreview {
  const d = payload.data;
  let activeKey: ImportPreview['activeKey'];
  if (d.activeKey !== undefined) {
    if (d.activeKey === null) activeKey = null;
    else {
      const idx = d.activeKey.indexOf(':');
      const kind = d.activeKey.slice(0, idx);
      const value = d.activeKey.slice(idx + 1);
      activeKey = {
        kind: kind === 'custom' ? 'custom' : 'webllm',
        value,
      };
    }
  }
  return {
    activeKey,
    providersCount: d.providers?.length ?? 0,
    providerNames: (d.providers ?? []).map((p) => p.name || p.model),
    thinkingEnabled: d.thinkingEnabled,
    hasCustomPrompt: !!(d.userSettings?.systemPromptOverride?.trim()),
    memoryTurnsOverride: d.userSettings?.memoryTurnsOverride,
  };
}