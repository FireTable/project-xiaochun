/**
 * heavyPreload.ts — 重资源 (EMAGE ONNX / WebLLM) 自动预热开关。
 *
 * - 主站: 恒为 true (行为与以前完全一致: VRM 加载完立即后台预热 EMAGE + WebLLM)。
 * - /embed: 默认 `heavy=lazy` → false, 不抢宿主页首屏带宽 / 显存; 宿主通过
 *   URL `?heavy=eager|motion` 或 `xc.setConfig{heavy:'eager'|'motion'}` 打开。
 *   - eager: 预热 EMAGE + WebLLM。
 *   - motion: 只预热 EMAGE (动作), 从不预热 WebLLM。
 *
 * 懒求值 (调用时才读 URL) → 不依赖模块加载顺序, vrmEngine / EmagePlayer 构造期均安全。
 */
type HeavyMode = 'lazy' | 'eager' | 'motion';

let override: HeavyMode | null = null;

/** 运行时显式覆盖 (xc.setConfig)。传 null 恢复由 URL 决定。 */
export function setHeavyPreloadOverride(v: HeavyMode | null): void {
  override = v;
}

/** 当前策略; 主站 (非 /embed) 返回 null。 */
function currentMode(): HeavyMode | null {
  if (override !== null) return override;
  if (typeof window === 'undefined') return null;
  if (!/^\/embed(\/|$)/.test(window.location.pathname)) return null;
  const q = new URLSearchParams(window.location.search).get('heavy');
  return q === 'eager' || q === 'motion' ? q : 'lazy';
}

/** 是否允许自动预热 EMAGE (eager / motion / 主站)。 */
export function isHeavyPreloadAllowed(): boolean {
  const mode = currentMode();
  return mode === null || mode !== 'lazy';
}

/** 是否允许自动预热 WebLLM (只有 eager / 主站)。 */
export function isLlmPreloadAllowed(): boolean {
  const mode = currentMode();
  return mode === null || mode === 'eager';
}
