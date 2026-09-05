import * as THREE from 'three';
import type { VRM, VRMHumanBoneName } from '@pixiv/three-vrm';

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

    for (let i = 0; i < PIPELINE_BONES.length; i++) {
      const name = PIPELINE_BONES[i]!;
      const node = h.getNormalizedBoneNode(name);
      if (node) {
        this.quaternions[i]!.copy(node.quaternion);
      }
    }

    const hips = h.getNormalizedBoneNode('hips');
    if (hips) {
      this.hipsPosition.copy(hips.position);
    }
    this.sceneY = vrm.scene.position.y;
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
   * 剔除快照中的 LookAt 增量，确保姿态为纯净基底姿态，绝不发生视线二次叠加
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

    for (let i = 0; i < PIPELINE_BONES.length; i++) {
      const name = PIPELINE_BONES[i]!;
      const node = h.getNormalizedBoneNode(name);
      if (node) {
        node.quaternion.copy(this.quaternions[i]!);
      }
    }

    const hips = h.getNormalizedBoneNode('hips');
    if (hips) {
      hips.position.copy(this.hipsPosition);
    }
    vrm.scene.position.y = this.sceneY;
  }
}
