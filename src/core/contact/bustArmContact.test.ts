import { describe, expect, it } from 'vitest';
import { armPushDistance, fitBustEllipsoid, smoothstep01 } from './bustArmContact';

describe('bust arm contact', () => {
  it('fits an ellipsoid to the outer skin on each axis', () => {
    const points: number[] = [];
    for (let i = 0; i < 12; i++) {
      points.push((i - 6) * 0.01, (i - 6) * 0.004, (i - 6) * 0.002);
    }
    const fit = fitBustEllipsoid(points);
    expect(fit).not.toBeNull();
    expect(fit!.center.x).toBeCloseTo(-0.005);
    expect(fit!.radius.x).toBeGreaterThan(fit!.radius.y);
    expect(fit!.radius.y).toBeGreaterThan(fit!.radius.z);
  });

  it('ignores a side with too few samples', () => {
    expect(fitBustEllipsoid([0, 0, 0, 1, 0, 0])).toBeNull();
  });

  it('eases a shallow push and caps a deep one', () => {
    expect(armPushDistance(0, 1, 0.02)).toBe(0);
    expect(armPushDistance(0.02, 1, 0.02)).toBeCloseTo(0.02);
    expect(armPushDistance(0.05, 1, 0.02)).toBeCloseTo(0.02);
    expect(armPushDistance(0.02, 0.5, 0.02)).toBeCloseTo(0.01);
    expect(armPushDistance(0.01, 1, 0.02)).toBeCloseTo(0.01 * smoothstep01(0, 0.02, 0.01));
  });
});
