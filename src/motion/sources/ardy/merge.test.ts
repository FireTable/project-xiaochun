import { describe, expect, it } from 'vitest';
import { CORE27_JOINT_COUNT } from './vendor/motion-data';
import { mergePiece, type ArdyMotionPiece } from './merge';

const POSITION_STRIDE = CORE27_JOINT_COUNT * 3;
const ROTATION_STRIDE = CORE27_JOINT_COUNT * 9;

function filled(frames: number, stride: number, value: number): Float32Array {
  const out = new Float32Array(frames * stride);
  out.fill(value);
  return out;
}

function piece(startFrame: number, frames: number, value: number): ArdyMotionPiece {
  return {
    startFrame,
    frameCount: frames,
    fps: 20,
    joints: filled(frames, POSITION_STRIDE, value),
    localRotations: filled(frames, ROTATION_STRIDE, value),
    globalRotations: filled(frames, ROTATION_STRIDE, value + 0.5),
  };
}

describe('mergePiece', () => {
  it('appends the next window after the prefix, like the official demo', () => {
    const first = mergePiece(null, piece(0, 40, 1));
    const merged = mergePiece(first, piece(40, 40, 2));

    expect(merged.frameCount).toBe(80);
    expect(merged.joints[0]).toBe(1);
    expect(merged.joints[39 * POSITION_STRIDE]).toBe(1);
    expect(merged.joints[40 * POSITION_STRIDE]).toBe(2);
    expect(merged.joints[79 * POSITION_STRIDE]).toBe(2);
    expect(merged.joints[40 * POSITION_STRIDE - 1]).toBe(1);

    const global = merged.globalRotations!;
    expect(global[0]).toBe(1.5);
    expect(global[40 * ROTATION_STRIDE]).toBe(2.5);
    expect(global[global.length - 1]).toBe(2.5);
    expect(global.some((value) => value === 0)).toBe(false);
  });

  it('replaces an overlapping tail and keeps the earlier prefix', () => {
    const first = mergePiece(null, piece(0, 40, 1));
    const merged = mergePiece(first, piece(30, 10, 3));
    expect(merged.frameCount).toBe(40);
    expect(merged.joints[29 * POSITION_STRIDE]).toBe(1);
    expect(merged.joints[30 * POSITION_STRIDE]).toBe(3);
    expect(merged.joints.length).toBe(40 * POSITION_STRIDE);
  });
});
