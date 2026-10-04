/**
 * 抽取前的手势判定逻辑 (逐行搬自 main 上的 src/core/interaction/interactionController.ts, commit 36805ce),
 * 仅把 DOM / three / Tauri 副作用换成"记录调用"。用于差分测试: 同一串输入喂给它和新的 GestureMachine,
 * 副作用序列与状态必须逐项相同 —— 证明抽取没有改变行为。
 *
 * 记录的 token (顺序即调用顺序):
 *   cursor            updateCursor()
 *   passthrough:<b>   syncGuidePassthrough(capture=b)
 *   notify:<dx>,<dy>  notifyStateChange 的状态通知 (其前一定有 passthrough:<b>)
 *   cap+<id> / cap-<id>  setPointerCapture / releasePointerCapture (仅真正持有时才记 cap-)
 *   prevent / stop    e.preventDefault() / e.stopPropagation()
 *   nativeDrag        Tauri startWindowDragging
 *   turnStart         beginBodyDrag 里重置 lastDragDx/Dy
 *   turn:<dx>,<dy>    转身/俯仰位移 (含 lastDragDx/Dy 赋值)
 *   turnEnd           endDrag 尾部: 复位 lastDrag、setInteracting(false)、保存 yaw/pitch
 *   guideDy:<dy>      Y 导轨拖动的屏幕 dy
 */
import type { PointerSample } from '../types';

export interface LegacyClock {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(h: unknown): void;
}

export class LegacyRef {
  log: string[] = [];
  private captured = new Set<number>();

  isModifierActive = false;
  isLeftDragging = false;
  dragStartX = 0;
  dragStartY = 0;
  activePointerId: number | null = null;
  touchArmed = false;
  touchArmTimer: unknown = null;
  guideHideTimer: unknown = null;
  touchDownX = 0;
  touchDownY = 0;
  touchPendingDrag = false;
  activeTouchPointers = new Set<number>();
  isYGuideDragging = false;
  yGuideLastClientY = 0;
  yGuideHovered = false;

  private clock: LegacyClock;
  private cfg: { armMs: number; slopPx: number; hideMs: number; tauri: boolean };
  private raycast: (x: number, y: number) => boolean;

  constructor(
    clock: LegacyClock,
    cfg: { armMs: number; slopPx: number; hideMs: number; tauri: boolean },
    raycast: (x: number, y: number) => boolean,
  ) {
    this.clock = clock;
    this.cfg = cfg;
    this.raycast = raycast;
  }

  private rec(t: string) { this.log.push(t); }
  private updateCursor() { this.rec('cursor'); }
  private syncGuidePassthrough() {
    const capture = this.isModifierActive || this.touchArmed || this.touchPendingDrag || this.isLeftDragging || this.isYGuideDragging;
    this.rec(`passthrough:${capture}`);
  }
  private notifyStateChange(dx = 0, dy = 0) {
    this.syncGuidePassthrough();
    this.rec(`notify:${dx},${dy}`);
  }
  private setCapture(id: number) { this.captured.add(id); this.rec(`cap+${id}`); }
  private releaseIfHeld(id: number) {
    if (this.captured.has(id)) { this.captured.delete(id); this.rec(`cap-${id}`); }
  }

  private can3DInteract(s: PointerSample): boolean {
    if (s.modifier) return true;
    return this.touchArmed;
  }
  private clearGuideHideTimer() {
    if (this.guideHideTimer !== null) { this.clock.clearTimeout(this.guideHideTimer); this.guideHideTimer = null; }
  }
  private bumpGuideAutoHide() {
    this.clearGuideHideTimer();
    if (!this.touchArmed) return;
    this.guideHideTimer = this.clock.setTimeout(() => {
      this.guideHideTimer = null;
      if (this.isLeftDragging || this.isYGuideDragging || this.touchPendingDrag) {
        this.bumpGuideAutoHide();
        return;
      }
      this.clearTouchArm({ hideGuides: true });
      this.updateCursor();
      this.notifyStateChange();
    }, this.cfg.hideMs);
  }
  clearTouchArm(opts?: { hideGuides?: boolean }) {
    if (this.touchArmTimer !== null) { this.clock.clearTimeout(this.touchArmTimer); this.touchArmTimer = null; }
    this.clearGuideHideTimer();
    this.touchArmed = false;
    this.touchPendingDrag = false;
    if (opts?.hideGuides) this.isModifierActive = false;
    this.syncGuidePassthrough();
  }
  private isMultiTouchActive() { return this.activeTouchPointers.size >= 2; }
  private trackTouchPointerDown(s: PointerSample) { if (s.pointerType !== 'touch') return; this.activeTouchPointers.add(s.pointerId); }
  private trackTouchPointerUp(s: PointerSample) { if (s.pointerType !== 'touch') return; this.activeTouchPointers.delete(s.pointerId); }
  private abortTurnPitchForMultiTouch() {
    if (this.touchArmTimer !== null) { this.clock.clearTimeout(this.touchArmTimer); this.touchArmTimer = null; }
    this.touchPendingDrag = false;
    if (this.isLeftDragging) this.endDrag();
    if (this.isYGuideDragging) this.endYGuideDrag();
    if (this.activePointerId !== null) {
      this.releaseIfHeld(this.activePointerId);
      this.activePointerId = null;
    }
    this.updateCursor();
    this.notifyStateChange();
  }
  private enterTouchAdjustMode(pointerId: number) {
    this.touchArmed = true;
    this.touchPendingDrag = true;
    this.isModifierActive = true;
    this.activePointerId = pointerId;
    this.setCapture(pointerId);
    this.bumpGuideAutoHide();
    this.updateCursor();
    this.notifyStateChange();
  }
  private beginBodyDrag(x: number, y: number, pointerId: number) {
    this.touchPendingDrag = false;
    this.isLeftDragging = true;
    this.dragStartX = x;
    this.dragStartY = y;
    this.rec('turnStart');
    this.activePointerId = pointerId;
    this.setCapture(pointerId);
    this.bumpGuideAutoHide();
    this.updateCursor();
    this.notifyStateChange();
  }
  private startYGuideDrag(s: PointerSample) {
    this.touchPendingDrag = false;
    this.isYGuideDragging = true;
    this.yGuideLastClientY = s.y;
    this.setCapture(s.pointerId);
    this.bumpGuideAutoHide();
    this.updateCursor();
  }
  private endYGuideDrag() {
    if (!this.isYGuideDragging) return;
    this.isYGuideDragging = false;
    this.yGuideHovered = false;
    this.updateCursor();
    if (this.touchArmed) this.bumpGuideAutoHide();
  }
  endDrag() {
    if (!this.isLeftDragging) return;
    this.isLeftDragging = false;
    this.touchPendingDrag = false;
    if (this.activePointerId !== null) {
      this.releaseIfHeld(this.activePointerId);
      this.activePointerId = null;
    }
    this.rec('turnEnd');
  }
  endAll() { this.endDrag(); this.endYGuideDrag(); }

  // ── keys / blur ──
  keyDown(active: boolean) {
    if (active && !this.isModifierActive) {
      this.isModifierActive = true;
      this.updateCursor();
      this.notifyStateChange();
    }
  }
  keyUp(stillActive: boolean) {
    if (!stillActive && this.isModifierActive && !this.touchArmed) {
      this.isModifierActive = false;
      if (this.isLeftDragging) this.endDrag();
      if (this.isYGuideDragging) this.endYGuideDrag();
      this.updateCursor();
      this.notifyStateChange();
    }
  }
  blur() {
    if (this.isModifierActive || this.isLeftDragging || this.isYGuideDragging || this.touchArmed) {
      this.clearTouchArm({ hideGuides: true });
      this.isModifierActive = false;
      this.endDrag();
      this.endYGuideDrag();
      this.updateCursor();
      this.notifyStateChange();
    }
  }

  // ── pointer ──
  pointerDown(s: PointerSample) {
    if (s.button !== 0) return;
    this.trackTouchPointerDown(s);
    if (this.isMultiTouchActive()) { this.abortTurnPitchForMultiTouch(); return; }
    const hasMod = s.modifier;
    if (!hasMod && this.touchArmed) {
      this.rec('prevent');
      this.isModifierActive = true;
      if (this.raycast(s.x, s.y)) {
        this.startYGuideDrag(s);
        this.notifyStateChange();
        return;
      }
      this.beginBodyDrag(s.x, s.y, s.pointerId);
      return;
    }
    if (!hasMod) {
      if (this.touchArmTimer !== null) { this.clock.clearTimeout(this.touchArmTimer); this.touchArmTimer = null; }
      this.touchDownX = s.x;
      this.touchDownY = s.y;
      this.activePointerId = s.pointerId;
      const id = s.pointerId;
      this.touchArmTimer = this.clock.setTimeout(() => {
        this.touchArmTimer = null;
        this.enterTouchAdjustMode(id);
      }, this.cfg.armMs);
      return;
    }
    if (this.raycast(s.x, s.y)) {
      this.rec('prevent');
      this.rec('stop');
      this.isModifierActive = true;
      this.startYGuideDrag(s);
      return;
    }
    this.rec('prevent');
    this.isModifierActive = true;
    this.beginBodyDrag(s.x, s.y, s.pointerId);
  }

  pointerMove(s: PointerSample) {
    if (this.touchArmTimer !== null && this.activePointerId === s.pointerId) {
      const adx = s.x - this.touchDownX;
      const ady = s.y - this.touchDownY;
      if (Math.hypot(adx, ady) > this.cfg.slopPx) {
        this.clock.clearTimeout(this.touchArmTimer);
        this.touchArmTimer = null;
        this.activePointerId = null;
        if (this.cfg.tauri) this.rec('nativeDrag');
      }
      return;
    }
    if (s.pointerType === 'touch' && this.isMultiTouchActive()) { this.abortTurnPitchForMultiTouch(); return; }
    if (this.touchPendingDrag && this.touchArmed && this.activePointerId === s.pointerId) {
      const adx = s.x - this.touchDownX;
      const ady = s.y - this.touchDownY;
      if (Math.hypot(adx, ady) > this.cfg.slopPx) {
        this.rec('prevent');
        if (this.raycast(this.touchDownX, this.touchDownY)) {
          this.startYGuideDrag(s);
          this.notifyStateChange();
        } else {
          this.beginBodyDrag(s.x, s.y, s.pointerId);
        }
      }
      return;
    }
    if (this.isYGuideDragging) {
      this.rec('prevent');
      const dy = s.y - this.yGuideLastClientY;
      this.yGuideLastClientY = s.y;
      this.rec(`guideDy:${dy}`);
      this.bumpGuideAutoHide();
      return;
    }
    if (this.isModifierActive && !this.isLeftDragging) {
      this.yGuideHovered = this.raycast(s.x, s.y);
      this.updateCursor();
    }
    if (!this.isLeftDragging) {
      if (this.touchArmed) {
        if (!this.isModifierActive) {
          this.isModifierActive = true;
          this.updateCursor();
          this.notifyStateChange();
        }
        return;
      }
      const hasMod = s.modifier;
      if (hasMod !== this.isModifierActive) {
        this.isModifierActive = hasMod;
        this.updateCursor();
        this.notifyStateChange();
      }
      return;
    }
    if (s.pointerType === 'touch' && this.isMultiTouchActive()) { this.abortTurnPitchForMultiTouch(); return; }
    if (!this.can3DInteract(s)) {
      this.isModifierActive = false;
      this.endDrag();
      this.updateCursor();
      this.notifyStateChange();
      return;
    }
    this.rec('prevent');
    const dx = s.x - this.dragStartX;
    const dy = s.y - this.dragStartY;
    this.rec(`turn:${dx},${dy}`);
    this.dragStartX = s.x;
    this.dragStartY = s.y;
    this.bumpGuideAutoHide();
    this.notifyStateChange(dx, dy);
  }

  pointerUp(s: PointerSample) {
    this.trackTouchPointerUp(s);
    if (s.button !== 0) return;
    if (this.touchArmTimer !== null && this.activePointerId === s.pointerId) {
      this.clock.clearTimeout(this.touchArmTimer);
      this.touchArmTimer = null;
      this.activePointerId = null;
      return;
    }
    if (this.isYGuideDragging) {
      this.endYGuideDrag();
      this.notifyStateChange();
      return;
    }
    if (this.touchPendingDrag && this.touchArmed) {
      this.touchPendingDrag = false;
      if (this.activePointerId !== null) {
        this.releaseIfHeld(this.activePointerId);
        this.activePointerId = null;
      }
      this.bumpGuideAutoHide();
      this.updateCursor();
      this.notifyStateChange();
      return;
    }
    this.endDrag();
    if (this.touchArmed) this.bumpGuideAutoHide();
    this.updateCursor();
    this.notifyStateChange();
  }

  pointerCancel(s?: PointerSample) {
    if (s) this.trackTouchPointerUp(s);
    else this.activeTouchPointers.clear();
    if (this.touchArmTimer !== null) { this.clock.clearTimeout(this.touchArmTimer); this.touchArmTimer = null; }
    this.touchPendingDrag = false;
    this.endDrag();
    this.endYGuideDrag();
    if (this.touchArmed) this.bumpGuideAutoHide();
    this.updateCursor();
    this.notifyStateChange();
  }
}
