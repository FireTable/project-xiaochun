/**
 * corners — 四角缩放热区的几何 (纯函数, 零 DOM / Tauri 依赖)。
 *
 * Tauri 的 TauriWindowFrame 与 /embed 的 iframe 缩放共用这一份:
 *   - 热区 = 视口四角各一个 CORNER_HIT_SIZE 见方的正方形 (原 TauriWindowFrame.updateCornerRects 的 cornerSize=40);
 *   - 命中判定用于: ① 按下时决定是否开始缩放; ② 透明场景穿透 (HitGate 的 test) 把角落热区算"命中", 否则宿主会把指针穿透过去, 角点不到。
 */
import type { ResizeCorner } from './types';

/** 角落热区边长 (CSS px)。与 Tauri 一致。 */
export const CORNER_HIT_SIZE = 40;

/** 各角对应的 CSS 光标 (NW/SE 同一方向, NE/SW 同一方向)。 */
export const CORNER_CURSOR: Record<ResizeCorner, 'nwse-resize' | 'nesw-resize'> = {
  NW: 'nwse-resize',
  SE: 'nwse-resize',
  NE: 'nesw-resize',
  SW: 'nesw-resize',
};

/**
 * (x, y) 落在宽 w 高 h 的视口的哪个角热区里; 不在任何热区 / 在视口外 → null。
 * 视口窄到两个热区重叠时按左右半区、上下半区就近归属。
 */
export function cornerAt(x: number, y: number, w: number, h: number, size: number = CORNER_HIT_SIZE): ResizeCorner | null {
  if (!(w > 0) || !(h > 0) || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  if (x < 0 || y < 0 || x > w || y > h) return null;
  const nearLeft = x <= size, nearRight = x >= w - size;
  const nearTop = y <= size, nearBottom = y >= h - size;
  if (!(nearLeft || nearRight) || !(nearTop || nearBottom)) return null;
  const left = nearLeft && nearRight ? x < w / 2 : nearLeft;
  const top = nearTop && nearBottom ? y < h / 2 : nearTop;
  return top ? (left ? 'NW' : 'NE') : (left ? 'SW' : 'SE');
}
