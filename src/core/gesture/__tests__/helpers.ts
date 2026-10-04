import type { GestureClock, GestureEvent, PointerSample } from '../types';
import type { HitGateClock } from '../hitGate';

interface Timer { id: number; at: number; fn: () => void }

/** 虚拟时钟: setTimeout / requestAnimationFrame (16ms 一帧) / performance.now 都由 advance() 驱动。句柄从 1 开始 (真值)。 */
export class FakeClock implements GestureClock, HitGateClock {
  private t = 10_000; // 模拟 performance.now() 已远大于最小间隔 (真实环境 lastHitTestAt 初值 0)
  private seq = 0;
  private timers: Timer[] = [];

  now(): number { return this.t; }

  setTimeout(fn: () => void, ms: number): unknown {
    const id = ++this.seq;
    this.timers.push({ id, at: this.t + Math.max(0, ms), fn });
    return id;
  }

  clearTimeout(h: unknown): void {
    this.timers = this.timers.filter((x) => x.id !== h);
  }

  requestAnimationFrame(fn: () => void): unknown {
    // 下一个 16ms 边界
    const next = (Math.floor(this.t / 16) + 1) * 16;
    const id = ++this.seq;
    this.timers.push({ id, at: next, fn });
    return id;
  }

  cancelAnimationFrame(h: unknown): void { this.clearTimeout(h); }

  get pending(): number { return this.timers.length; }

  /** 前进 ms 毫秒, 按时间顺序触发到期定时器。 */
  advance(ms: number): void {
    const end = this.t + ms;
    for (;;) {
      const due = this.timers.filter((x) => x.at <= end).sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (!due) break;
      this.timers = this.timers.filter((x) => x !== due);
      this.t = Math.max(this.t, due.at);
      due.fn();
    }
    this.t = end;
  }
}

export function sample(over: Partial<PointerSample> & { pointerId?: number } = {}): PointerSample {
  return {
    pointerId: 1,
    pointerType: 'mouse',
    button: 0,
    x: 100,
    y: 100,
    screenX: 100,
    screenY: 100,
    modifier: false,
    ...over,
  };
}

/** 让已 resolve 的 promise 回调跑完。 */
export async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

export function collect(on: (cb: (ev: GestureEvent) => void) => () => void): { events: GestureEvent[]; types: () => string[]; clear: () => void } {
  const events: GestureEvent[] = [];
  on((ev) => events.push(ev));
  return { events, types: () => events.map((e) => e.type), clear: () => { events.length = 0; } };
}
