import type { TransitionKind } from './schema';

/**
 * 转场时序 (毫秒)：引擎与 StoryCinematicOverlay 共用，保证“盖住 / 停留 / 揭开”与 CSS 过渡时长一致。
 * - coverMs：遮罩从透明到完全盖住画面所需时间 (引擎会等这么久再执行场景切换 / 本拍演出)
 * - holdMs：盖住后、开始揭开前的停留
 * - revealMs：从盖住到完全揭开的 CSS 过渡时长
 */
export interface TransitionSpec {
  coverMs: number;
  holdMs: number;
  revealMs: number;
}

export const TRANSITION_SPECS: Record<Exclude<TransitionKind, 'none'>, TransitionSpec> = {
  eye_blink: { coverMs: 600, holdMs: 450, revealMs: 800 },
  white_flash: { coverMs: 140, holdMs: 60, revealMs: 1100 },
  fade_to_black: { coverMs: 650, holdMs: 300, revealMs: 900 },
};
