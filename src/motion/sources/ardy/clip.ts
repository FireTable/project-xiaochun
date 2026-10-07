import * as THREE from 'three';
import type { VRM, VRMHumanBoneName } from '@pixiv/three-vrm';
import { CORE27_SKELETON } from './vendor/motion-data';
import type { RotationTrack, StructuredMotionResult } from './vendor/motion-data';
import type { RuntimeGenerationResult } from './vendor/runtime/engine';
import type { ArdyClipMotion } from './merge';

export type { ArdyClipMotion };
import {
  CORE27_REST_HIPS_HEIGHT,
  CORE27_VRM_BINDINGS,
  createVrmRetargetPlan,
  retargetMotionFrame,
} from './vendor/vrm-retarget';

function matrixTrack(
  data: Float32Array | undefined,
  frames: number,
  joints: number,
): RotationTrack | undefined {
  if (!data) return undefined;
  const count = frames * joints * 9;
  if (data.length < count) {
    throw new Error(`ARDY rotation track is ${data.length} values, expected at least ${count}`);
  }
  return {
    values: data.subarray(0, count),
    shape: [frames, joints, 9],
    format: 'matrix3x3-row-major',
  };
}

function toMotion(result: ArdyClipMotion): StructuredMotionResult {
  const frames = result.frameCount;
  const joints = CORE27_SKELETON.jointNames.length;
  const positionCount = frames * joints * 3;
  if (result.joints.length < positionCount) {
    throw new Error(`ARDY joint positions are ${result.joints.length} values, expected at least ${positionCount}`);
  }
  return {
    skeleton: CORE27_SKELETON,
    positions: result.joints.subarray(0, positionCount),
    positionsShape: [frames, joints, 3],
    frameCount: frames,
    fps: result.fps,
    localRotations: matrixTrack(result.localRotations, frames, joints),
    globalRotations: matrixTrack(result.globalRotations, frames, joints),
  };
}

function hemisphere(values: Float32Array, index: number): void {
  if (index === 0) return;
  const prev = (index - 1) * 4;
  const cur = index * 4;
  let dot = 0;
  for (let k = 0; k < 4; k += 1) dot += values[prev + k] * values[cur + k];
  if (dot >= 0) return;
  values[cur] = -values[cur];
  values[cur + 1] = -values[cur + 1];
  values[cur + 2] = -values[cur + 2];
  values[cur + 3] = -values[cur + 3];
}

/**
 * Core27 window → clip on this VRM's normalized bones.
 * Hips translation is the retargeted absolute position. Finger bones ARDY
 * does not author are left out, so the clip writer holds whatever pose
 * they already had.
 */
/** Hips height used to scale Core27. Freeze this for a stream so later windows do not rescale. */
export function measureArdyHipsHeight(vrm: VRM): number {
  const hips = vrm.humanoid?.getNormalizedBoneNode('hips');
  if (!hips) return CORE27_REST_HIPS_HEIGHT;
  const probe = new THREE.Vector3();
  hips.getWorldPosition(probe);
  return probe.y > 0.2 ? probe.y : CORE27_REST_HIPS_HEIGHT;
}

export function ardyClipFromResult(
  vrm: VRM,
  result: ArdyClipMotion | RuntimeGenerationResult,
  hipsHeight = measureArdyHipsHeight(vrm),
): THREE.AnimationClip {
  const humanoid = vrm.humanoid;
  if (!humanoid) throw new Error('VRM has no humanoid');
  const frames = result.frameCount;
  const fps = result.fps;
  if (!Number.isFinite(fps) || fps <= 0 || frames < 1) {
    throw new Error('ARDY returned an empty motion');
  }

  const present: VRMHumanBoneName[] = [];
  for (const binding of CORE27_VRM_BINDINGS) {
    if (humanoid.getNormalizedBoneNode(binding.targetBone)) present.push(binding.targetBone);
  }
  const hipsNode = humanoid.getNormalizedBoneNode('hips');
  if (!hipsNode) throw new Error('VRM has no hips bone');
  const plan = createVrmRetargetPlan(CORE27_SKELETON, {
    presentBones: present,
    targetHipsHeight: hipsHeight,
    metaVersion: vrm.meta?.metaVersion === '0' ? '0' : '1',
  });

  const motion = toMotion(result);
  const times = new Float32Array(frames);
  for (let frame = 0; frame < frames; frame += 1) times[frame] = frame / fps;

  const rotationValues = new Map<VRMHumanBoneName, Float32Array>();
  const hipsPosition = new Float32Array(frames * 3);
  for (let frame = 0; frame < frames; frame += 1) {
    const pose = retargetMotionFrame(motion, frame, plan);
    hipsPosition[frame * 3] = pose.hipsPosition[0];
    hipsPosition[frame * 3 + 1] = pose.hipsPosition[1];
    hipsPosition[frame * 3 + 2] = pose.hipsPosition[2];
    for (const rotation of pose.rotations) {
      let values = rotationValues.get(rotation.targetBone);
      if (!values) {
        values = new Float32Array(frames * 4);
        values.fill(0);
        for (let i = 3; i < values.length; i += 4) values[i] = 1;
        rotationValues.set(rotation.targetBone, values);
      }
      const offset = frame * 4;
      values[offset] = rotation.rotation[0];
      values[offset + 1] = rotation.rotation[1];
      values[offset + 2] = rotation.rotation[2];
      values[offset + 3] = rotation.rotation[3];
      hemisphere(values, frame);
    }
  }

  const tracks: THREE.KeyframeTrack[] = [
    new THREE.VectorKeyframeTrack(`${hipsNode.name}.position`, times, hipsPosition),
  ];
  for (const [bone, values] of rotationValues) {
    const node = humanoid.getNormalizedBoneNode(bone);
    if (!node) continue;
    tracks.push(new THREE.QuaternionKeyframeTrack(`${node.name}.quaternion`, times, values));
  }
  return new THREE.AnimationClip(`ardy-${frames}`, times[frames - 1] ?? 0, tracks);
}
