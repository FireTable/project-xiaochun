/**
 * GestureMachine — 左键手势状态机 (纯 TS, 零 DOM / Tauri 依赖)。
 *
 * 从 InteractionController 原样抽出的判定逻辑, 行为必须与抽取前完全一致:
 *
 *   idle ──down(无修饰键)──► pressed ──480ms 内位移 ≤ 10px──► armed(pending) ──位移 > 10px──► turn | guide
 *                              │                                 │
 *                              │ 位移 > 10px (严格大于)          └─松手(几乎没动)─► armed (导轨保持, 空闲 hideMs 后收起)
 *                              ▼
 *                         move (native: 只发一次 move-start 交给宿主; delta: 逻辑层出 move-delta; none: 仅取消长按)
 *
 *   idle ──down(Cmd/Ctrl)──► turn | guide   (立即 3D 模式, 导轨优先)
 *
 * 冲突处理 (窗口拖动 vs bodyTurn): 10px 内松手 / 满 480ms 才会进入调整模式, 之后的位移才算转身/俯仰;
 *   480ms 内位移超过 10px 一律算"移动", 并取消长按 (此后不会再武装)。
 *
 * 输入: pointerDown/Move/Up/Cancel + keyDown/keyUp + blur (均为 PointerSample / boolean, 不接触 DOM)。
 * 输出: GestureEvent (语义事件)。DOM 副作用 (preventDefault / setPointerCapture / cursor) 由适配器按事件与返回值执行。
 */
import type {
  GestureClock,
  GestureConfig,
  GestureEvent,
  GestureListener,
  GestureProbe,
  GestureResponse,
  MoveStrategy,
  PointerSample,
} from './types';

const NONE: GestureResponse = Object.freeze({});
const PREVENT: GestureResponse = Object.freeze({ preventDefault: true });
const PREVENT_STOP: GestureResponse = Object.freeze({ preventDefault: true, stopPropagation: true });

const defaultClock: GestureClock = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

interface DeltaMove {
  pointerId: number;
  startScreenX: number;
  startScreenY: number;
  lastScreenX: number;
  lastScreenY: number;
}

export class GestureMachine {
  private listeners = new Set<GestureListener>();

  // ── 对外可读状态 (InteractionController 每帧读取) ──
  private _modifierActive = false;
  private _dragging = false; // 原 isLeftDragging: 角色身体拖动 (turn/pitch)
  private _guideDragging = false; // 原 isYGuideDragging
  private _guideHovered = false; // 原 yGuideHovered
  private _armed = false; // 原 touchArmed
  private _pending = false; // 原 touchPendingDrag: 刚武装、手指仍按着

  // ── 内部 ──
  private armTimer: unknown = null;
  private hideTimer: unknown = null;
  private downX = 0;
  private downY = 0;
  private downScreenX = 0;
  private downScreenY = 0;
  private activePointerId: number | null = null;
  private dragStartX = 0;
  private dragStartY = 0;
  private guideLastY = 0;
  private touchPointers = new Set<number>();
  private deltaMove: DeltaMove | null = null;

  private config: GestureConfig;
  private probe: GestureProbe;
  private clock: GestureClock;

  constructor(config: GestureConfig, probe: GestureProbe, clock: GestureClock = defaultClock) {
    this.config = config;
    this.probe = probe;
    this.clock = clock;
  }

  // ───────────── 订阅 / 读状态 ─────────────

  on(cb: GestureListener): () => void {
    this.listeners.add(cb);
    return () => { this.listeners.delete(cb); };
  }

  get modifierActive(): boolean { return this._modifierActive; }
  get dragging(): boolean { return this._dragging; }
  get guideDragging(): boolean { return this._guideDragging; }
  get guideHovered(): boolean { return this._guideHovered; }
  get armed(): boolean { return this._armed; }
  get pending(): boolean { return this._pending; }
  /** 原 syncGuidePassthrough 的 capture 条件: 任一为真就要强制关闭原生穿透。 */
  get capturing(): boolean {
    return this._modifierActive || this._armed || this._pending || this._dragging || this._guideDragging;
  }

  setConfig(config: GestureConfig): void { this.config = config; }

  // ───────────── 指针输入 ─────────────

  pointerDown(s: PointerSample): GestureResponse {
    if (s.button !== 0) return NONE;

    this.trackTouchDown(s);
    // 双指: 不进 turn/pitch / 长按武装, 交给 pinch
    if (this.isMultiTouch()) {
      this.abortForMultiTouch();
      return NONE;
    }

    const hasMod = s.modifier;

    // 已在调整模式 (长按武装后) → 可直接点 Y 尺或开转身/俯仰拖
    if (!hasMod && this._armed) {
      this._modifierActive = true;
      if (this.probe.isGuideHit(s.x, s.y)) {
        this.startGuideDrag(s);
        this.notifyState();
        return PREVENT;
      }
      this.beginTurn(s.x, s.y, s.pointerId);
      return PREVENT;
    }

    // 无修饰键: 启动长按武装; 提前滑动见 pointerMove (native → move-start)
    if (!hasMod) {
      this.clearArmTimer();
      this.downX = s.x;
      this.downY = s.y;
      this.downScreenX = s.screenX;
      this.downScreenY = s.screenY;
      this.activePointerId = s.pointerId;
      const pointerId = s.pointerId;
      this.armTimer = this.clock.setTimeout(() => {
        this.armTimer = null;
        this.enterAdjustMode(pointerId);
      }, this.config.armMs);
      return NONE;
    }

    // Cmd/Ctrl: 即时 3D; Y 尺优先
    if (this.probe.isGuideHit(s.x, s.y)) {
      this._modifierActive = true;
      this.startGuideDrag(s);
      return PREVENT_STOP;
    }

    this._modifierActive = true;
    this.beginTurn(s.x, s.y, s.pointerId);
    return PREVENT;
  }

  pointerMove(s: PointerSample): GestureResponse {
    // delta 策略的移动中: 只出 delta
    if (this.deltaMove && this.deltaMove.pointerId === s.pointerId) {
      const m = this.deltaMove;
      const dx = s.screenX - m.lastScreenX;
      const dy = s.screenY - m.lastScreenY;
      m.lastScreenX = s.screenX;
      m.lastScreenY = s.screenY;
      this.emit({
        type: 'move-delta',
        dx,
        dy,
        totalDx: s.screenX - m.startScreenX,
        totalDy: s.screenY - m.startScreenY,
      });
      return PREVENT;
    }

    // 长按武装前位移过大 → 取消武装; native 交给宿主拖窗, none 把滑动交还
    if (this.armTimer !== null && this.activePointerId === s.pointerId) {
      const adx = s.x - this.downX;
      const ady = s.y - this.downY;
      if (Math.hypot(adx, ady) > this.config.slopPx) {
        this.clearArmTimer();
        this.activePointerId = null;
        this.startMove(s);
      }
      return NONE;
    }

    // 第二指落下: 打断 turn/pitch, 留给 pinch
    if (s.pointerType === 'touch' && this.isMultiTouch()) {
      this.abortForMultiTouch();
      return NONE;
    }

    // 刚武装、手指仍按着: 位移后决定 Y 尺 or 转身/俯仰
    if (this._pending && this._armed && this.activePointerId === s.pointerId) {
      const adx = s.x - this.downX;
      const ady = s.y - this.downY;
      if (Math.hypot(adx, ady) > this.config.slopPx) {
        if (this.probe.isGuideHit(this.downX, this.downY)) {
          this.startGuideDrag(s);
          this.notifyState();
        } else {
          this.beginTurn(s.x, s.y, s.pointerId);
        }
        return PREVENT;
      }
      return NONE;
    }

    // Y 导轨拖拽中: 持续出 dy (宿主换算成世界 Y)
    if (this._guideDragging) {
      const dy = s.y - this.guideLastY;
      this.guideLastY = s.y;
      this.emit({ type: 'guide-drag', dy });
      this.bumpAutoHide();
      return PREVENT;
    }

    // hover 检测 — 导轨可见且未在 body 拖时
    if (this._modifierActive && !this._dragging) {
      this._guideHovered = this.probe.isGuideHit(s.x, s.y);
      this.syncCursor();
    }

    if (!this._dragging) {
      // 长按调整模式: 保持 modifierActive; 否则桌面跟修饰键
      if (this._armed) {
        if (!this._modifierActive) {
          this._modifierActive = true;
          this.syncCursorAndNotify();
        }
        return NONE;
      }
      if (s.modifier !== this._modifierActive) {
        this._modifierActive = s.modifier;
        this.syncCursorAndNotify();
      }
      return NONE;
    }

    if (s.pointerType === 'touch' && this.isMultiTouch()) {
      this.abortForMultiTouch();
      return NONE;
    }

    if (!(s.modifier || this._armed)) {
      this._modifierActive = false;
      this.endTurn();
      this.syncCursorAndNotify();
      return NONE;
    }

    const dx = s.x - this.dragStartX;
    const dy = s.y - this.dragStartY;
    this.emit({ type: 'turn', dx, dy });
    this.dragStartX = s.x;
    this.dragStartY = s.y;
    this.bumpAutoHide();
    this.notifyState(dx, dy);
    return PREVENT;
  }

  pointerUp(s: PointerSample): void {
    this.trackTouchUp(s);
    if (s.button !== 0) return;

    if (this.deltaMove && this.deltaMove.pointerId === s.pointerId) {
      this.deltaMove = null;
      this.emit({ type: 'move-end', reason: 'up' });
      return;
    }

    // 长按中松手 → 取消武装计时 (未进入调整)
    if (this.armTimer !== null && this.activePointerId === s.pointerId) {
      this.clearArmTimer();
      this.activePointerId = null;
      return;
    }

    if (this._guideDragging) {
      this.endGuideDrag();
      this.notifyState();
      return;
    }

    // 武装后几乎没动就松手: 保留调整模式 + 导轨, 等自动消失或二次点 Y
    if (this._pending && this._armed) {
      this._pending = false;
      this.releaseActivePointer();
      this.bumpAutoHide();
      this.syncCursorAndNotify();
      return;
    }

    this.endTurn();
    if (this._armed) this.bumpAutoHide();
    this.syncCursorAndNotify();
  }

  pointerCancel(s?: PointerSample): void {
    if (s) this.trackTouchUp(s);
    else this.touchPointers.clear();
    this.clearArmTimer();
    this._pending = false;
    if (this.deltaMove) {
      this.deltaMove = null;
      this.emit({ type: 'move-end', reason: 'cancel' });
    }
    this.endTurn();
    this.endGuideDrag();
    if (this._armed) this.bumpAutoHide();
    this.syncCursorAndNotify();
  }

  // ───────────── 键盘 / 窗口 ─────────────

  /** keydown: active = 平台主修饰键是否按下。 */
  keyDown(active: boolean): void {
    if (active && !this._modifierActive) {
      this._modifierActive = true;
      this.syncCursorAndNotify();
    }
  }

  /** keyup: stillActive = 松开这个键后平台主修饰键是否仍按着。 */
  keyUp(stillActive: boolean): void {
    if (!stillActive && this._modifierActive && !this._armed) {
      this._modifierActive = false;
      if (this._dragging) this.endTurn();
      if (this._guideDragging) this.endGuideDrag();
      this.syncCursorAndNotify();
    }
  }

  blur(): void {
    if (this.deltaMove) {
      this.deltaMove = null;
      this.emit({ type: 'move-end', reason: 'blur' });
    }
    if (this._modifierActive || this._dragging || this._guideDragging || this._armed) {
      this.clearArm({ hideGuides: true });
      this._modifierActive = false;
      this.endTurn();
      this.endGuideDrag();
      this.syncCursorAndNotify();
    }
  }

  // ───────────── 生命周期 (供 InteractionController bind/unbind/dispose 调用) ─────────────

  /** 原 clearTouchArm: 清长按计时与自动收起计时, 退出武装。 */
  clearArm(opts?: { hideGuides?: boolean }): void {
    this.clearArmTimer();
    this.clearHideTimer();
    const wasArmed = this._armed;
    this._armed = false;
    this._pending = false;
    if (opts?.hideGuides) {
      // 仅清触控武装带来的显轨; 桌面修饰键由 keyup 管
      this._modifierActive = false;
    }
    if (wasArmed) this.emit({ type: 'arm-changed', armed: false });
    this.emit({ type: 'state-changed', cursor: false, notify: false, passthrough: true, dx: 0, dy: 0 });
  }

  /** 原 endDrag。 */
  endTurn(): void {
    if (!this._dragging) return;
    this._dragging = false;
    this._pending = false;
    this.releaseActivePointer();
    this.emit({ type: 'turn-end' });
  }

  /** 原 endYGuideDrag。 */
  endGuideDrag(): void {
    if (!this._guideDragging) return;
    this._guideDragging = false;
    this._guideHovered = false;
    this.syncCursor();
    if (this._armed) this.bumpAutoHide();
    this.emit({ type: 'guide-drag-end' });
  }

  dispose(): void {
    this.clearArmTimer();
    this.clearHideTimer();
    this.listeners.clear();
  }

  // ───────────── 内部 ─────────────

  private emit(ev: GestureEvent): void {
    for (const cb of this.listeners) cb(ev);
  }

  private syncCursor(): void {
    this.emit({ type: 'state-changed', cursor: true, notify: false, passthrough: false, dx: 0, dy: 0 });
  }

  private notifyState(dx = 0, dy = 0): void {
    this.emit({ type: 'state-changed', cursor: false, notify: true, passthrough: true, dx, dy });
  }

  private syncCursorAndNotify(): void {
    this.emit({ type: 'state-changed', cursor: true, notify: true, passthrough: true, dx: 0, dy: 0 });
  }

  private clearArmTimer(): void {
    if (this.armTimer !== null) {
      this.clock.clearTimeout(this.armTimer);
      this.armTimer = null;
    }
  }

  private clearHideTimer(): void {
    if (this.hideTimer !== null) {
      this.clock.clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }
  }

  /** 重置导轨自动消失计时 (仅调整模式)。 */
  private bumpAutoHide(): void {
    this.clearHideTimer();
    if (!this._armed) return;
    this.hideTimer = this.clock.setTimeout(() => {
      this.hideTimer = null;
      // 拖拽中不收; 结束后再等一轮
      if (this._dragging || this._guideDragging || this._pending) {
        this.bumpAutoHide();
        return;
      }
      this.clearArm({ hideGuides: true });
      this.syncCursorAndNotify();
    }, this.config.hideMs);
  }

  private resolveMoveStrategy(): MoveStrategy {
    const m = this.config.moveStrategy;
    return typeof m === 'function' ? m() : m;
  }

  /** 长按期间位移超阈值: 交给窗口移动。 */
  private startMove(s: PointerSample): void {
    const strategy = this.resolveMoveStrategy();
    if (strategy === 'none') return;
    this.emit({
      type: 'move-start',
      strategy,
      pointerId: s.pointerId,
      x: s.x,
      y: s.y,
      screenX: s.screenX,
      screenY: s.screenY,
    });
    if (strategy === 'delta') {
      // 位移原点取按下点 (而不是越过阈值的那一点), 被拖元素才会和指针严格同步; 越过阈值前已走的距离补发成第一个 delta
      this.deltaMove = {
        pointerId: s.pointerId,
        startScreenX: this.downScreenX,
        startScreenY: this.downScreenY,
        lastScreenX: s.screenX,
        lastScreenY: s.screenY,
      };
      const dx = s.screenX - this.downScreenX;
      const dy = s.screenY - this.downScreenY;
      if (dx !== 0 || dy !== 0) this.emit({ type: 'move-delta', dx, dy, totalDx: dx, totalDy: dy });
    }
  }

  private isMultiTouch(): boolean { return this.touchPointers.size >= 2; }

  private trackTouchDown(s: PointerSample): void {
    if (s.pointerType !== 'touch') return;
    this.touchPointers.add(s.pointerId);
  }

  private trackTouchUp(s: PointerSample): void {
    if (s.pointerType !== 'touch') return;
    this.touchPointers.delete(s.pointerId);
  }

  /** 释放 activePointerId 对应的 capture (若有)。 */
  private releaseActivePointer(): void {
    if (this.activePointerId === null) return;
    this.emit({ type: 'capture', pointerId: this.activePointerId, capture: false });
    this.activePointerId = null;
  }

  /** 双指出现: 取消长按武装与 turn/pitch/Y 拖, 释放 capture, 把手势还给 OrbitControls pinch。 */
  private abortForMultiTouch(): void {
    this.clearArmTimer();
    this._pending = false;
    if (this._dragging) this.endTurn();
    if (this._guideDragging) this.endGuideDrag();
    this.releaseActivePointer();
    this.syncCursorAndNotify();
  }

  private enterAdjustMode(pointerId: number): void {
    const was = this._armed;
    this._armed = true;
    this._pending = true;
    this._modifierActive = true;
    this.activePointerId = pointerId;
    if (!was) this.emit({ type: 'arm-changed', armed: true });
    this.emit({ type: 'capture', pointerId, capture: true });
    this.bumpAutoHide();
    this.syncCursorAndNotify();
  }

  private beginTurn(x: number, y: number, pointerId: number): void {
    this._pending = false;
    this._dragging = true;
    this.dragStartX = x;
    this.dragStartY = y;
    this.activePointerId = pointerId;
    this.emit({ type: 'turn-start', x, y, pointerId });
    this.emit({ type: 'capture', pointerId, capture: true });
    this.bumpAutoHide();
    this.syncCursorAndNotify();
  }

  private startGuideDrag(s: PointerSample): void {
    this._pending = false;
    this._guideDragging = true;
    this.guideLastY = s.y;
    this.emit({ type: 'guide-drag-start' });
    this.emit({ type: 'capture', pointerId: s.pointerId, capture: true });
    this.bumpAutoHide();
    this.syncCursor();
  }
}
