/**
 * gesture/types.ts — 与宿主无关的手势层类型 (纯类型, 零 DOM 依赖)。
 *
 * 分层:
 *   输入   PointerSample (适配器把 PointerEvent / MouseEvent 转成它)
 *   逻辑   GestureMachine / ResizeGesture / HitGate (本目录, 不碰 DOM、不碰 Tauri)
 *   输出   GestureEvent (语义事件, 由宿主适配器 / InteractionController 消费)
 *
 * 宿主适配器:
 *   - Tauri:  adapters/tauriWindow.ts  (startDragging / startResizeDragging / passthroughManager)
 *   - Embed:  src/embed/gestures.ts (delta 策略 → xc.gesture-move / xc.gesture-resize 消息 → SDK 改 iframe 位置/尺寸)
 */

export type ResizeCorner = 'NW' | 'NE' | 'SW' | 'SE';

/** 窗口移动的执行方式。 */
export type MoveStrategy =
  /** 宿主自己接管 (Tauri startDragging): 只发一次 move-start, 之后没有 delta。 */
  | 'native'
  /** 逻辑层出 delta (Embed: SDK 据此改 iframe 位置): move-start → move-delta* → move-end。 */
  | 'delta'
  /** 不处理 (普通浏览器): 超过阈值只取消长按, 不发 move-*。 */
  | 'none';

export interface GestureConfig {
  /** 长按武装时长 (ms)。 */
  armMs: number;
  /** 长按期间允许的最大位移 (px); 严格大于才算"移动"。 */
  slopPx: number;
  /** 武装后无操作自动收起导轨的空闲时长 (ms)。 */
  hideMs: number;
  /** 超过 slop 后如何处理窗口移动。可传函数, 在判定那一刻才取值 (如 isTauri())。 */
  moveStrategy: MoveStrategy | (() => MoveStrategy);
}

/** 宿主无关的指针样本。x/y 为 client 坐标, screenX/Y 为屏幕坐标 (iframe 被移动时坐标稳定)。 */
export interface PointerSample {
  pointerId: number;
  /** 'mouse' | 'touch' | 'pen' */
  pointerType: string;
  button: number;
  x: number;
  y: number;
  screenX: number;
  screenY: number;
  /** 平台主修饰键 (macOS ⌘ / 其余 Ctrl) 是否按下。 */
  modifier: boolean;
}

/** 手势层需要向宿主问的"命中"问题。 */
export interface GestureProbe {
  /** (x, y) 是否落在 3D 导轨 (相机 Y 尺) 的可拾取物上。 */
  isGuideHit(x: number, y: number): boolean;
}

/** 可注入的定时器 (测试用假时钟)。 */
export interface GestureClock {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

/** 事件处理函数对 DOM 事件的建议动作 (逻辑层不碰 DOM, 由适配器执行)。 */
export interface GestureResponse {
  preventDefault?: boolean;
  stopPropagation?: boolean;
}

export type MoveStartEvent = {
  type: 'move-start';
  strategy: Exclude<MoveStrategy, 'none'>;
  pointerId: number;
  x: number;
  y: number;
  screenX: number;
  screenY: number;
};

export type GestureEvent =
  // ── 长按武装 ──
  | { type: 'arm-changed'; armed: boolean }
  // ── 窗口 / 元素移动 ──
  | MoveStartEvent
  | { type: 'move-delta'; dx: number; dy: number; totalDx: number; totalDy: number }
  | { type: 'move-end'; reason: 'up' | 'cancel' | 'blur' }
  // ── 缩放 ──
  | { type: 'resize-start'; strategy: Exclude<MoveStrategy, 'none'>; corner: ResizeCorner; pointerId: number; screenX: number; screenY: number }
  | { type: 'resize-delta'; corner: ResizeCorner; dx: number; dy: number; totalDx: number; totalDy: number }
  | { type: 'resize-end'; corner: ResizeCorner; reason: 'up' | 'cancel' | 'blur' }
  // ── 转身 / 俯仰 (角色身体拖动) ──
  | { type: 'turn-start'; x: number; y: number; pointerId: number }
  | { type: 'turn'; dx: number; dy: number }
  | { type: 'turn-end' }
  // ── 相机 Y 导轨拖动 ──
  | { type: 'guide-drag-start' }
  | { type: 'guide-drag'; dy: number }
  | { type: 'guide-drag-end' }
  // ── 命中变化 (由 HitGate 产出) ──
  | HitChangedEvent
  // ── 需要适配器执行的指针捕获 ──
  | { type: 'capture'; pointerId: number; capture: boolean }
  // ── 状态同步: 与旧 InteractionController 的 updateCursor()/notifyStateChange()/syncGuidePassthrough() 调用点一一对应 ──
  | { type: 'state-changed'; cursor: boolean; notify: boolean; passthrough: boolean; dx: number; dy: number };

export type HitChangedEvent = {
  type: 'hit-changed';
  hit: boolean;
  x: number;
  y: number;
  /** true = 命中状态没变, 只是宿主发起的检测, 重发一次让宿主对齐 (宿主可能已把 iframe 切回 none)。 */
  resend?: boolean;
};

export type GestureListener = (ev: GestureEvent) => void;
