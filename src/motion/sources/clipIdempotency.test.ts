import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';
import { UniversalMotionController } from './clip';
import { retargetClip } from '../vrmaRetarget';

function makeMockVrm(hipsY = 0.935): { vrm: VRM; shoulderNode: THREE.Object3D; hipsNode: THREE.Object3D } {
  const scene = new THREE.Group();
  const hipsNode = new THREE.Object3D();
  hipsNode.name = 'Normalized_J_Bip_C_Hips';
  hipsNode.position.set(0, hipsY, 0);

  const shoulderNode = new THREE.Object3D();
  shoulderNode.name = 'Normalized_J_Bip_L_Shoulder';

  scene.add(hipsNode, shoulderNode);

  const nodes: Record<string, THREE.Object3D> = {
    hips: hipsNode,
    leftShoulder: shoulderNode,
  };

  const vrm = {
    scene,
    humanoid: {
      getNormalizedBoneNode: (name: string) => nodes[name] ?? null,
      getRawBoneNode: () => null,
    },
  } as unknown as VRM;

  return { vrm, shoulderNode, hipsNode };
}

function quatAngleRad(values: ArrayLike<number>, offset: number): number {
  const w = Math.min(1, Math.max(-1, values[offset + 3]!));
  return 2 * Math.acos(w);
}

describe('UniversalMotionController & retargetClip idempotency (BUG-1)', () => {
  it('applies antiClip shoulder scaling and smoothing once even when cached clip is parsed repeatedly', async () => {
    const { vrm, shoulderNode } = makeMockVrm();
    const controller = new UniversalMotionController();
    controller.bind(vrm);

    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 3); // 60 deg
    const times = [0, 1 / 30, 2 / 30, 3 / 30];
    const values: number[] = [];
    for (let i = 0; i < times.length; i++) {
      values.push(q.x, q.y, q.z, q.w);
    }
    const track = new THREE.QuaternionKeyframeTrack(`${shoulderNode.name}.quaternion`, times, values);
    const rawClip = new THREE.AnimationClip('thinking_cached', 3 / 30, [track]);
    (rawClip as any)._timeRangeBaked = '0:3';

    const first = await controller.parseToClip(rawClip, vrm, { antiClip: true, timeRange: [0, 0.1] });
    const firstAngle = quatAngleRad(first.tracks[0]!.values, 4);
    expect(firstAngle).toBeCloseTo((Math.PI / 3) * 0.15, 4);

    // Simulate playing the L3-cached clip 5 more turns through MotionPipeline -> playMotion -> parseToClip
    for (let turn = 0; turn < 5; turn++) {
      const again = await controller.parseToClip(first, vrm, { antiClip: true, timeRange: [0, 0.1] });
      expect(again).toBe(first);
    }

    const afterSixPlaysAngle = quatAngleRad(first.tracks[0]!.values, 4);
    expect(afterSixPlaysAngle).toBeCloseTo(firstAngle, 6);
  });

  it('uncaches transient subclips on stop() and resets mixer/hipsRest when re-binding a new VRM', async () => {
    const { vrm: vrmA, shoulderNode: shoulderA } = makeMockVrm(0.92);
    const { vrm: vrmB } = makeMockVrm(1.05);
    const controller = new UniversalMotionController();
    controller.bind(vrmA);

    const oldMixer = (controller as any).mixer as THREE.AnimationMixer;
    const uncacheActionSpy = vi.spyOn(oldMixer, 'uncacheAction');
    const uncacheClipSpy = vi.spyOn(oldMixer, 'uncacheClip');
    const uncacheRootSpy = vi.spyOn(oldMixer, 'uncacheRoot');

    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.4);
    const times = [0, 0.5, 1.0];
    const values = [q.x, q.y, q.z, q.w, q.x, q.y, q.z, q.w, q.x, q.y, q.z, q.w];
    const baseClip = retargetClip(
      new THREE.AnimationClip('raw', 1.0, [new THREE.QuaternionKeyframeTrack(`${shoulderA.name}.quaternion`, times, values)]),
      vrmA,
      { antiClip: true },
    );

    // Passing a custom timeRange on a clip without matching _timeRangeBaked creates a transient subclip
    const sub = await controller.parseToClip(baseClip, vrmA, { antiClip: true, timeRange: [0, 0.5] });
    expect(sub).not.toBe(baseClip);
    expect((sub as any)._transientSubclip).toBe(true);
    expect((sub as any)._retargetedBaked).toBe(true);

    controller.play(sub, { loop: false });
    controller.stop();
    expect(uncacheActionSpy).toHaveBeenCalledWith(sub);
    expect(uncacheClipSpy).toHaveBeenCalledWith(sub);

    (controller as any).hipsRest = { x: 0, y: 0.92, z: 0 };
    controller.bind(vrmB);
    expect(uncacheRootSpy).toHaveBeenCalledWith(vrmA.scene);
    expect((controller as any).hipsRest).toBeNull();
  });
});
