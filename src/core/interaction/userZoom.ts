/**
 * 用户缩放手势识别 (纯逻辑)：只从真实的画布输入里产出“用户在缩放”事件，不看相机状态。
 *
 * 为什么不读相机视距的变化：导演运镜 (slow_push_in / orbit / dutch_tilt)、fitCamera、回到默认视角、阻尼回弹
 * 都会改视距，却不是用户在缩放。教学任务只认这里的事件：
 * - wheel：画布上的滚轮；
 * - pinch：两根手指 (指针) 间距变化；
 * - middle_drag：鼠标中键拖动 (OrbitControls 的 DOLLY 绑定)。
 */
export type UserZoomSource = 'wheel' | 'pinch' | 'middle_drag';

export interface UserZoomEvent {
  source: UserZoomSource;
  /** 本次输入的量：滚轮 = |deltaY|，其余 = 屏幕像素 */
  amount: number;
}

interface TrackedPointer {
  x: number;
  y: number;
  button: number;
}

export class UserZoomTracker {
  private pointers = new Map<number, TrackedPointer>();
  private pinchDistance: number | null = null;

  private readonly emit: (ev: UserZoomEvent) => void;

  constructor(emit: (ev: UserZoomEvent) => void) {
    this.emit = emit;
  }

  public wheel(deltaY: number): void {
    const amount = Math.abs(deltaY);
    if (amount > 0 && Number.isFinite(amount)) this.emit({ source: 'wheel', amount });
  }

  public pointerDown(id: number, x: number, y: number, button = 0): void {
    this.pointers.set(id, { x, y, button });
    this.pinchDistance = this.currentPinchDistance();
  }

  public pointerMove(id: number, x: number, y: number): void {
    const p = this.pointers.get(id);
    if (!p) return;
    const prevY = p.y;
    p.x = x;
    p.y = y;
    if (this.pointers.size >= 2) {
      const d = this.currentPinchDistance();
      if (d !== null && this.pinchDistance !== null) {
        const amount = Math.abs(d - this.pinchDistance);
        if (amount > 0) this.emit({ source: 'pinch', amount });
      }
      this.pinchDistance = d;
    } else if (p.button === 1) {
      const amount = Math.abs(y - prevY);
      if (amount > 0) this.emit({ source: 'middle_drag', amount });
    }
  }

  public pointerUp(id: number): void {
    this.pointers.delete(id);
    this.pinchDistance = this.currentPinchDistance();
  }

  public reset(): void {
    this.pointers.clear();
    this.pinchDistance = null;
  }

  private currentPinchDistance(): number | null {
    if (this.pointers.size < 2) return null;
    const [a, b] = [...this.pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  }
}
