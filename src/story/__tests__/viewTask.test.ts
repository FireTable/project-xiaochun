import { describe, it, expect } from 'vitest';
import { ViewTaskTracker, type ViewSample } from '../viewTask';

const deg = (d: number) => (d * Math.PI) / 180;
const base: ViewSample = { azimuth: 0, polar: Math.PI / 2, yaw: 0, distance: 2 };
const at = (patch: Partial<ViewSample>): ViewSample => ({ ...base, ...patch });

describe('ViewTaskTracker', () => {
  it('stays idle while nothing moves', () => {
    const t = new ViewTaskTracker(35, 0.2);
    t.begin(base);
    expect(t.update(base)).toEqual({ orbitDeg: 0, zoomRatio: 0, done: false });
  });

  it('completes once the accumulated rotation reaches the goal (camera azimuth)', () => {
    const t = new ViewTaskTracker(35, 0.2);
    t.begin(base);
    expect(t.update(at({ azimuth: deg(20) })).done).toBe(false);
    const p = t.update(at({ azimuth: deg(36) }));
    expect(p.orbitDeg).toBeCloseTo(36, 5);
    expect(p.done).toBe(true);
  });

  it('counts the character turn (horizontal drag rotates her, not the camera) and the tilt', () => {
    const t = new ViewTaskTracker(35, 0.2);
    t.begin(base);
    t.update(at({ yaw: deg(20) }));
    expect(t.update(at({ yaw: deg(20), polar: base.polar + deg(16) })).done).toBe(true);
  });

  it('accumulates instead of using net displacement: wiggling back and forth counts', () => {
    const t = new ViewTaskTracker(35, 0.2);
    t.begin(base);
    let done = false;
    for (let i = 0; i < 6 && !done; i++) {
      done = t.update(at({ yaw: deg(i % 2 === 0 ? 10 : -10) })).done;
    }
    expect(done).toBe(true);
  });

  it('wraps the azimuth across ±180° instead of counting a full lap', () => {
    const t = new ViewTaskTracker(35, 0.2);
    t.begin(at({ azimuth: deg(179) }));
    const p = t.update(at({ azimuth: deg(-179) }));
    expect(p.orbitDeg).toBeCloseTo(2, 5);
    expect(p.done).toBe(false);
  });

  it('completes on a 20% zoom change in either direction, measured against the start distance', () => {
    const zoomIn = new ViewTaskTracker(35, 0.2);
    zoomIn.begin(base);
    expect(zoomIn.update(at({ distance: 1.7 })).done).toBe(false); // 15%
    expect(zoomIn.update(at({ distance: 1.55 })).done).toBe(true); // 22.5%

    const zoomOut = new ViewTaskTracker(35, 0.2);
    zoomOut.begin(base);
    expect(zoomOut.update(at({ distance: 2.45 })).done).toBe(true); // 22.5%
  });

  it('keeps the peak zoom change even if the user zooms back', () => {
    const t = new ViewTaskTracker(35, 0.2);
    t.begin(base);
    t.update(at({ distance: 1.5 }));
    expect(t.update(base).zoomRatio).toBeCloseTo(0.25, 5);
  });
});
