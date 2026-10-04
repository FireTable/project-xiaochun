/**
 * beachStrip.ts — 海滩背景长条的几何常量与"俯仰角 → 长条中心行"映射 (纯函数, 无 three / DOM 依赖, 可直接单测)。
 * 映射原理见 beachBackdrop.ts 顶部注释。
 */

/** 与 scripts/build-beach-strip.mjs 输出的 BEACH_STRIP 一致; 换素材要同步。 */
export const BEACH_STRIP = {
  width: 1280,
  height: 1930,
  /** 单张源图高 (cover 视口的最大高度)。 */
  tileHeight: 720,
  /** 海平线所在行。 */
  horizonY: 1018,
  /** 海岸线 (泡沫结束 / 沙滩开始) 所在行。 */
  shoreY: 1165,
} as const;

export interface StripCenterInput {
  /** 视线俯仰归一化: +1 = 仰视极限, −1 = 俯视极限。 */
  p: number;
  /** 屏幕宽高比 (W/H)。 */
  aspect: number;
  /** 平视时海平线所在的屏幕 NDC y (−1 底 … +1 顶); 例如髋部在屏幕中心下方 45% 半高处 → −0.45。 */
  horizonNdcY: number;
  /** 背景滚动幅度倍率 (APP_CONFIG.beachScene.scroll.parallax)。 */
  parallax?: number;
}

/** cover 视口: 长条里与屏幕同宽高比、放得进一张 1280×720 的最大矩形。 */
export function coverViewport(aspect: number): { vw: number; vh: number } {
  const a = Number.isFinite(aspect) && aspect > 1e-3 ? aspect : 1;
  const vh = Math.min(BEACH_STRIP.tileHeight, BEACH_STRIP.width / a);
  return { vw: vh * a, vh };
}

/**
 * 屏幕中心对应的长条行号 c(p) (纯函数, 有单测)。保证 p ∈ [−1,1] 时 [c−vh/2, c+vh/2] ⊂ [0, H], 且 c 对 p 单调不增。
 */
export function computeStripCenter(inp: StripCenterInput): { center: number; vw: number; vh: number } {
  const { vw, vh } = coverViewport(inp.aspect);
  const H = BEACH_STRIP.height;
  const par = Math.min(1, Math.max(0.2, inp.parallax ?? 1));
  const p = Math.min(1, Math.max(-1, Number.isFinite(inp.p) ? inp.p : 0));
  const full0 = vh / 2, full1 = H - vh / 2; // 视口顶 / 底恰好贴边时的中心行
  // c0: 平视时让海平线落在屏幕 horizonNdcY 处:  horizonY = c0 − ndcY·vh/2
  const c0 = BEACH_STRIP.horizonY + inp.horizonNdcY * vh / 2;
  // parallax<1: 以 c0 为原点把可用行程按比例收窄
  const cTop = c0 + (full0 - c0) * par;
  const cBot = c0 + (full1 - c0) * par;
  // c(p) = c0' − a·p + e·p²,  c(1)=cTop, c(−1)=cBot  →  a = (cBot−cTop)/2,  e = (cTop+cBot)/2 − c0'
  const a = (cBot - cTop) / 2;
  const mid = (cTop + cBot) / 2;
  // 单调性: dc/dp = −a + 2e·p, 要求 |2e| < a, 即 c0' 只能落在行程中间的一半里; 极端缩放 / 极端相机高度下海平线不再贴髋部, 但绝不露边也不会倒卷
  const e = Math.min(a * 0.45, Math.max(-a * 0.45, mid - c0));
  const c0p = mid - e;
  const center = c0p - a * p + e * p * p;
  return { center: Math.min(full1, Math.max(full0, center)), vw, vh };
}
