/**
 * gesture-box.ts — iframe 手势 (xc.gesture-move / xc.gesture-resize) 在宿主侧的纯逻辑: 校验 + 几何限幅。零 DOM 依赖, 可单测。
 *
 * 宿主 SDK 对 iframe 发来的手势**不信任**: 载荷逐字段校验 (类型 / 有限数 / 量级 / 角名), 序号必须按规则递增 (GestureGate),
 * 位置 / 尺寸全部在这里按"当前视口 + 最小 / 最大尺寸"夹紧, iframe 说多少就移多少是不可能的。
 * 计算一律用 start 时的盒子 + 累计位移 (totalDx / totalDy), 不累加增量: 丢包 / 夹紧都不会让结果漂移。
 */
import type { XcGestureCorner } from './protocol';

export interface Box { left: number; top: number; width: number; height: number }
export interface Viewport { width: number; height: number }
export interface ResizeLimits { minWidth: number; minHeight: number; maxWidth: number; maxHeight: number }

/** 默认限幅: 最小 120x180 (再小角色基本看不清), 最大只受视口限制。 */
export const DEFAULT_RESIZE_LIMITS: Readonly<ResizeLimits> = Object.freeze({
  minWidth: 120, minHeight: 180, maxWidth: Infinity, maxHeight: Infinity,
});

export interface XiaochunResizeLimits {
  /** 最小宽 (px), 默认 120。 */
  minWidth?: number;
  /** 最小高 (px), 默认 180。 */
  minHeight?: number;
  /** 最大宽 (px), 默认只受视口限制。 */
  maxWidth?: number;
  /** 最大高 (px), 默认只受视口限制。 */
  maxHeight?: number;
}

const finitePositive = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;

/** `resizable` 选项 → 限幅; false / undefined → null (关闭); true → 默认限幅; 对象 → 逐项覆盖 (非法值用默认)。min 不会超过 max。 */
export function normalizeResizable(v: boolean | XiaochunResizeLimits | undefined): ResizeLimits | null {
  if (!v) return null;
  const o = v === true ? {} : v;
  const minWidth = finitePositive(o.minWidth) ? o.minWidth : DEFAULT_RESIZE_LIMITS.minWidth;
  const minHeight = finitePositive(o.minHeight) ? o.minHeight : DEFAULT_RESIZE_LIMITS.minHeight;
  const maxWidth = finitePositive(o.maxWidth) ? Math.max(o.maxWidth, minWidth) : Infinity;
  const maxHeight = finitePositive(o.maxHeight) ? Math.max(o.maxHeight, minHeight) : Infinity;
  return { minWidth, minHeight, maxWidth, maxHeight };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));

/** 移动: 起点盒子 + 累计位移, 夹在视口内 (盒子比视口大时贴左上)。 */
export function moveBox(start: Box, totalDx: number, totalDy: number, vp: Viewport): Box {
  return {
    left: clamp(start.left + totalDx, 0, vp.width - start.width),
    top: clamp(start.top + totalDy, 0, vp.height - start.height),
    width: start.width,
    height: start.height,
  };
}

/**
 * 缩放: 被拖的角跟手, 对角固定; 宽高夹在 [min, min(max, 视口内还能伸展的空间)]。
 * 例: 拖 SE 角 → 左上固定, 右 / 下边界不能越过视口; 拖 NW 角 → 右下固定, 左 / 上边界不能越过视口。
 */
export function resizeBox(start: Box, corner: XcGestureCorner, totalDx: number, totalDy: number, limits: ResizeLimits, vp: Viewport): Box {
  const west = corner === 'NW' || corner === 'SW';
  const north = corner === 'NW' || corner === 'NE';
  const right = start.left + start.width, bottom = start.top + start.height;
  const wantW = west ? start.width - totalDx : start.width + totalDx;
  const wantH = north ? start.height - totalDy : start.height + totalDy;
  const roomW = west ? right : vp.width - start.left;
  const roomH = north ? bottom : vp.height - start.top;
  const width = clamp(wantW, limits.minWidth, Math.min(limits.maxWidth, roomW));
  const height = clamp(wantH, limits.minHeight, Math.min(limits.maxHeight, roomH));
  return { left: west ? right - width : start.left, top: north ? bottom - height : start.top, width, height };
}

/** 窗口 / 视口变小后把盒子重新夹回视口 (尺寸也不超过视口)。 */
export function fitBox(b: Box, vp: Viewport): Box {
  const width = Math.min(b.width, Math.max(1, vp.width)), height = Math.min(b.height, Math.max(1, vp.height));
  return { left: clamp(b.left, 0, vp.width - width), top: clamp(b.top, 0, vp.height - height), width, height };
}

// ── 载荷校验 ──
const CORNERS = new Set(['NW', 'NE', 'SW', 'SE']);
const PHASES = new Set(['start', 'move', 'end']);
const REASONS = new Set(['up', 'cancel', 'blur']);
/** 单次累计位移的合理上限 (CSS px)。屏幕再大也到不了, 超过的一律当作伪造。 */
export const MAX_GESTURE_DELTA = 20_000;

export interface ParsedGesture {
  gesture: number;
  seq: number;
  phase: 'start' | 'move' | 'end';
  totalDx: number;
  totalDy: number;
  corner?: XcGestureCorner;
}

const delta = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= MAX_GESTURE_DELTA;
const counter = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;

/** 校验 iframe 发来的手势载荷; 不合法返回 null。kind='resize' 还要求合法的 corner。 */
export function parseGesturePayload(kind: 'move' | 'resize', raw: unknown): ParsedGesture | null {
  if (raw === null || typeof raw !== 'object') return null;
  const p = raw as Record<string, unknown>;
  if (!counter(p.gesture) || !counter(p.seq) || typeof p.phase !== 'string' || !PHASES.has(p.phase)) return null;
  if (!delta(p.dx) || !delta(p.dy) || !delta(p.totalDx) || !delta(p.totalDy)) return null;
  if (p.reason !== undefined && (typeof p.reason !== 'string' || !REASONS.has(p.reason))) return null;
  const out: ParsedGesture = { gesture: p.gesture, seq: p.seq, phase: p.phase as ParsedGesture['phase'], totalDx: p.totalDx, totalDy: p.totalDy };
  if (kind === 'resize') {
    if (typeof p.corner !== 'string' || !CORNERS.has(p.corner)) return null;
    out.corner = p.corner as XcGestureCorner;
  }
  return out;
}

/**
 * 手势序号闸门: 只放行"合法的手势序列" —— start(gesture 比上一个大, seq=0) → move* (seq 严格递增) → end。
 * 迟到 / 重放 / 乱序 / 没有 start 的消息一律拒绝。一个闸门对应一种手势 (move 或 resize)。
 */
export class GestureGate {
  private lastGesture = 0;
  private lastSeq = -1;
  private open = false;

  get active(): boolean { return this.open; }

  accept(p: Pick<ParsedGesture, 'gesture' | 'seq' | 'phase'>): boolean {
    if (p.phase === 'start') {
      if (p.gesture <= this.lastGesture || p.seq !== 0) return false;
      this.lastGesture = p.gesture;
      this.lastSeq = 0;
      this.open = true;
      return true;
    }
    if (!this.open || p.gesture !== this.lastGesture || p.seq <= this.lastSeq) return false;
    this.lastSeq = p.seq;
    if (p.phase === 'end') this.open = false;
    return true;
  }

  /** 宿主主动结束 (关闭手势 / 销毁): 之后同一手势的迟到消息被拒绝。 */
  close(): void { this.open = false; }
}
