import { describe, expect, it } from 'vitest';
import {
  computeAdaptiveFadeDuration,
  BASE_FADE_DURATION,
  MIN_FADE_DURATION,
  MAX_FADE_DURATION,
} from './adaptiveFade';
import { PoseBuffer } from './poseBuffer';

describe('AdaptiveFade', () => {
  it('maps diffScore 0.0, 0.5, 1.0 to 0.50s, 0.75s, 1.00s', () => {
    expect(computeAdaptiveFadeDuration(0.0)).toBeCloseTo(0.50, 2);
    expect(computeAdaptiveFadeDuration(0.5)).toBeCloseTo(0.75, 2);
    expect(computeAdaptiveFadeDuration(1.0)).toBeCloseTo(1.00, 2);
  });

  it('clamps values outside [0, 1] range safely', () => {
    expect(computeAdaptiveFadeDuration(-0.5)).toBeCloseTo(0.50, 2);
    expect(computeAdaptiveFadeDuration(1.8)).toBeCloseTo(1.00, 2);
  });

  it('applies actionToIdle protection floor (>= 0.70s)', () => {
    // Even if diff is 0, returning to idle gets at least 0.70s
    expect(computeAdaptiveFadeDuration(0.0, { isActionToIdle: true })).toBeCloseTo(0.70, 2);
    // If diff is 0.8, duration is 0.90s which is already > 0.70s
    expect(computeAdaptiveFadeDuration(0.8, { isActionToIdle: true })).toBeCloseTo(0.90, 2);
  });

  it('respects userRequestedDuration override when explicitly specified', () => {
    expect(computeAdaptiveFadeDuration(0.1, { userRequestedDuration: 1.5 })).toBeCloseTo(1.5, 2);
    expect(computeAdaptiveFadeDuration(0.9, { userRequestedDuration: 0.3 })).toBeCloseTo(0.3, 2);
    // If user passed default 0.75s, it still triggers adaptive calculation
    expect(computeAdaptiveFadeDuration(0.0, { userRequestedDuration: 0.75 })).toBeCloseTo(0.50, 2);
  });

  it('applies crossfadeScale multiplier', () => {
    // scale = 1.2
    const dMid = computeAdaptiveFadeDuration(0.5, { crossfadeScale: 1.2 });
    expect(dMid).toBeCloseTo(0.75 * 1.2, 2);

    // scale = 0.8
    const dSmall = computeAdaptiveFadeDuration(0.0, { crossfadeScale: 0.8 });
    expect(dSmall).toBeCloseTo(0.50 * 0.8, 2);
  });

  it('PoseBuffer.distanceTo measures angular & positional difference', () => {
    const a = new PoseBuffer();
    const b = new PoseBuffer();
    expect(a.distanceTo(b)).toBe(0);

    // Rotate neck by 45 degrees (PI/4 rad)
    const neckIdx = 12; // neck in PIPELINE_BONES
    b.quaternions[neckIdx]!.setFromAxisAngle({ x: 1, y: 0, z: 0 }, Math.PI / 4);
    const diff = a.distanceTo(b);
    expect(diff).toBeGreaterThan(0);
    expect(diff).toBeLessThan(0.3);

    // Adapt fade duration for this neck difference
    const dur = computeAdaptiveFadeDuration(diff);
    expect(dur).toBeGreaterThanOrEqual(0.50);
    expect(dur).toBeLessThanOrEqual(0.65);
  });
});
