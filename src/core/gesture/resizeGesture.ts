/**
 * ResizeGesture — 边角缩放手势 (纯 TS, 零 DOM / Tauri 依赖)。
 *
 * - strategy 'native' (Tauri): begin() 只发一次 resize-start, 之后窗口由系统拖动, 没有 delta。
 * - strategy 'delta'  (Embed, 阶段 4): resize-start → resize-delta* (屏幕坐标, 含 corner) → resize-end。
 *
 * 与 GestureMachine 互斥使用: 角把手本身是独立命中区, 按下即缩放, 不经过 480ms 长按 / 10px 阈值。
 */
import type { GestureListener, MoveStrategy, PointerSample, ResizeCorner } from './types';

type ResizeStrategy = Exclude<MoveStrategy, 'none'>;

interface Active {
  corner: ResizeCorner;
  pointerId: number;
  startScreenX: number;
  startScreenY: number;
  lastScreenX: number;
  lastScreenY: number;
}

export class ResizeGesture {
  private listeners = new Set<GestureListener>();
  private active: Active | null = null;
  private strategy: ResizeStrategy;

  constructor(strategy: ResizeStrategy = 'native') {
    this.strategy = strategy;
  }

  on(cb: GestureListener): () => void {
    this.listeners.add(cb);
    return () => { this.listeners.delete(cb); };
  }

  get resizing(): boolean { return this.active !== null; }

  /** 左键按在某个边角把手上。返回是否开始了缩放 (非左键 / 已在缩放中 → false)。 */
  begin(corner: ResizeCorner, s: PointerSample): boolean {
    if (s.button !== 0 || this.active) return false;
    if (this.strategy === 'delta') {
      this.active = {
        corner,
        pointerId: s.pointerId,
        startScreenX: s.screenX,
        startScreenY: s.screenY,
        lastScreenX: s.screenX,
        lastScreenY: s.screenY,
      };
    }
    this.emit({
      type: 'resize-start',
      strategy: this.strategy,
      corner,
      pointerId: s.pointerId,
      screenX: s.screenX,
      screenY: s.screenY,
    });
    return true;
  }

  move(s: PointerSample): void {
    const a = this.active;
    if (!a || a.pointerId !== s.pointerId) return;
    const dx = s.screenX - a.lastScreenX;
    const dy = s.screenY - a.lastScreenY;
    a.lastScreenX = s.screenX;
    a.lastScreenY = s.screenY;
    this.emit({
      type: 'resize-delta',
      corner: a.corner,
      dx,
      dy,
      totalDx: s.screenX - a.startScreenX,
      totalDy: s.screenY - a.startScreenY,
    });
  }

  end(reason: 'up' | 'cancel' | 'blur'): void {
    const a = this.active;
    if (!a) return;
    this.active = null;
    this.emit({ type: 'resize-end', corner: a.corner, reason });
  }

  dispose(): void {
    this.active = null;
    this.listeners.clear();
  }

  private emit(ev: Parameters<GestureListener>[0]): void {
    for (const cb of this.listeners) cb(ev);
  }
}
