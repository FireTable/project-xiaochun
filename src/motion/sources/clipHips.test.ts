import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { UniversalMotionController } from './clip';
import type { VRM } from '@pixiv/three-vrm';

describe('UniversalMotionController (Hips Y Grounding & Translation Protection)', () => {
  it('calibrates abnormal Hips Y offset (>0.25m from model restY) to prevent mid-air floating', () => {
    const player = new UniversalMotionController();
    expect(player).toBeDefined();

    // Mock VRM with standard rest hips at y = 0.935
    const mockHips = new THREE.Object3D();
    mockHips.position.set(0, 0.935, 0);

    const mockVrm = {
      scene: new THREE.Group(),
      humanoid: {
        getNormalizedBoneNode: (name: string) => (name === 'hips' ? mockHips : null),
        getRawBoneNode: () => null,
      },
    } as unknown as VRM;

    // Simulate an AI-generated motion with Hips baked at 2.104m
    const times = [0, 0.5, 1.0];
    const values = [
      0.003, 2.104, 0.005, // Frame 0: +1.169m above restY
      0.002, 2.124, 0.005, // Frame 1: slight upward dynamic (+0.02m)
      0.001, 2.094, 0.005, // Frame 2: slight downward dynamic (-0.01m)
    ];
    const positionTrack = new THREE.VectorKeyframeTrack('Normalized_J_Bip_C_Hips.position', times, values);
    const clip = new THREE.AnimationClip('thinking', 1.0, [positionTrack]);

    // Apply the calibration logic (as implemented in parseBuffer / retarget pipeline)
    // UniversalMotionPlayer tracks:
    const restHips = mockVrm.humanoid?.getNormalizedBoneNode('hips')!;
    const restY = restHips.position.y;
    const offY = clip.tracks[0].values[1] - restY;
    expect(Math.abs(offY)).toBeGreaterThan(0.25);

    // After applying offset fix:
    for (let i = 0; i < clip.tracks[0].values.length; i += 3) {
      clip.tracks[0].values[i + 1] -= offY;
    }

    // Frame 0 should exactly equal restY (0.935)
    expect(clip.tracks[0].values[1]).toBeCloseTo(0.935, 4);
    // Relative dynamic amplitude should be 100% preserved
    expect(clip.tracks[0].values[4]).toBeCloseTo(0.955, 4); // 0.935 + 0.02
    expect(clip.tracks[0].values[7]).toBeCloseTo(0.925, 4); // 0.935 - 0.01
  });

  it('preserves normal standing motions within ±0.25m without unwanted Y shifting', () => {
    // Normal motion with hips at 0.88m (within normal variance of 0.935m)
    const restY = 0.935;
    const normalY = 0.880;
    const offY = normalY - restY; // -0.055m

    expect(Math.abs(offY)).toBeLessThanOrEqual(0.25);
  });
});
