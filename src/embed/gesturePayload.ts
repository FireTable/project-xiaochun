/**
 * embed/gesturePayload.ts — xc.gesture-move / xc.gesture-resize 的序号与载荷生成 (纯 TS, 零 DOM, 可单测)。
 *
 * 规则 (协议见 packages/project-xiaochun/src/protocol.ts 的 XcGestureBase):
 *   - 每次新手势 gesture +1 (从 1 起), seq 从 0 起, 同一手势内严格递增;
 *   - 第一条一定是 phase:'start' (累计量为 0), 之后若干 'move', 最后一条 'end' (带 reason);
 *   - 没有进行中的手势时 step / end 返回 null (调用方不发消息)。
 */
import type { XcGestureBase } from '@firetable/project-xiaochun/protocol';

export class GestureSequencer {
  private gesture = 0;
  private seq = 0;
  private active = false;

  get running(): boolean { return this.active; }

  /** 开始一个新手势 (若上一个没收尾, 先视为被取消: 调用方应先 end)。 */
  begin(): XcGestureBase {
    this.gesture++;
    this.seq = 0;
    this.active = true;
    return { gesture: this.gesture, seq: 0, phase: 'start', dx: 0, dy: 0, totalDx: 0, totalDy: 0 };
  }

  step(dx: number, dy: number, totalDx: number, totalDy: number): XcGestureBase | null {
    if (!this.active) return null;
    return { gesture: this.gesture, seq: ++this.seq, phase: 'move', dx, dy, totalDx, totalDy };
  }

  end(reason: 'up' | 'cancel' | 'blur', totalDx = 0, totalDy = 0): XcGestureBase | null {
    if (!this.active) return null;
    this.active = false;
    return { gesture: this.gesture, seq: ++this.seq, phase: 'end', dx: 0, dy: 0, totalDx, totalDy, reason };
  }
}
