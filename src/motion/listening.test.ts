import { describe, expect, it } from 'vitest';
import type { VRMHumanBoneName } from '@pixiv/three-vrm';
import { PoseBuffer, BONE_INDEX_MAP } from './pipeline/poseBuffer';
import { ListeningMotionSystem } from './sources/listening';

function angle(pose: PoseBuffer, name: VRMHumanBoneName): number {
  const idx = BONE_INDEX_MAP.get(name)!;
  const q = pose.quaternions[idx]!;
  return 2 * Math.acos(Math.min(1, Math.abs(q.w)));
}

describe('ListeningMotionSystem (4-Dimension Attentive Listening)', () => {
  it('shapes arms behind back and leans torso forward, then weight fades out', () => {
    const pose = new PoseBuffer();
    const system = new ListeningMotionSystem();

    for (let i = 0; i < 90; i++) system.sampleInto(pose, i * 0.016, 0.016, true);
    expect(system.weight).toBeGreaterThan(0.8);
    // 躯干与头颈倾角
    expect(angle(pose, 'head')).toBeGreaterThan(0.05);
    expect(angle(pose, 'neck')).toBeGreaterThan(0.02);
    expect(angle(pose, 'spine')).toBeGreaterThan(0.02);
    expect(angle(pose, 'chest')).toBeGreaterThan(0.02);

    // 双臂顺肩向后收拢
    expect(angle(pose, 'leftUpperArm')).toBeGreaterThan(1.0);
    expect(angle(pose, 'rightUpperArm')).toBeGreaterThan(1.0);
    expect(angle(pose, 'leftLowerArm')).toBeGreaterThan(0.25);
    expect(angle(pose, 'rightLowerArm')).toBeGreaterThan(0.25);

    // 退出倾听后平滑衰减
    for (let i = 0; i < 180; i++) system.sampleInto(pose, 2 + i * 0.016, 0.016, false);
    expect(system.weight).toBeLessThan(0.05);
  });

  it('generates dynamic Aizuchi nod variations over time', () => {
    const pose1 = new PoseBuffer();
    const pose2 = new PoseBuffer();
    const system = new ListeningMotionSystem();

    // 预热进入倾听态 (progress = 1.0)
    for (let i = 0; i < 60; i++) system.sampleInto(pose1, i * 0.016, 0.016, true);

    // 采样相槌点头高峰期 (约 cycleT = 0.3s)
    system.sampleInto(pose1, 0.05, 0.016, true);

    // 采样相槌待机平静期 (约 cycleT = 1.5s)
    system.sampleInto(pose2, 1.5, 0.016, true);

    const headAngleNod = angle(pose1, 'head');
    const headAngleRest = angle(pose2, 'head');

    // 点头时头部角度与静止期应有明确解剖学微差
    expect(headAngleNod).toBeGreaterThan(0);
    expect(headAngleRest).toBeGreaterThan(0);
    expect(Math.abs(headAngleNod - headAngleRest)).toBeGreaterThan(0.005);
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
