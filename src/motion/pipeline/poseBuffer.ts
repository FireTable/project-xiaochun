import * as THREE from 'three';
import type { VRM, VRMHumanBoneName } from '@pixiv/three-vrm';
import { TORSO_PITCH_BONES, TORSO_PITCH_LIMITS, clampQuaternionPitch } from '../biomechanics';

/**
 * VRM 全量人形骨骼权威清单 (52 根标准人形骨骼)
 */
export const PIPELINE_BONES: readonly VRMHumanBoneName[] = [
  // 躯干与骨盆
  'hips', 'spine', 'chest', 'upperChest',
  // 下肢
  'leftUpperLeg', 'rightUpperLeg', 'leftLowerLeg', 'rightLowerLeg',
  'leftFoot', 'rightFoot', 'leftToes', 'rightToes',
  // 头颈
  'neck', 'head',
  // 肩臂
  'leftShoulder', 'rightShoulder',
  'leftUpperArm', 'rightUpperArm',
  'leftLowerArm', 'rightLowerArm',
  'leftHand', 'rightHand',
  // 左手 15 指
  'leftThumbMetacarpal', 'leftThumbProximal', 'leftThumbDistal',
  'leftIndexProximal', 'leftIndexIntermediate', 'leftIndexDistal',
  'leftMiddleProximal', 'leftMiddleIntermediate', 'leftMiddleDistal',
  'leftRingProximal', 'leftRingIntermediate', 'leftRingDistal',
  'leftLittleProximal', 'leftLittleIntermediate', 'leftLittleDistal',
  // 右手 15 指
  'rightThumbMetacarpal', 'rightThumbProximal', 'rightThumbDistal',
  'rightIndexProximal', 'rightIndexIntermediate', 'rightIndexDistal',
  'rightMiddleProximal', 'rightMiddleIntermediate', 'rightMiddleDistal',
  'rightRingProximal', 'rightRingIntermediate', 'rightRingDistal',
  'rightLittleProximal', 'rightLittleIntermediate', 'rightLittleDistal',
] as const;

export const BONE_INDEX_MAP = new Map<VRMHumanBoneName, number>(
  PIPELINE_BONES.map((name, i) => [name, i])
);

const BONE_BLEND_SPEED = new Float32Array(PIPELINE_BONES.length);
const BONE_MAX_SPEED = new Float32Array(PIPELINE_BONES.length);

(function initBoneSmoothTables(): void {
  for (let i = 0; i < PIPELINE_BONES.length; i++) {
    const name = PIPELINE_BONES[i]!;
    if (name === 'neck' || name === 'head') {
      BONE_BLEND_SPEED[i] = 22;
      BONE_MAX_SPEED[i] = 12;
    } else if (
      name.includes('Thumb') || name.includes('Index') || name.includes('Middle')
      || name.includes('Ring') || name.includes('Little')
    ) {
      BONE_BLEND_SPEED[i] = 32;
      BONE_MAX_SPEED[i] = 16;
    } else if (
      name.includes('Shoulder') || name.includes('UpperArm')
      || name.includes('LowerArm') || name === 'leftHand' || name === 'rightHand'
    ) {
      BONE_BLEND_SPEED[i] = 28;
      BONE_MAX_SPEED[i] = 12;
    } else {
      BONE_BLEND_SPEED[i] = 28;
      BONE_MAX_SPEED[i] = 12;
    }
  }
})();

/**
 * 身体部位遮罩 (Bone Masks)
 */
export const LOWER_BODY_MASK: readonly VRMHumanBoneName[] = [
  'hips',
  'leftUpperLeg', 'rightUpperLeg',
  'leftLowerLeg', 'rightLowerLeg',
  'leftFoot', 'rightFoot',
  'leftToes', 'rightToes',
] as const;

/** BodyTurn overlay: legs only. Hips rotation stays with Layer-1 (EMAGE/idle). */
export const LEGS_MASK: readonly VRMHumanBoneName[] = [
  'leftUpperLeg', 'rightUpperLeg',
  'leftLowerLeg', 'rightLowerLeg',
  'leftFoot', 'rightFoot',
  'leftToes', 'rightToes',
] as const;

export const UPPER_BODY_MASK: readonly VRMHumanBoneName[] = [
  'spine', 'chest', 'upperChest',
  'neck', 'head',
  'leftShoulder', 'rightShoulder',
  'leftUpperArm', 'rightUpperArm',
  'leftLowerArm', 'rightLowerArm',
  'leftHand', 'rightHand',
  'leftThumbMetacarpal', 'leftThumbProximal', 'leftThumbDistal',
  'leftIndexProximal', 'leftIndexIntermediate', 'leftIndexDistal',
  'leftMiddleProximal', 'leftMiddleIntermediate', 'leftMiddleDistal',
  'leftRingProximal', 'leftRingIntermediate', 'leftRingDistal',
  'leftLittleProximal', 'leftLittleIntermediate', 'leftLittleDistal',
  'rightThumbMetacarpal', 'rightThumbProximal', 'rightThumbDistal',
  'rightIndexProximal', 'rightIndexIntermediate', 'rightIndexDistal',
  'rightMiddleProximal', 'rightMiddleIntermediate', 'rightMiddleDistal',
  'rightRingProximal', 'rightRingIntermediate', 'rightRingDistal',
  'rightLittleProximal', 'rightLittleIntermediate', 'rightLittleDistal',
] as const;

export const HEAD_NECK_MASK: readonly VRMHumanBoneName[] = [
  'neck', 'head',
] as const;

export type MotionBoneMask = 'all' | 'upperBody' | 'lowerBody' | 'headNeck';

export function getBoneMask(mask?: MotionBoneMask): readonly VRMHumanBoneName[] | null {
  if (!mask || mask === 'all') return null;
  if (mask === 'upperBody') return UPPER_BODY_MASK;
  if (mask === 'lowerBody') return LOWER_BODY_MASK;
  if (mask === 'headNeck') return HEAD_NECK_MASK;
  return null;
}

/**
 * PoseBuffer — 零 GC 预分配骨骼姿态容器
 * 存储整副骨架在某一时刻的四元数与骨盆位移，支持高性能加权混合与遮罩复合
 */
export class PoseBuffer {
  public readonly quaternions: THREE.Quaternion[];
  public readonly hipsPosition = new THREE.Vector3();
  public sceneY = 0;

  constructor() {
    this.quaternions = PIPELINE_BONES.map(() => new THREE.Quaternion());
  }

  /**
   * 将另一个 PoseBuffer 的全部数据复制到自身
   */
  copyFrom(src: PoseBuffer): this {
    for (let i = 0; i < PIPELINE_BONES.length; i++) {
      this.quaternions[i]!.copy(src.quaternions[i]!);
    }
    this.hipsPosition.copy(src.hipsPosition);
    this.sceneY = src.sceneY;
    return this;
  }

  /**
   * 从 VRM 实体骨骼中采样捕获当前瞬时姿态
   */
  sampleFromVRM(vrm: VRM): this {
    const h = vrm.humanoid;
    if (!h) return this;

    const isVrm0 = vrm.meta?.metaVersion === '0';
    for (let i = 0; i < PIPELINE_BONES.length; i++) {
      const name = PIPELINE_BONES[i]!;
      const node = h.getNormalizedBoneNode(name);
      if (node) {
        if (isVrm0) {
          const nq = node.quaternion;
          this.quaternions[i]!.set(-nq.x, nq.y, -nq.z, nq.w);
        } else {
          this.quaternions[i]!.copy(node.quaternion);
        }
      }
    }

    const hips = h.getNormalizedBoneNode('hips');
    if (hips) {
      if (isVrm0) {
        this.hipsPosition.set(-hips.position.x, hips.position.y, -hips.position.z);
      } else {
        this.hipsPosition.copy(hips.position);
      }
    }
    this.sceneY = vrm.scene.position.y;
    return this;
  }

  /**
   * 将头颈骨骼重置为标准中立 (Identity) 姿态，
   * 确保待机底图等无头动作图层保持纯净中立，完全由 GazeController 独立接管
   */
  resetHeadNeck(): this {
    const neckIdx = BONE_INDEX_MAP.get('neck');
    if (neckIdx !== undefined) this.quaternions[neckIdx]!.identity();
    const headIdx = BONE_INDEX_MAP.get('head');
    if (headIdx !== undefined) this.quaternions[headIdx]!.identity();
    return this;
  }

  /**
   * 全身四元数球形线性插值 (Slerp)：this = this.slerp(target, alpha)
   */
  slerp(target: PoseBuffer, alpha: number): this {
    if (alpha <= 0.00001) return this;
    if (alpha >= 0.99999) return this.copyFrom(target);

    for (let i = 0; i < PIPELINE_BONES.length; i++) {
      this.quaternions[i]!.slerp(target.quaternions[i]!, alpha);
    }
    this.hipsPosition.lerp(target.hipsPosition, alpha);
    this.sceneY = THREE.MathUtils.lerp(this.sceneY, target.sceneY, alpha);
    return this;
  }

  /**
   * 带遮罩的分层加权覆盖混合 (Masked Blend)
   * 仅将 mask 指定的骨骼向 target 按照 weight 进行 Slerp 混合
   */
  blendMasked(target: PoseBuffer, weight: number, mask: readonly VRMHumanBoneName[]): this {
    if (weight <= 0.00001) return this;
    const clampedW = Math.min(1.0, weight);

    for (const boneName of mask) {
      const idx = BONE_INDEX_MAP.get(boneName);
      if (idx === undefined) continue;
      this.quaternions[idx]!.slerp(target.quaternions[idx]!, clampedW);
      if (boneName === 'hips') {
        this.hipsPosition.lerp(target.hipsPosition, clampedW);
      }
    }
    return this;
  }

  /**
   * 解剖学双层复合 (Layered Compositor):
   * 自身作为最终姿态容器，下半身（hips, legs, feet）来自 lower，上半身（spine, chest, arms, hands, fingers）来自 upper
   */
  composeLayered(lower: PoseBuffer, upper: PoseBuffer): this {
    for (const boneName of LOWER_BODY_MASK) {
      const idx = BONE_INDEX_MAP.get(boneName);
      if (idx !== undefined) {
        this.quaternions[idx]!.copy(lower.quaternions[idx]!);
      }
    }
    this.hipsPosition.copy(lower.hipsPosition);
    this.sceneY = lower.sceneY;

    for (const boneName of UPPER_BODY_MASK) {
      const idx = BONE_INDEX_MAP.get(boneName);
      if (idx !== undefined) {
        this.quaternions[idx]!.copy(upper.quaternions[idx]!);
      }
    }
    return this;
  }

  /** Rest-relative sagittal clamp on torso + neck. */
  clampTorsoPitch(rest: PoseBuffer): this {
    for (let i = 0; i < TORSO_PITCH_BONES.length; i++) {
      const boneName = TORSO_PITCH_BONES[i]!;
      const idx = BONE_INDEX_MAP.get(boneName);
      const limit = TORSO_PITCH_LIMITS[boneName];
      if (idx === undefined || !limit) continue;
      clampQuaternionPitch(this.quaternions[idx]!, limit.min, limit.max, rest.quaternions[idx]!);
    }
    return this;
  }

  /**
   * 解剖学双层平滑复合 (Smooth Layered Compositor):
   * 结合下半身与上半身姿态，并施加人体生理角速度限幅与连续时间阻尼滤波，
   * 彻底消除任何单帧突变、图层接缝跳变与机械撕扯，确保全身每个部位均符合生理运动连续曲线。
   *
   * @param lower 下半身姿态源
   * @param upper 上半身姿态源
   * @param delta 帧耗时 (秒)
   */
  composeLayeredSmooth(
    lower: PoseBuffer,
    upper: PoseBuffer,
    delta: number,
  ): this {
    const dt = Math.max(0.0001, Math.min(delta, 0.1));

    for (const boneName of LOWER_BODY_MASK) {
      const idx = BONE_INDEX_MAP.get(boneName);
      if (idx === undefined) continue;
      this.smoothBoneQuaternion(idx, lower.quaternions[idx]!, dt);
    }

    const hipsK = BONE_BLEND_SPEED[BONE_INDEX_MAP.get('hips') ?? 0]!;
    const hipsAlpha = 1.0 - Math.exp(-hipsK * dt);
    const maxPosDelta = 2.5 * dt;
    const posDist = this.hipsPosition.distanceTo(lower.hipsPosition);
    if (posDist > 0.00001) {
      const step = Math.min(posDist * hipsAlpha, maxPosDelta);
      this.hipsPosition.lerp(lower.hipsPosition, step / posDist);
    }
    this.sceneY = THREE.MathUtils.damp(this.sceneY, lower.sceneY, hipsK, dt);

    for (const boneName of UPPER_BODY_MASK) {
      const idx = BONE_INDEX_MAP.get(boneName);
      if (idx === undefined) continue;
      this.smoothBoneQuaternion(idx, upper.quaternions[idx]!, dt);
    }

    return this;
  }

  private smoothBoneQuaternion(idx: number, targetQ: THREE.Quaternion, dt: number): void {
    const curQ = this.quaternions[idx]!;
    const dot = Math.abs(curQ.dot(targetQ));
    const angleDist = 2.0 * Math.acos(Math.min(1.0, Math.max(0.0, dot)));
    if (angleDist < 0.0001) return;

    const k = BONE_BLEND_SPEED[idx]!;
    const maxSpeed = BONE_MAX_SPEED[idx]!;
    const filterAlpha = 1.0 - Math.exp(-k * dt);
    const stepAlpha = Math.min(filterAlpha, Math.min(1.0, (maxSpeed * dt) / angleDist));
    curQ.slerp(targetQ, stepAlpha);
  }

  /**
   * Strip LookAt only when this buffer was sampled from VRM bones that already
   * have gaze multiplied on. Anatomical pipeline buffers (`finalPose`) must not
   * be stripped — that bakes inverse gaze into the Quintic start.
   */
  removeLookAtOffsets(lookAtOffsets?: { neck?: THREE.Quaternion; head?: THREE.Quaternion }): void {
    if (!lookAtOffsets) return;

    const neckIdx = BONE_INDEX_MAP.get('neck');
    const headIdx = BONE_INDEX_MAP.get('head');

    const inv = new THREE.Quaternion();
    if (neckIdx !== undefined && lookAtOffsets.neck) {
      inv.copy(lookAtOffsets.neck).invert();
      this.quaternions[neckIdx]!.multiply(inv);
    }
    if (headIdx !== undefined && lookAtOffsets.head) {
      inv.copy(lookAtOffsets.head).invert();
      this.quaternions[headIdx]!.multiply(inv);
    }
  }

  /**
   * 原子化将本 Buffer 的姿态最终提交写入 VRM 骨骼 (管线终点唯一写入者)
   */
  commitToVRM(vrm: VRM): void {
    const h = vrm.humanoid;
    if (!h) return;

    const isVrm0 = vrm.meta?.metaVersion === '0';
    for (let i = 0; i < PIPELINE_BONES.length; i++) {
      const name = PIPELINE_BONES[i]!;
      const node = h.getNormalizedBoneNode(name);
      if (node) {
        const q = this.quaternions[i]!;
        if (isVrm0) {
          node.quaternion.set(-q.x, q.y, -q.z, q.w);
        } else {
          node.quaternion.copy(q);
        }
      }
    }

    const hips = h.getNormalizedBoneNode('hips');
    if (hips) {
      if (isVrm0) {
        hips.position.set(-this.hipsPosition.x, this.hipsPosition.y, -this.hipsPosition.z);
      } else {
        hips.position.copy(this.hipsPosition);
      }
    }
    vrm.scene.position.y = this.sceneY;
  }
}

/**
 * Copy a pose for Quintic crossfade. `srcIncludesGaze` is true only for
 * snapshots taken from live VRM after GazeController. Pipeline `finalPose`
 * is committed before gaze — pass false.
 */
export function copyTransitionSnapshot(
  dest: PoseBuffer,
  src: PoseBuffer,
  lookAtOffsets: { neck?: THREE.Quaternion; head?: THREE.Quaternion } | undefined,
  srcIncludesGaze: boolean,
): void {
  dest.copyFrom(src);
  if (srcIncludesGaze) dest.removeLookAtOffsets(lookAtOffsets);
}
