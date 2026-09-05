/**
 * activeKey.ts — 统一的「当前激活的 LLM」key。
 *
 * ponytail: 之前 webllm 和 custom provider 用两套并行 state(sessionStorage 里一个
 * activeId、localStorage 里一个 model),切换时一不留神就不同步,UI 跟路由对不上。
 * 现在合并成单 key:`custom:${providerId}` / `webllm:${modelId}`,存在
 * sessionStorage 一个地方,所有读写都过这里。
 */

const ACTIVE_KEY = 'xiaochun.active.llm';

export type ParsedActiveKey =
  | { kind: 'custom'; providerId: string }
  | { kind: 'webllm'; modelId: string };

/** 解析 `custom:xxx` / `webllm:xxx` 格式字符串,失败返 null。 */
export function parseActiveKey(raw: string | null): ParsedActiveKey | null {
  if (!raw) return null;
  const colonIdx = raw.indexOf(':');
  if (colonIdx < 1 || colonIdx >= raw.length - 1) return null;
  const kind = raw.slice(0, colonIdx);
  const value = raw.slice(colonIdx + 1);
  if (kind === 'custom') return { kind: 'custom', providerId: value };
  if (kind === 'webllm') return { kind: 'webllm', modelId: value };
  return null;
}

export function readActiveKey(): ParsedActiveKey | null {
  if (typeof window === 'undefined') return null;
  try {
    return parseActiveKey(window.sessionStorage.getItem(ACTIVE_KEY));
  } catch {
    return null;
  }
}

export function writeActiveKey(key: ParsedActiveKey | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (key) {
      const serialized = key.kind === 'custom'
        ? `custom:${key.providerId}`
        : `webllm:${key.modelId}`;
      window.sessionStorage.setItem(ACTIVE_KEY, serialized);
    } else {
      window.sessionStorage.removeItem(ACTIVE_KEY);
    }
  } catch { /* noop */ }
}

// ponytail: 旧版本把 custom providerId 直接存 sessionStorage(无前缀),重构后改成统一
// key 格式 `custom:xxx`。老的 key 用户若不清就会失效 — 启动时迁移一次,迁移完删旧。
const LEGACY_KEY = 'xiaochun.provider.active';
function migrateLegacyActiveKey(): void {
  if (typeof window === 'undefined') return;
  try {
    const oldVal = window.sessionStorage.getItem(LEGACY_KEY);
    if (oldVal && !window.sessionStorage.getItem(ACTIVE_KEY)) {
      window.sessionStorage.setItem(ACTIVE_KEY, `custom:${oldVal}`);
    }
    window.sessionStorage.removeItem(LEGACY_KEY);
  } catch { /* noop */ }
}
migrateLegacyActiveKey();