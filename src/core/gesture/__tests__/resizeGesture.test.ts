import { describe, expect, it } from 'vitest';
import { ResizeGesture } from '../resizeGesture';
import type { GestureEvent } from '../types';
import { sample } from './helpers';

function setup(strategy: 'native' | 'delta') {
  const g = new ResizeGesture(strategy);
  const events: GestureEvent[] = [];
  g.on((e) => events.push(e));
  return { g, events };
}

describe('ResizeGesture', () => {
  it('native: begin 只发一次 resize-start (含 corner), 不进入 resizing 状态', () => {
    const { g, events } = setup('native');
    expect(g.begin('SE', sample({ screenX: 10, screenY: 20 }))).toBe(true);
    expect(events).toEqual([{ type: 'resize-start', strategy: 'native', corner: 'SE', pointerId: 1, screenX: 10, screenY: 20 }]);
    expect(g.resizing).toBe(false);
    g.move(sample({ screenX: 50, screenY: 50 }));
    g.end('up');
    expect(events.length).toBe(1);
  });

  it('非左键不开始', () => {
    const { g, events } = setup('native');
    expect(g.begin('NW', sample({ button: 2 }))).toBe(false);
    expect(events).toEqual([]);
  });

  it('delta: resize-start → resize-delta (增量 + 累计, 带 corner) → resize-end', () => {
    const { g, events } = setup('delta');
    g.begin('NW', sample({ screenX: 100, screenY: 100 }));
    expect(g.resizing).toBe(true);
    g.move(sample({ screenX: 90, screenY: 95 }));
    g.move(sample({ screenX: 80, screenY: 100 }));
    g.end('up');
    expect(events.slice(1)).toEqual([
      { type: 'resize-delta', corner: 'NW', dx: -10, dy: -5, totalDx: -10, totalDy: -5 },
      { type: 'resize-delta', corner: 'NW', dx: -10, dy: 5, totalDx: -20, totalDy: 0 },
      { type: 'resize-end', corner: 'NW', reason: 'up' },
    ]);
    expect(g.resizing).toBe(false);
  });

  it('delta: 忽略其他指针和重复 begin; end 只触发一次', () => {
    const { g, events } = setup('delta');
    g.begin('NE', sample({ pointerId: 1 }));
    expect(g.begin('SW', sample({ pointerId: 2 }))).toBe(false);
    g.move(sample({ pointerId: 2, screenX: 999 }));
    g.end('cancel');
    g.end('cancel');
    expect(events.map((e) => e.type)).toEqual(['resize-start', 'resize-end']);
  });
});
