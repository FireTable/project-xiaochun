import { describe, expect, it } from 'vitest';
import { GestureMachine } from '../gestureMachine';
import type { GestureConfig, GestureEvent, MoveStrategy } from '../types';
import { FakeClock, collect, sample } from './helpers';

// 与 src/lib/constants.ts 一致: 480ms / 10px / 2800ms
const CFG: GestureConfig = { armMs: 480, slopPx: 10, hideMs: 2800, moveStrategy: 'native' };

function setup(over: Partial<GestureConfig> = {}, guideHit: (x: number, y: number) => boolean = () => false) {
  const clock = new FakeClock();
  const m = new GestureMachine({ ...CFG, ...over }, { isGuideHit: guideHit }, clock);
  const rec = collect((cb) => m.on(cb));
  return { clock, m, rec };
}
const types = (evs: GestureEvent[]) => evs.map((e) => e.type);

describe('长按武装 480ms', () => {
  it('479ms 未武装, 480ms 武装并捕获指针', () => {
    const { clock, m, rec } = setup();
    m.pointerDown(sample({ x: 50, y: 50 }));
    clock.advance(479);
    expect(m.armed).toBe(false);
    expect(rec.types()).toEqual([]);
    clock.advance(1);
    expect(m.armed).toBe(true);
    expect(m.pending).toBe(true);
    expect(m.modifierActive).toBe(true);
    expect(rec.events).toContainEqual({ type: 'arm-changed', armed: true });
    expect(rec.events).toContainEqual({ type: 'capture', pointerId: 1, capture: true });
    expect(m.capturing).toBe(true);
  });

  it('非左键按下被忽略 (不启动计时)', () => {
    const { clock, m, rec } = setup();
    expect(m.pointerDown(sample({ button: 2 }))).toEqual({});
    clock.advance(1000);
    expect(m.armed).toBe(false);
    expect(rec.events).toEqual([]);
    expect(clock.pending).toBe(0);
  });

  it('480ms 内松手: 取消武装, 之后不再武装', () => {
    const { clock, m, rec } = setup();
    m.pointerDown(sample());
    clock.advance(300);
    m.pointerUp(sample());
    clock.advance(1000);
    expect(m.armed).toBe(false);
    expect(rec.events).toEqual([]);
  });

  it('武装后几乎没动就松手: 保持调整模式并释放 capture, 空闲 2800ms 后收起', () => {
    const { clock, m, rec } = setup();
    m.pointerDown(sample());
    clock.advance(480);
    rec.clear();
    m.pointerUp(sample());
    expect(m.armed).toBe(true);
    expect(m.pending).toBe(false);
    expect(rec.events).toContainEqual({ type: 'capture', pointerId: 1, capture: false });
    clock.advance(2799);
    expect(m.armed).toBe(true);
    rec.clear();
    clock.advance(1);
    expect(m.armed).toBe(false);
    expect(m.modifierActive).toBe(false);
    expect(rec.events).toContainEqual({ type: 'arm-changed', armed: false });
  });
});

describe('10px 阈值 (窗口移动 vs 转身)', () => {
  it('恰好 10px 不算移动, 仍会在 480ms 武装', () => {
    const { clock, m, rec } = setup();
    m.pointerDown(sample({ x: 0, y: 0 }));
    m.pointerMove(sample({ x: 10, y: 0 }));
    m.pointerMove(sample({ x: 6, y: 8 })); // hypot = 10
    expect(types(rec.events)).toEqual([]);
    clock.advance(480);
    expect(m.armed).toBe(true);
  });

  it('超过 10px (10.05): native 发一次 move-start 并取消长按', () => {
    const { clock, m, rec } = setup();
    m.pointerDown(sample({ x: 0, y: 0, screenX: 500, screenY: 600 }));
    m.pointerMove(sample({ x: 10.05, y: 0, screenX: 510, screenY: 600 }));
    expect(rec.events).toEqual([
      { type: 'move-start', strategy: 'native', pointerId: 1, x: 10.05, y: 0, screenX: 510, screenY: 600 },
    ]);
    clock.advance(2000);
    expect(m.armed).toBe(false);
    // 后续 move 不再有任何事件 (原生拖动由宿主接管)
    rec.clear();
    m.pointerMove(sample({ x: 300, y: 300 }));
    m.pointerUp(sample());
    expect(types(rec.events).filter((t) => t === 'move-start')).toEqual([]);
  });

  it('欧氏距离: (8,8)=11.3 超阈值, (7,7)=9.9 不超', () => {
    const a = setup();
    a.m.pointerDown(sample({ x: 0, y: 0 }));
    a.m.pointerMove(sample({ x: 7, y: 7 }));
    expect(a.rec.events).toEqual([]);
    const b = setup();
    b.m.pointerDown(sample({ x: 0, y: 0 }));
    b.m.pointerMove(sample({ x: 8, y: 8 }));
    expect(types(b.rec.events)).toEqual(['move-start']);
  });

  it('move-start 在 pointerMove 调用栈内同步发出 (Tauri startDragging 时序要求)', () => {
    const { m } = setup();
    let inside = false;
    let sawInside = false;
    m.on((ev) => { if (ev.type === 'move-start') sawInside = inside; });
    m.pointerDown(sample({ x: 0, y: 0 }));
    inside = true;
    m.pointerMove(sample({ x: 50, y: 0 }));
    inside = false;
    expect(sawInside).toBe(true);
  });

  it("moveStrategy 'none' (浏览器): 只取消长按, 不发 move-start", () => {
    const { clock, m, rec } = setup({ moveStrategy: 'none' });
    m.pointerDown(sample({ x: 0, y: 0 }));
    m.pointerMove(sample({ x: 50, y: 0 }));
    expect(rec.events).toEqual([]);
    clock.advance(2000);
    expect(m.armed).toBe(false);
  });

  it('moveStrategy 为函数时在判定那一刻才取值', () => {
    let strategy: MoveStrategy = 'none';
    const { m, rec } = setup({ moveStrategy: () => strategy });
    m.pointerDown(sample({ x: 0, y: 0 }));
    strategy = 'native';
    m.pointerMove(sample({ x: 50, y: 0 }));
    expect(types(rec.events)).toEqual(['move-start']);
  });

  it('其他 pointerId 的移动不影响正在计时的按下', () => {
    const { clock, m, rec } = setup();
    m.pointerDown(sample({ pointerId: 1, x: 0, y: 0 }));
    m.pointerMove(sample({ pointerId: 2, x: 500, y: 500 }));
    expect(types(rec.events).includes('move-start')).toBe(false);
    clock.advance(480);
    expect(m.armed).toBe(true);
  });
});

describe('武装后: 转身 / 俯仰 (bodyTurn) 与 Y 导轨', () => {
  function armed(guideHit: (x: number, y: number) => boolean = () => false) {
    const s = setup({}, guideHit);
    s.m.pointerDown(sample({ x: 100, y: 100 }));
    s.clock.advance(480);
    s.rec.clear();
    return s;
  }

  it('武装后位移 ≤ 10px 不开始转身, > 10px 才 turn-start', () => {
    const { m, rec } = armed();
    expect(m.pointerMove(sample({ x: 110, y: 100 }))).toEqual({});
    expect(rec.events).toEqual([]);
    const r = m.pointerMove(sample({ x: 111, y: 100 }));
    expect(r.preventDefault).toBe(true);
    expect(rec.events[0]).toEqual({ type: 'turn-start', x: 111, y: 100, pointerId: 1 });
    expect(m.dragging).toBe(true);
    expect(m.pending).toBe(false);
  });

  it('转身: 之后每次 move 发增量 turn{dx,dy}; 松手 turn-end 并释放 capture', () => {
    const { m, rec } = armed();
    m.pointerMove(sample({ x: 120, y: 100 })); // turn-start @120
    rec.clear();
    m.pointerMove(sample({ x: 125, y: 103 }));
    m.pointerMove(sample({ x: 123, y: 110 }));
    expect(rec.events.filter((e) => e.type === 'turn')).toEqual([
      { type: 'turn', dx: 5, dy: 3 },
      { type: 'turn', dx: -2, dy: 7 },
    ]);
    rec.clear();
    m.pointerUp(sample());
    expect(m.dragging).toBe(false);
    expect(types(rec.events)).toContain('turn-end');
    expect(rec.events).toContainEqual({ type: 'capture', pointerId: 1, capture: false });
  });

  it('按下点落在 Y 导轨上: 开始 guide 拖动而不是转身, 发 dy', () => {
    const { m, rec } = armed((x, y) => x === 100 && y === 100);
    m.pointerMove(sample({ x: 100, y: 130 }));
    expect(types(rec.events)).toContain('guide-drag-start');
    expect(m.guideDragging).toBe(true);
    expect(m.dragging).toBe(false);
    rec.clear();
    m.pointerMove(sample({ x: 100, y: 140 }));
    m.pointerMove(sample({ x: 100, y: 135 }));
    expect(rec.events.filter((e) => e.type === 'guide-drag')).toEqual([
      { type: 'guide-drag', dy: 10 },
      { type: 'guide-drag', dy: -5 },
    ]);
    m.pointerUp(sample());
    expect(m.guideDragging).toBe(false);
    expect(m.armed).toBe(true); // 仍在调整模式
  });

  it('已武装再次按下: 导轨优先, 否则直接开始转身', () => {
    const a = armed();
    a.m.pointerUp(sample()); // 保持武装
    a.rec.clear();
    const r = a.m.pointerDown(sample({ x: 200, y: 200 }));
    expect(r.preventDefault).toBe(true);
    expect(types(a.rec.events)).toContain('turn-start');

    const b = armed((x, y) => x === 200 && y === 200);
    b.m.pointerUp(sample());
    b.rec.clear();
    b.m.pointerDown(sample({ x: 200, y: 200 }));
    expect(types(b.rec.events)).toContain('guide-drag-start');
    expect(b.m.guideDragging).toBe(true);
  });

  it('拖动期间不会自动收起, 松手后再等 2800ms', () => {
    const { clock, m } = armed();
    m.pointerMove(sample({ x: 150, y: 100 })); // turn-start
    clock.advance(2800 * 3);
    expect(m.armed).toBe(true);
    m.pointerUp(sample());
    clock.advance(2799);
    expect(m.armed).toBe(true);
    clock.advance(1);
    expect(m.armed).toBe(false);
  });
});

describe('修饰键 (Cmd/Ctrl) 即时 3D', () => {
  it('按下即 turn-start, 不启动长按计时', () => {
    const { clock, m, rec } = setup();
    const r = m.pointerDown(sample({ modifier: true }));
    expect(r).toEqual({ preventDefault: true });
    expect(types(rec.events)).toContain('turn-start');
    expect(m.dragging).toBe(true);
    expect(m.modifierActive).toBe(true);
    clock.advance(1000);
    expect(m.armed).toBe(false);
  });

  it('导轨优先, 且要 stopPropagation', () => {
    const { m, rec } = setup({}, () => true);
    const r = m.pointerDown(sample({ modifier: true }));
    expect(r).toEqual({ preventDefault: true, stopPropagation: true });
    expect(types(rec.events)).toContain('guide-drag-start');
    expect(m.guideDragging).toBe(true);
  });

  it('拖动中松开修饰键 (move 事件里 modifier=false 且未武装): 结束转身', () => {
    const { m, rec } = setup();
    m.pointerDown(sample({ modifier: true }));
    rec.clear();
    m.pointerMove(sample({ x: 120, modifier: false }));
    expect(types(rec.events)).toContain('turn-end');
    expect(m.dragging).toBe(false);
    expect(m.modifierActive).toBe(false);
  });

  it('keyUp: 未武装时结束转身并清除修饰状态; 已武装时保持', () => {
    const a = setup();
    a.m.pointerDown(sample({ modifier: true }));
    a.m.keyUp(false);
    expect(a.m.dragging).toBe(false);
    expect(a.m.modifierActive).toBe(false);

    const b = setup();
    b.m.pointerDown(sample());
    b.clock.advance(480);
    b.m.keyUp(false);
    expect(b.m.armed).toBe(true);
    expect(b.m.modifierActive).toBe(true);
  });

  it('keyDown 只在尚未激活时置位', () => {
    const { m, rec } = setup();
    m.keyDown(true);
    expect(m.modifierActive).toBe(true);
    const n = rec.events.length;
    m.keyDown(true);
    expect(rec.events.length).toBe(n);
    const other = setup();
    other.m.keyDown(false);
    expect(other.m.modifierActive).toBe(false);
  });

  it('hover: 导轨可见且未拖动时, move 会探测导轨', () => {
    const { m } = setup({}, (x) => x === 7);
    m.keyDown(true);
    m.pointerMove(sample({ x: 7, modifier: true }));
    expect(m.guideHovered).toBe(true);
    m.pointerMove(sample({ x: 8, modifier: true }));
    expect(m.guideHovered).toBe(false);
  });
});

describe('多点触控', () => {
  const t = (id: number, over: Parameters<typeof sample>[0] = {}) => sample({ pointerId: id, pointerType: 'touch', ...over });

  it('第二指按下: 取消尚未触发的长按武装', () => {
    const { clock, m } = setup();
    m.pointerDown(t(1));
    m.pointerDown(t(2, { x: 200 }));
    clock.advance(1000);
    expect(m.armed).toBe(false);
  });

  it('第二指按下: 中止进行中的转身并释放 capture', () => {
    const { clock, m, rec } = setup();
    m.pointerDown(t(1));
    clock.advance(480);
    m.pointerMove(t(1, { x: 150 })); // turn
    expect(m.dragging).toBe(true);
    rec.clear();
    m.pointerDown(t(2, { x: 300 }));
    expect(m.dragging).toBe(false);
    expect(types(rec.events)).toContain('turn-end');
    expect(rec.events).toContainEqual({ type: 'capture', pointerId: 1, capture: false });
  });

  it('抬起一指后 touch 集合恢复, 再次单指可正常武装', () => {
    const { clock, m } = setup();
    m.pointerDown(t(1));
    m.pointerDown(t(2));
    m.pointerUp(t(2));
    m.pointerUp(t(1));
    m.pointerDown(t(3));
    clock.advance(480);
    expect(m.armed).toBe(true);
  });

  it('非左键的 pointerup 也会清掉 touch 跟踪', () => {
    const { clock, m } = setup();
    m.pointerDown(t(1));
    m.pointerDown(t(2));
    m.pointerUp(t(2, { button: 1 }));
    m.pointerUp(t(1, { button: 1 }));
    m.pointerDown(t(3));
    clock.advance(480);
    expect(m.armed).toBe(true);
  });

  it('鼠标不参与多点触控计数', () => {
    const { clock, m } = setup();
    m.pointerDown(sample({ pointerId: 1 }));
    m.pointerDown(sample({ pointerId: 2 }));
    clock.advance(480);
    expect(m.armed).toBe(true);
  });
});

describe('cancel / blur', () => {
  it('pointercancel (按下计时中): 取消武装', () => {
    const { clock, m } = setup();
    m.pointerDown(sample());
    m.pointerCancel(sample());
    clock.advance(1000);
    expect(m.armed).toBe(false);
  });

  it('pointercancel (转身中): 结束转身, 保持武装并重新计时收起', () => {
    const { clock, m, rec } = setup();
    m.pointerDown(sample());
    clock.advance(480);
    m.pointerMove(sample({ x: 150 }));
    rec.clear();
    m.pointerCancel(sample());
    expect(types(rec.events)).toContain('turn-end');
    expect(m.armed).toBe(true);
    clock.advance(2800);
    expect(m.armed).toBe(false);
  });

  it('pointercancel 不带样本: 清空 touch 集合', () => {
    const { clock, m } = setup();
    m.pointerDown(sample({ pointerId: 1, pointerType: 'touch' }));
    m.pointerDown(sample({ pointerId: 2, pointerType: 'touch' }));
    m.pointerCancel();
    m.pointerDown(sample({ pointerId: 3, pointerType: 'touch' }));
    clock.advance(480);
    expect(m.armed).toBe(true);
  });

  it('blur: 武装 + 转身中 → 全部复位; 空闲时 blur 不产生事件', () => {
    const a = setup();
    a.m.pointerDown(sample());
    a.clock.advance(480);
    a.m.pointerMove(sample({ x: 150 }));
    a.rec.clear();
    a.m.blur();
    expect(a.m.armed).toBe(false);
    expect(a.m.dragging).toBe(false);
    expect(a.m.modifierActive).toBe(false);
    expect(a.m.capturing).toBe(false);
    expect(types(a.rec.events)).toEqual(expect.arrayContaining(['arm-changed', 'turn-end', 'state-changed']));
    expect(a.clock.pending).toBe(0);

    const b = setup();
    b.m.blur();
    expect(b.rec.events).toEqual([]);
  });

  it('blur 时按下计时中 (尚未武装): 不动计时, 与原行为一致', () => {
    const { clock, m } = setup();
    m.pointerDown(sample());
    m.blur();
    clock.advance(480);
    expect(m.armed).toBe(true);
  });

  it('dispose 清掉所有计时', () => {
    const { clock, m } = setup();
    m.pointerDown(sample());
    clock.advance(480);
    m.dispose();
    expect(clock.pending).toBe(0);
  });
});

describe("moveStrategy 'delta' (Embed, 阶段 4 使用; Tauri 不用)", () => {
  it('move-start → 屏幕坐标 move-delta (增量 + 累计) → move-end', () => {
    const { clock, m, rec } = setup({ moveStrategy: 'delta' });
    m.pointerDown(sample({ x: 0, y: 0, screenX: 1000, screenY: 500 }));
    m.pointerMove(sample({ x: 20, y: 0, screenX: 1020, screenY: 500 }));
    expect(rec.events[0]).toMatchObject({ type: 'move-start', strategy: 'delta', screenX: 1020, screenY: 500 });
    // 越过阈值前已走的 20px 补发成第一个 delta (原点 = 按下点)
    expect(rec.events[1]).toEqual({ type: 'move-delta', dx: 20, dy: 0, totalDx: 20, totalDy: 0 });
    rec.clear();
    m.pointerMove(sample({ x: 25, y: 4, screenX: 1025, screenY: 504 }));
    m.pointerMove(sample({ x: 22, y: 9, screenX: 1022, screenY: 509 }));
    expect(rec.events).toEqual([
      { type: 'move-delta', dx: 5, dy: 4, totalDx: 25, totalDy: 4 },
      { type: 'move-delta', dx: -3, dy: 5, totalDx: 22, totalDy: 9 },
    ]);
    m.pointerUp(sample());
    expect(rec.events[rec.events.length - 1]).toEqual({ type: 'move-end', reason: 'up' });
    clock.advance(1000);
    expect(m.armed).toBe(false);
  });

  it('cancel / blur 结束移动', () => {
    for (const reason of ['cancel', 'blur'] as const) {
      const { m, rec } = setup({ moveStrategy: 'delta' });
      m.pointerDown(sample({ x: 0, y: 0 }));
      m.pointerMove(sample({ x: 50, y: 0 }));
      rec.clear();
      if (reason === 'cancel') m.pointerCancel(sample()); else m.blur();
      expect(rec.events).toContainEqual({ type: 'move-end', reason });
    }
  });
});
