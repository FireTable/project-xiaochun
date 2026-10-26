import { describe, expect, it } from 'vitest';
import { PoseBuffer, BONE_INDEX_MAP } from './pipeline/poseBuffer';
import { ListeningMotionSystem } from './sources/listening';

function angle(pose: PoseBuffer, name: 'neck' | 'head' | 'rightLowerArm'): number {
  const idx = BONE_INDEX_MAP.get(name)!;
  const q = pose.quaternions[idx]!;
  return 2 * Math.acos(Math.min(1, Math.abs(q.w)));
}

describe('ListeningMotionSystem', () => {
  it('leans the head in while listening, then the weight falls back', () => {
    const pose = new PoseBuffer();
    const system = new ListeningMotionSystem();

    for (let i = 0; i < 90; i++) system.sampleInto(pose, i * 0.016, 0.016, true);
    expect(system.weight).toBeGreaterThan(0.8);
    expect(angle(pose, 'head')).toBeGreaterThan(0.05);
    expect(angle(pose, 'neck')).toBeGreaterThan(0.02);
    expect(angle(pose, 'rightLowerArm')).toBeGreaterThan(1);

    for (let i = 0; i < 180; i++) system.sampleInto(pose, 2 + i * 0.016, 0.016, false);
    expect(system.weight).toBeLessThan(0.05);
  });

  it('does nothing while disabled', () => {
    const pose = new PoseBuffer();
    const system = new ListeningMotionSystem();
    system.enabled = false;
    for (let i = 0; i < 60; i++) system.sampleInto(pose, i * 0.016, 0.016, true);
    expect(system.weight).toBe(0);
    expect(angle(pose, 'head')).toBe(0);
  });
});
