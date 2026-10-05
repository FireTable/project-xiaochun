/**
 * ClickDetector — "单击" 判定 (纯 TS, 零 DOM 依赖; Tauri 桌宠 与 /embed iframe 共用, 见 src/hooks/usePetUiVisibility.ts)。
 *
 * 规则: 主指针左键 / 触摸按下 → 抬起, 整个过程中 **位移始终 ≤ CLICK_MAX_MOVE_PX** 才算单击; 一旦超过 (拖动 / 转身 / 窗口移动) 就不是单击, 回到原点也不算。
 * 位移取 client 坐标位移与 screen 坐标位移里较大的那个:
 *   - /embed 开了 draggable 时, 宿主在拖动中不断移动 iframe, 指针相对 iframe 的 client 坐标几乎不变 (指针和 iframe 一起走), 只有 screen 坐标能看出在拖;
 *   - Tauri 里两者等价 (窗口不动时), 取较大值不改变原行为。
 * 多指 (isPrimary=false)、非左键、pointercancel 都不产生单击。
 */

/** 超过这个位移就不是单击 (px)。与旧 usePetUiVisibility 的 CLICK_DEBOUNCE_PX 同值。 */
export const CLICK_MAX_MOVE_PX = 6;

export interface ClickSample {
  x: number;
  y: number;
  screenX: number;
  screenY: number;
  button: number;
  /** 触摸多指时只有第一根手指是 primary; 缺省按 true 处理。 */
  isPrimary?: boolean;
}

export class ClickDetector {
  private start: ClickSample | null = null;
  private moved = false;

  down(s: ClickSample): void {
    if (s.button !== 0 || s.isPrimary === false) { this.start = null; return; }
    this.start = s;
    this.moved = false;
  }

  move(s: ClickSample): void {
    if (!this.start || this.moved) return;
    if (this.dist(s) > CLICK_MAX_MOVE_PX) this.moved = true;
  }

  /** 抬起: 返回这次按下-抬起是否构成单击 (并结束本次跟踪)。 */
  up(s: ClickSample): boolean {
    const start = this.start;
    this.start = null;
    if (!start || s.button !== 0 || s.isPrimary === false) return false;
    if (this.moved) return false;
    return this.dist(s, start) <= CLICK_MAX_MOVE_PX;
  }

  cancel(): void {
    this.start = null;
    this.moved = false;
  }

  private dist(s: ClickSample, from: ClickSample | null = this.start): number {
    if (!from) return Infinity;
    const client = Math.hypot(s.x - from.x, s.y - from.y);
    const screen = Math.hypot(s.screenX - from.screenX, s.screenY - from.screenY);
    return Math.max(client, Number.isFinite(screen) ? screen : 0);
  }
}
