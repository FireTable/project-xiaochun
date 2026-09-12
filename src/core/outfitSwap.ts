/**
 * Outfit swap (方案 A) — capture / restore animation-related state across whole-VRM reload.
 * Owned by VRMEngine; kept as a small pure helper so loadVRM stays readable.
 */
import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';
import type { PipelineMotionSource } from '@/motion/pipeline/motionPipeline';

export type OutfitMotionSource = PipelineMotionSource | 'thinking';

export interface SpringBoneJointSnap {
  boneName: string;
  quaternion: [number, number, number, number];
  currentTail?: [number, number, number];
  prevTail?: [number, number, number];
}

export interface GazeSwapSnap {
  gazeOffsetTarget: [number, number, number];
  gazeCurrentOffset: [number, number, number];
  isGlancingAway: boolean;
  gazeShiftTimer: number;
  gazeShiftInterval: number;
}

/** Light BodyTurn continuity (bind() resets; restore after rebind). */
export interface BodyTurnSwapSnap {
  yawVel: number;
  isTurning: boolean;
  phase: number;
  phaseTimer: number;
  stepLeft: boolean;
  stepBlendWeight: number;
  spineYawCurrent: number;
  chestYawCurrent: number;
  upperChestYawCur: number;
}

/** Light FootIK continuity (geometry re-detects on bind; keep stance/barefoot blend). */
export interface FootIKSwapSnap {
  barefootFactor: number;
  stanceRatio: number;
  smoothStanceRatio: number;
}

export interface OutfitSwapState {
  motionSource: OutfitMotionSource;
  /** Last VRMA URL if loadVRMA was used (null for buffer/thinking clips). */
  vrmaUrl: string | null;
  vrmaBuffer?: ArrayBuffer | null;
  vrmaTime: number;
  vrmaLoop: boolean;
  /** True when chatDirector was in thinking pose (thinking.vrma via buffer). */
  thinking: boolean;
  /** EMAGE: keep buffer; only rebind + seek/resume. */
  emageActive: boolean;
  emageStreaming: boolean;
  emageTime: number;
  emagePlaying: boolean;
  /** Universal pipeline motion URL (string input only). */
  universalUrl: string | null;
  universalBuffer?: ArrayBuffer | null;
  universalTime: number;
  universalLoop: boolean;
  blendshapes: Record<string, number>;
  manualExpression: string | null;
  gaze: GazeSwapSnap | null;
  lookAtTarget: [number, number, number] | null;
  springBones: SpringBoneJointSnap[];
  /** vrm.scene.rotation.y — loadVRM zeros this; restore to avoid facing pop. */
  sceneYaw: number;
  bodyTurn: BodyTurnSwapSnap | null;
  footIK: FootIKSwapSnap | null;
}

export function captureExpressions(vrm: VRM | null): Record<string, number> {
  const out: Record<string, number> = {};
  const mgr = vrm?.expressionManager;
  if (!mgr) return out;
  for (const name of Object.keys(mgr.expressionMap)) {
    const v = mgr.getValue(name);
    if (v != null) out[name] = v;
  }
  return out;
}

export function restoreExpressions(vrm: VRM | null, blendshapes: Record<string, number>): void {
  const mgr = vrm?.expressionManager;
  if (!mgr) return;
  for (const [name, value] of Object.entries(blendshapes)) {
    try {
      mgr.setValue(name, value);
    } catch {
      /* expression may not exist on the other VRM */
    }
  }
  mgr.update();
}

export function captureSpringBones(vrm: VRM | null): SpringBoneJointSnap[] {
  const snaps: SpringBoneJointSnap[] = [];
  const mgr = vrm?.springBoneManager;
  if (!mgr) return snaps;
  for (const joint of mgr.joints) {
    const bone = joint.bone;
    const name = bone?.name;
    if (!name) continue;
    const q = bone.quaternion;
    const snap: SpringBoneJointSnap = {
      boneName: name,
      quaternion: [q.x, q.y, q.z, q.w],
    };
    // Best-effort verlet tails (private fields — ~80% continuity per OUTFIT_SWAP.md)
    const j = joint as unknown as {
      _currentTail?: THREE.Vector3;
      _prevTail?: THREE.Vector3;
    };
    if (j._currentTail) {
      snap.currentTail = [j._currentTail.x, j._currentTail.y, j._currentTail.z];
    }
    if (j._prevTail) {
      snap.prevTail = [j._prevTail.x, j._prevTail.y, j._prevTail.z];
    }
    snaps.push(snap);
  }
  return snaps;
}

export function restoreSpringBones(vrm: VRM | null, snaps: SpringBoneJointSnap[]): void {
  const mgr = vrm?.springBoneManager;
  if (!mgr || snaps.length === 0) return;
  const byName = new Map(snaps.map((s) => [s.boneName, s]));
  for (const joint of mgr.joints) {
    const snap = joint.bone?.name ? byName.get(joint.bone.name) : undefined;
    if (!snap) continue;
    joint.bone.quaternion.set(...snap.quaternion);
    const j = joint as unknown as {
      _currentTail?: THREE.Vector3;
      _prevTail?: THREE.Vector3;
    };
    if (snap.currentTail && j._currentTail) {
      j._currentTail.set(...snap.currentTail);
    }
    if (snap.prevTail && j._prevTail) {
      j._prevTail.set(...snap.prevTail);
    }
  }
}

export function captureLookAtTarget(vrm: VRM | null): [number, number, number] | null {
  const t = vrm?.lookAt?.target;
  if (!t) return null;
  return [t.position.x, t.position.y, t.position.z];
}
