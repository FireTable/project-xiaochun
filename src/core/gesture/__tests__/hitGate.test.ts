import { describe, expect, it } from 'vitest';
import { HIT_MIN_INTERVAL_MS, HIT_RELEASE_MS, HitGate } from '../hitGate';
import type { HitChangedEvent } from '../types';
import { FakeClock, flushMicrotasks } from './helpers';

function setup() {
  const clock = new FakeClock();
  const events: HitChangedEvent[] = [];
  const calls: Array<{ x: number; y: number; resolve: (hit: boolean) => void }> = [];
  let disposed = false;
  const gate = new HitGate({
    clock,
    isDisposed: () => disposed,
    emit: (ev) => events.push(ev),
    test: (x, y) => new Promise<boolean>((resolve) => { calls.push({ x, y, resolve }); }),
  });
  /** 走到下一帧并让 test 的 promise 回调执行。 */
  const frame = async () => { clock.advance(16); await flushMicrotasks(); };
  return { clock, gate, events, calls, frame, dispose: () => { disposed = true; } };
}

describe('常量 (36805ce 修复后的值, 不得改动)', () => {
  it('HIT_RELEASE_MS=160, HIT_MIN_INTERVAL_MS=33', () => {
    expect(HIT_RELEASE_MS).toBe(160);
    expect(HIT_MIN_INTERVAL_MS).toBe(33);
  });
});

describe('rAF 合并 + 最小间隔', () => {
  it('同一帧内多次 report 只检测一次, 用最新坐标', async () => {
    const { gate, calls, frame } = setup();
    gate.report(10, 10);
    gate.report(20, 20);
    gate.report(30, 30);
    expect(calls.length).toBe(0);
    await frame();
    expect(calls.map((c) => [c.x, c.y])).toEqual([[30, 30]]);
  });

  it('距上次检测 < 33ms 时延后到间隔满再检测', async () => {
    const { clock, gate, calls, frame } = setup();
    gate.report(10, 10);
    await frame(); // 检测发生在 t=16
    expect(calls.length).toBe(1);
    clock.advance(4); // t=20, 距上次 4ms
    gate.report(50, 50);
    clock.advance(16); // t=36: 距上次 20ms < 33
    await flushMicrotasks();
    expect(calls.length).toBe(1);
    clock.advance(40);
    await flushMicrotasks();
    expect(calls.length).toBe(2);
    expect(calls[1]).toMatchObject({ x: 50, y: 50 });
  });

  it('指针几乎没动 (<1px) 且不是宿主发起时跳过; 宿主发起总是检测', async () => {
    const { clock, gate, calls, frame } = setup();
    gate.report(10, 10);
    await frame();
    clock.advance(100);
    gate.report(10.5, 10.4);
    await frame();
    expect(calls.length).toBe(1);
    clock.advance(100);
    gate.report(10.5, 10.4, true);
    await frame();
    expect(calls.length).toBe(2);
  });
});

describe('命中 / 迟滞', () => {
  it('命中立即上报, 重复命中不再重复上报', async () => {
    const { clock, gate, events, calls, frame } = setup();
    gate.report(10, 10);
    await frame();
    calls[0].resolve(true);
    await flushMicrotasks();
    expect(events).toEqual([{ type: 'hit-changed', hit: true, x: 10, y: 10 }]);
    clock.advance(100);
    gate.report(40, 40);
    await frame();
    calls[1].resolve(true);
    await flushMicrotasks();
    expect(events.length).toBe(1);
  });

  it('未命中延迟 160ms 才上报离开; 期间再次命中则取消', async () => {
    const { clock, gate, events, calls, frame } = setup();
    gate.report(10, 10);
    await frame();
    calls[0].resolve(true);
    await flushMicrotasks();
    events.length = 0;

    clock.advance(100);
    gate.report(80, 80);
    await frame();
    calls[1].resolve(false);
    await flushMicrotasks();
    clock.advance(HIT_RELEASE_MS - 1);
    expect(events).toEqual([]);
    clock.advance(1);
    expect(events).toEqual([{ type: 'hit-changed', hit: false, x: 80, y: 80 }]);

    // 再来一轮: 命中 → 未命中 → 160ms 内又命中 = 不离开
    gate.report(10, 10);
    clock.advance(100);
    await frame();
    calls[2].resolve(true);
    await flushMicrotasks();
    events.length = 0;
    clock.advance(100);
    gate.report(90, 90);
    await frame();
    calls[3].resolve(false);
    await flushMicrotasks();
    clock.advance(100);
    gate.report(12, 12);
    await frame();
    calls[4].resolve(true);
    await flushMicrotasks();
    clock.advance(1000);
    expect(events).toEqual([]);
  });

  it('按住鼠标 (buttons != 0) 时未命中不触发离开', async () => {
    const { clock, gate, events, calls, frame } = setup();
    gate.report(10, 10);
    await frame();
    calls[0].resolve(true);
    await flushMicrotasks();
    events.length = 0;
    clock.advance(100);
    gate.report(90, 90, false, 1);
    await frame();
    calls[1].resolve(false);
    await flushMicrotasks();
    clock.advance(1000);
    expect(events).toEqual([]);
  });

  it('宿主发起 + 已命中: 重发一次 hit=true (resend) 让宿主对齐', async () => {
    const { clock, gate, events, calls, frame } = setup();
    gate.report(10, 10);
    await frame();
    calls[0].resolve(true);
    await flushMicrotasks();
    events.length = 0;
    clock.advance(100);
    gate.report(10, 10, true);
    await frame();
    calls[1].resolve(true);
    await flushMicrotasks();
    expect(events).toEqual([{ type: 'hit-changed', hit: true, x: 10, y: 10, resend: true }]);
  });

  it('更新的检测已发出时丢弃旧结果 (hitSeq)', async () => {
    const { clock, gate, events, calls, frame } = setup();
    gate.report(10, 10);
    await frame();
    clock.advance(100);
    gate.report(50, 50);
    await frame();
    expect(calls.length).toBe(2);
    calls[0].resolve(true); // 旧结果, 应丢弃
    await flushMicrotasks();
    expect(events).toEqual([]);
    calls[1].resolve(true);
    await flushMicrotasks();
    expect(events).toEqual([{ type: 'hit-changed', hit: true, x: 50, y: 50 }]);
  });
});

describe('leave / dispose', () => {
  it('leave: 立即上报 (false, -1, -1) 一次, 并作废在途检测', async () => {
    const { clock, gate, events, calls, frame } = setup();
    gate.report(10, 10);
    await frame();
    calls[0].resolve(true);
    await flushMicrotasks();
    events.length = 0;
    clock.advance(100);
    gate.report(20, 20);
    await frame();
    gate.leave();
    expect(events).toEqual([{ type: 'hit-changed', hit: false, x: -1, y: -1 }]);
    calls[1].resolve(true); // 在途结果被 hitSeq 作废
    await flushMicrotasks();
    expect(events.length).toBe(1);
    gate.leave();
    expect(events.length).toBe(1);
  });

  it('宿主销毁后结果被丢弃; dispose 取消排队中的定时器', async () => {
    const a = setup();
    a.gate.report(10, 10);
    await a.frame();
    a.dispose();
    a.calls[0].resolve(true);
    await flushMicrotasks();
    expect(a.events).toEqual([]);

    const b = setup();
    b.gate.report(10, 10);
    b.gate.dispose();
    expect(b.clock.pending).toBe(0);
  });
});

describe('reset / forgetTested (embed 切场景 / 菜单关闭后重判)', () => {
  it('forgetTested: 同一坐标可以被重新检测 (默认 <1px 会跳过), 命中状态与迟滞保留', async () => {
    const { clock, gate, events, calls, frame } = setup();
    gate.report(10, 10);
    await frame();
    calls[0].resolve(true);
    await flushMicrotasks();
    clock.advance(100);
    gate.report(10, 10);
    await frame();
    expect(calls.length).toBe(1); // 同坐标跳过
    gate.forgetTested();
    clock.advance(100);
    gate.report(10, 10);
    await frame();
    expect(calls.length).toBe(2);
    calls[1].resolve(false); // 仍在迟滞里: 160ms 后才上报离开
    await flushMicrotasks();
    expect(events.length).toBe(1);
    clock.advance(HIT_RELEASE_MS);
    expect(events[events.length - 1]).toEqual({ type: 'hit-changed', hit: false, x: 10, y: 10 });
  });

  it('reset: 作废命中状态与坐标, 之后的第一次命中重新上报 (不被去重吞掉)', async () => {
    const { clock, gate, events, calls, frame } = setup();
    gate.report(10, 10);
    await frame();
    calls[0].resolve(true);
    await flushMicrotasks();
    expect(events.length).toBe(1);
    gate.reset();
    clock.advance(100);
    gate.report(10, 10);
    await frame();
    expect(calls.length).toBe(2); // 同坐标也会重新检测
    calls[1].resolve(true);
    await flushMicrotasks();
    expect(events.length).toBe(2);
    expect(events[1]).toEqual({ type: 'hit-changed', hit: true, x: 10, y: 10 });
  });
});
