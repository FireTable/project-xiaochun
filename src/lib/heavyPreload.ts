/**
 * heavyPreload.ts — 重资源 (EMAGE ONNX / WebLLM) 自动预热开关。
 *
 * - 主站: 恒为 true (行为与以前完全一致: VRM 加载完立即后台预热)。
 * - /embed: 默认 `heavy=lazy` → false, 不抢宿主页首屏带宽 / 显存; 宿主通过
 *   URL `?heavy=eager` 或 `xc.setConfig{heavy:'eager'}` 打开。
 *
 * 懒求值 (调用时才读 URL) → 不依赖模块加载顺序, vrmEngine / EmagePlayer 构造期均安全。
 */
let override: boolean | null = null;

/** 运行时显式覆盖 (xc.setConfig)。传 null 恢复由 URL 决定。 */
export function setHeavyPreloadOverride(v: boolean | null): void {
  override = v;
}

export function isHeavyPreloadAllowed(): boolean {
  if (override !== null) return override;
  if (typeof window === 'undefined') return true;
  if (!/^\/embed(\/|$)/.test(window.location.pathname)) return true;
  return new URLSearchParams(window.location.search).get('heavy') === 'eager';
}
