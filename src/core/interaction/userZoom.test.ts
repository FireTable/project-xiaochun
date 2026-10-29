import { describe, expect, it } from 'vitest';
import { UserZoomTracker, type UserZoomEvent } from './userZoom';

const make = () => {
  const events: UserZoomEvent[] = [];
  return { events, t: new UserZoomTracker((e) => events.push(e)) };
};

describe('UserZoomTracker (only real input counts)', () => {
  it('wheel: emits |deltaY|, ignores zero', () => {
    const { t, events } = make();
    t.wheel(-120);
    t.wheel(0);
    expect(events).toEqual([{ source: 'wheel', amount: 120 }]);
  });

  it('a single finger / mouse drag never counts as zoom', () => {
    const { t, events } = make();
    t.pointerDown(1, 100, 100, 0);
    t.pointerMove(1, 160, 140);
    t.pointerUp(1);
    expect(events).toEqual([]);
  });

  it('pinch: only the change of the finger distance counts', () => {
    const { t, events } = make();
    t.pointerDown(1, 100, 100);
    t.pointerDown(2, 200, 100);
    t.pointerMove(2, 260, 100); // 100 → 160
    expect(events).toEqual([{ source: 'pinch', amount: 60 }]);
    t.pointerMove(1, 130, 100); // 160 → 130
    expect(events[1]).toEqual({ source: 'pinch', amount: 30 });
  });

  it('lifting a finger resets the pinch baseline', () => {
    const { t, events } = make();
    t.pointerDown(1, 0, 0);
    t.pointerDown(2, 100, 0);
    t.pointerUp(2);
    t.pointerMove(1, 50, 0);
    t.pointerDown(3, 300, 0);
    t.pointerMove(3, 310, 0);
    expect(events).toEqual([{ source: 'pinch', amount: 10 }]);
  });

  it('middle-button drag counts as dolly, left drag does not', () => {
    const { t, events } = make();
    t.pointerDown(1, 0, 0, 1);
    t.pointerMove(1, 0, 25);
    expect(events).toEqual([{ source: 'middle_drag', amount: 25 }]);
  });
});
