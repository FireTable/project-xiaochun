/**
 * embed/gestures.ts — /embed 的 iframe 手势适配器 (Embed 版的 adapters/tauriWindow.ts)。
 *
 * 目的: 让 iframe 拥有和 Tauri 桌宠一样的体验 —— 左键拖角色 = 移动, 拖四角 = 缩放。
 * 识别逻辑**不另写**, 全部复用 src/core/gesture/:
 *   - 移动: GestureMachine 的 'delta' 策略 (10px 阈值 / 480ms 长按武装 / 多点触控 全部沿用), 经 InteractionController.setMoveSink 转出 move-start/-delta/-end;
 *   - 缩放: ResizeGesture('delta') + corners.ts 的角落热区 (与 TauriWindowFrame 同一个 40px 热区 / 同一套光标与弧线外观);
 *   - 穿透命中: 角落热区由 bridge 的 HitGate.test 算命中 (isInCornerZone), 透明场景下只有点在角色 / 角落 / 内置按钮上才接管。
 * 本层只做: 宿主开关 → 事件落成 xc.gesture-move / xc.gesture-resize 消息 (实际移动 / 缩放由宿主 SDK 执行并限幅)、选中蓝框修复、角落弧线的显隐状态。
 *
 * 宿主不开 (默认): 不加任何监听、setMoveSink(null) → GestureMachine 保持 'none' 策略, 不拦截任何指针事件。
 */
import { CORNER_CURSOR, CORNER_HIT_SIZE, ResizeGesture, cornerAt, type GestureEvent, type ResizeCorner } from '@/core/gesture';
import { fillPointerSample, newPointerSample } from '@/core/gesture/adapters/domSample';
import type { XcGestureMovePayload, XcGestureResizePayload } from '@firetable/project-xiaochun/protocol';
import { GestureSequencer } from './gesturePayload';

export interface EmbedGestureDeps {
  sendMove(p: XcGestureMovePayload): void;
  sendResize(p: XcGestureResizePayload): void;
  /** (x, y) 是否压在内置按钮 / 菜单上 (这些元素自己处理点击, 不能被当成缩放热区 / 拖动起点)。 */
  isOverUi(x: number, y: number): boolean;
  /** 引擎的交互控制器 (只用 setMoveSink)。 */
  interaction: { setMoveSink(sink: ((ev: GestureEvent) => void) | null): void };
}

export interface EmbedGestureFlags { move: boolean; resize: boolean }

// ── 角落弧线 UI 状态仓 (给 React useSyncExternalStore; EmbedCorners 读) ──
export interface EmbedCornerUi {
  /** 宿主开了缩放: 才渲染弧线。 */
  enabled: boolean;
  /** 指针正悬停的角 (命中热区且不在按钮上)。 */
  hover: ResizeCorner | null;
  /** 正在被拖的角。 */
  active: ResizeCorner | null;
  /** 触屏没有 hover: 按下后短暂亮一下四个角, 提示这里能缩放。 */
  flash: boolean;
}
let cornerUi: EmbedCornerUi = { enabled: false, hover: null, active: null, flash: false };
const cornerListeners = new Set<() => void>();
export function getEmbedCornerUi(): EmbedCornerUi { return cornerUi; }
export function subscribeEmbedCornerUi(cb: () => void): () => void {
  cornerListeners.add(cb);
  return () => { cornerListeners.delete(cb); };
}
function setCornerUi(next: Partial<EmbedCornerUi>): void {
  const merged = { ...cornerUi, ...next };
  if (merged.enabled === cornerUi.enabled && merged.hover === cornerUi.hover && merged.active === cornerUi.active && merged.flash === cornerUi.flash) return;
  cornerUi = merged;
  cornerListeners.forEach((l) => l());
}

const FLASH_MS = 2500;

export class EmbedGestures {
  private deps: EmbedGestureDeps;
  private flags: EmbedGestureFlags = { move: false, resize: false };
  private moveSeq = new GestureSequencer();
  private resizeSeq = new GestureSequencer();
  private resize = new ResizeGesture('delta');
  private resizeOff: (() => void) | null = null;
  private sample = newPointerSample();
  private listening = false;
  private flashTimer: ReturnType<typeof setTimeout> | null = null;
  private lastTotals = { move: { x: 0, y: 0 }, resize: { x: 0, y: 0 } };
  private resizePointer: { id: number; target: Element | null } | null = null;

  constructor(deps: EmbedGestureDeps) {
    this.deps = deps;
    this.resizeOff = this.resize.on((ev) => this.onResizeEvent(ev));
  }

  get enabled(): EmbedGestureFlags { return { ...this.flags }; }

  /** 宿主开关 (xc.init config / xc.setConfig{gestures})。只传想改的字段。 */
  setEnabled(next: Partial<EmbedGestureFlags>): void {
    const prev = this.flags;
    this.flags = { move: next.move ?? prev.move, resize: next.resize ?? prev.resize };
    if (prev.move && !this.flags.move) this.moveSeqEnd('cancel');
    if (prev.resize && !this.flags.resize) this.resize.end('cancel');
    this.deps.interaction.setMoveSink(this.flags.move ? (ev) => this.onMoveEvent(ev) : null);
    setCornerUi({ enabled: this.flags.resize, ...(this.flags.resize ? {} : { hover: null, active: null, flash: false }) });
    if (!this.flags.resize) this.setCursor(null);
    else if (!prev.resize) this.flashCorners(); // 刚被宿主打开: 亮一下, 告诉用户四角能拖 (对应 Tauri 唤出 UI 时的 corner-flash)
    const want = this.flags.move || this.flags.resize;
    if (want && !this.listening) this.attach();
    else if (!want && this.listening) this.detach();
  }

  dispose(): void {
    this.resize.end('cancel');
    this.moveSeqEnd('cancel');
    this.deps.interaction.setMoveSink(null);
    this.detach();
    this.resizeOff?.();
    this.resize.dispose();
    this.flags = { move: false, resize: false };
    setCornerUi({ enabled: false, hover: null, active: null, flash: false });
    this.setCursor(null);
  }

  // ── 移动 (GestureMachine delta 策略的出口) ──
  private onMoveEvent(ev: GestureEvent): void {
    if (ev.type === 'move-start') {
      this.moveSeqEnd('cancel'); // 上一个没收尾 (极端情况): 先结束
      this.lastTotals.move = { x: 0, y: 0 };
      this.deps.sendMove(this.moveSeq.begin());
    } else if (ev.type === 'move-delta') {
      this.lastTotals.move = { x: ev.totalDx, y: ev.totalDy };
      const p = this.moveSeq.step(ev.dx, ev.dy, ev.totalDx, ev.totalDy);
      if (p) this.deps.sendMove(p);
    } else if (ev.type === 'move-end') {
      this.moveSeqEnd(ev.reason);
    }
  }
  private moveSeqEnd(reason: 'up' | 'cancel' | 'blur'): void {
    const p = this.moveSeq.end(reason, this.lastTotals.move.x, this.lastTotals.move.y);
    if (p) this.deps.sendMove(p);
  }

  // ── 缩放 (ResizeGesture delta 策略的出口) ──
  private onResizeEvent(ev: GestureEvent): void {
    if (ev.type === 'resize-start') {
      this.lastTotals.resize = { x: 0, y: 0 };
      setCornerUi({ active: ev.corner });
      this.setCursor(ev.corner);
      this.deps.sendResize({ ...this.resizeSeq.begin(), corner: ev.corner });
    } else if (ev.type === 'resize-delta') {
      this.lastTotals.resize = { x: ev.totalDx, y: ev.totalDy };
      const p = this.resizeSeq.step(ev.dx, ev.dy, ev.totalDx, ev.totalDy);
      if (p) this.deps.sendResize({ ...p, corner: ev.corner });
    } else if (ev.type === 'resize-end') {
      const p = this.resizeSeq.end(ev.reason, this.lastTotals.resize.x, this.lastTotals.resize.y);
      if (p) this.deps.sendResize({ ...p, corner: ev.corner });
      this.releaseResizePointer();
      setCornerUi({ active: null });
      this.setCursor(null);
    }
  }

  // ── DOM 监听 (只在宿主开了任一手势时存在) ──
  private onDownCapture = (e: PointerEvent): void => {
    if (e.pointerType === 'touch') this.flashCorners();
    if (e.button !== 0) return;
    if (this.flags.resize && !this.resize.resizing) {
      const corner = cornerAt(e.clientX, e.clientY, window.innerWidth, window.innerHeight, CORNER_HIT_SIZE);
      if (corner && !this.deps.isOverUi(e.clientX, e.clientY)) {
        // 角落热区: 接管这次按下 (不再往下传给 canvas, GestureMachine / OrbitControls 都不会看到)
        e.preventDefault();
        e.stopPropagation();
        const target = e.target instanceof Element ? e.target : null;
        try { target?.setPointerCapture?.(e.pointerId); this.resizePointer = { id: e.pointerId, target }; } catch { this.resizePointer = null; }
        this.resize.begin(corner, fillPointerSample(this.sample, e, false));
        return;
      }
    }
    // 修复"选中蓝框": 在 canvas 上按下就阻止默认行为 (文本选择 / 原生拖拽图片 / 焦点环); pointerdown 的 preventDefault 不影响 OrbitControls 等 pointer 监听
    if (this.flags.move && e.target instanceof HTMLCanvasElement) e.preventDefault();
  };
  private onMove = (e: PointerEvent): void => {
    if (this.resize.resizing) {
      this.resize.move(fillPointerSample(this.sample, e, false));
      return;
    }
    if (!this.flags.resize || e.buttons !== 0) return;
    const c = cornerAt(e.clientX, e.clientY, window.innerWidth, window.innerHeight, CORNER_HIT_SIZE);
    const hover = c && !this.deps.isOverUi(e.clientX, e.clientY) ? c : null;
    setCornerUi({ hover });
    this.setCursor(hover);
  };
  private onUp = (e: PointerEvent): void => {
    if (this.resize.resizing) this.resize.end('up');
    void e;
  };
  private onCancel = (): void => { if (this.resize.resizing) this.resize.end('cancel'); };
  private onBlur = (): void => { if (this.resize.resizing) this.resize.end('blur'); };
  private onLeave = (): void => { setCornerUi({ hover: null }); if (!this.resize.resizing) this.setCursor(null); };
  /** 指针进入 iframe (桌面鼠标): 四角短暂亮一下 (Tauri 唤出 UI 时 corner-flash 同款; 触屏在 pointerdown 里闪)。 */
  private onEnter = (e: MouseEvent): void => { if ((e as MouseEvent & { pointerType?: string }).pointerType !== 'touch' && !this.resize.resizing) this.flashCorners(); };
  private onSelect = (e: Event): void => { e.preventDefault(); };
  /** usePetUiVisibility 唤出内置界面时发的 corner-flash (Tauri 桌宠同款): 四角弧线也亮一下; 收起 (pet-ui-hide) 时立即灭。 */
  private onPetUiFlash = (): void => this.flashCorners();
  private onPetUiHide = (): void => {
    if (this.flashTimer) { clearTimeout(this.flashTimer); this.flashTimer = null; }
    setCornerUi({ flash: false });
  };

  private attach(): void {
    this.listening = true;
    window.addEventListener('pointerdown', this.onDownCapture, { capture: true });
    window.addEventListener('pointermove', this.onMove, { passive: true });
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('pointercancel', this.onCancel);
    window.addEventListener('blur', this.onBlur);
    document.documentElement.addEventListener('mouseleave', this.onLeave);
    document.documentElement.addEventListener('mouseenter', this.onEnter);
    document.addEventListener('selectstart', this.onSelect);
    window.addEventListener('corner-flash', this.onPetUiFlash);
    window.addEventListener('pet-ui-hide', this.onPetUiHide);
    document.addEventListener('dragstart', this.onSelect);
    document.documentElement.classList.add('xc-gestures');
  }
  private detach(): void {
    this.listening = false;
    window.removeEventListener('pointerdown', this.onDownCapture, { capture: true });
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
    window.removeEventListener('pointercancel', this.onCancel);
    window.removeEventListener('blur', this.onBlur);
    document.documentElement.removeEventListener('mouseleave', this.onLeave);
    document.documentElement.removeEventListener('mouseenter', this.onEnter);
    document.removeEventListener('selectstart', this.onSelect);
    window.removeEventListener('corner-flash', this.onPetUiFlash);
    window.removeEventListener('pet-ui-hide', this.onPetUiHide);
    document.removeEventListener('dragstart', this.onSelect);
    document.documentElement.classList.remove('xc-gestures');
    if (this.flashTimer) { clearTimeout(this.flashTimer); this.flashTimer = null; }
  }

  private releaseResizePointer(): void {
    const p = this.resizePointer;
    this.resizePointer = null;
    if (!p?.target) return;
    try { if (p.target.hasPointerCapture?.(p.id)) p.target.releasePointerCapture(p.id); } catch { /* ignore */ }
  }
  private setCursor(corner: ResizeCorner | null): void {
    if (typeof document === 'undefined') return;
    document.documentElement.style.cursor = corner ? CORNER_CURSOR[corner] : '';
  }
  private flashCorners(): void {
    if (!this.flags.resize) return;
    setCornerUi({ flash: true });
    if (this.flashTimer) clearTimeout(this.flashTimer);
    this.flashTimer = setTimeout(() => { this.flashTimer = null; setCornerUi({ flash: false }); }, FLASH_MS);
  }
}
