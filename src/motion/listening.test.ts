import { describe, expect, it } from 'vitest';
import { PoseBuffer } from './pipeline/poseBuffer';
import { ListeningMotionSystem } from './sources/listening';

describe('ListeningMotionSystem (Mocap-Driven Listening Weight)', () => {
  it('smoothly scales weight up to > 0.8 under 0.75s Quintic curve, then fades out', () => {
    const pose = new PoseBuffer();
    const system = new ListeningMotionSystem();

    // 推进约 0.8 秒 (50 帧 * 0.016s)
    for (let i = 0; i < 50; i++) system.sampleInto(pose, i * 0.016, 0.016, true);
    expect(system.weight).toBeGreaterThan(0.8);
    expect(system.weight).toBeLessThanOrEqual(1.0);

    // 退出倾听后平滑衰减至 0
    for (let i = 0; i < 100; i++) system.sampleInto(pose, 1.0 + i * 0.016, 0.016, false);
    expect(system.weight).toBeLessThan(0.05);
  });

  it('does nothing while disabled', () => {
    const pose = new PoseBuffer();
    const system = new ListeningMotionSystem();
    system.enabled = false;
    for (let i = 0; i < 60; i++) system.sampleInto(pose, i * 0.016, 0.016, true);
    expect(system.weight).toBe(0);
  });
});
