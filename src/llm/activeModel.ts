/**
 * activeModel.ts — 当前激活的 LLM（webllm model id 或 custom provider id）。
 *
 * ponytail: webllm / custom 共享单 key — `xiaochun.llm.model` = `${kind}:${value}`，
 * kind ∈ `webllm` | `custom`。启动 / 切模型 / 切 provider 都读写这一个 key。
 */

import { LLM_MODEL_KEY } from '@/lib/constants';

const KEY = LLM_MODEL_KEY;

export type ActiveModel =
  | { kind: 'webllm'; modelId: string }
  | { kind: 'custom'; providerId: string };

/** 解析 `webllm:xxx` / `custom:xxx` 格式字符串，失败（含裸字符串 / 旧值）返 null — 调用方按 null 走默认。 */
export function parseActiveModel(raw: string | null | undefined): ActiveModel | null {
  if (!raw) return null;
  const colon = raw.indexOf(':');
  if (colon <= 0) return null;
  const kind = raw.slice(0, colon);
  const value = raw.slice(colon + 1);
  if (kind === 'custom' && value) return { kind: 'custom', providerId: value };
  if (kind === 'webllm' && value) return { kind: 'webllm', modelId: value };
  return null;
}

export function readActiveModel(): ActiveModel | null {
  if (typeof window === 'undefined') return null;
  try {
    return parseActiveModel(window.localStorage.getItem(KEY));
  } catch {
    return null;
  }
}

export function writeActiveModel(next: ActiveModel | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (next) {
      const v = next.kind === 'custom' ? `custom:${next.providerId}` : `webllm:${next.modelId}`;
      window.localStorage.setItem(KEY, v);
    } else {
      window.localStorage.removeItem(KEY);
    }
  } catch { /* noop */ }
  notifyActiveModel();
}

const listeners = new Set<(m: ActiveModel | null) => void>();

export function subscribeActiveModel(cb: (m: ActiveModel | null) => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

function notifyActiveModel(): void {
  if (listeners.size === 0) return;
  const current = readActiveModel();
  listeners.forEach((cb) => {
    try { cb(current); } catch { /* noop */ }
  });
}