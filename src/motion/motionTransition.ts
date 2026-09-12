import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';
import {
  VRM_ALL_HUMANOID_BONES,
  VRM_MOTION_CORE_BONES,
  type VRMAllHumanoidBoneName,
  type VRMMotionCoreBoneName,
} from '@/lib/constants';

export {
  VRM_ALL_HUMANOID_BONES,
  VRM_MOTION_CORE_BONES,
  type VRMAllHumanoidBoneName,
  type VRMMotionCoreBoneName,
};

/**
 * 基于解剖学最大角位移的自适应动力学 S 曲线平滑系统 (Adaptive Biomechanical S-Curve System)
 *
 * 核心设计：
 * 1. 按 Δθ 自适应时长（P0c.1 整体约 +30%，避免源切换「划过去」）：
 *    - 首帧对比快照与目标，取最大角位移 Δθ_max；
 *    - 小动作 (Δθ < 15°)：约 0.29s ~ 0.36s；
 *    - 大动作 (Δθ > 70°)：约 0.72s ~ 0.81s；
 *    - 中等动作：约 0.45s ~ 0.72s。
 *
 * 2. 电影级五次平滑步阶曲线 (Quintic Smootherstep: 6t^5 - 15t^4 + 10t^3)：
 *    - 首尾速度为零、加速度严格连续，绝无第一帧撕扯冲击或最后一帧突然定格；
 *    - 全身 52 根骨骼统一步调，浑然一体，彻底杜绝肢体脱节解体。
 */
export class MotionTransitionManager {
  private isTransitioning = false;
  private transitionElapsed = 0;
  private transitionDuration = 0.58;
  private needsAdaptiveDuration = false;
  private adaptiveMinDuration = 0.52;

  private boneSnapshots = new Map<string, THREE.Quaternion>();
  private hipsPosSnapshot = new THREE.Vector3();
  private sceneYSnapshot = 0;

  // 预分配 scratch 临时变量，杜绝高频循环 GC
  private _targetQ = new THREE.Quaternion();
  private _targetP = new THREE.Vector3();
  private _invLookAt = new THREE.Quaternion();

  /**
   * 触发物理自适应平滑过渡。
   * 记录当前骨骼姿态快照，并标记在首帧根据实际目标位移自适应解算最优过渡时间。
   */
  startTransition(
    vrm: VRM | null | undefined,
    duration = 0.98,
    lookAtOffsets?: { neck?: THREE.Quaternion; head?: THREE.Quaternion },
    boneFilter?: readonly string[],
  ): void {
    if (!vrm?.humanoid) return;

    this.boneSnapshots.clear();
    const bonesToSnap = boneFilter ?? VRM_MOTION_CORE_BONES;

    for (const name of bonesToSnap) {
      const node = vrm.humanoid.getNormalizedBoneNode(name as any);
      if (!node) continue;
      let snap = this.boneSnapshots.get(name);
      if (!snap) {
        snap = node.quaternion.clone();
        this.boneSnapshots.set(name, snap);
      } else {
        snap.copy(node.quaternion);
      }

      // 剔除 LookAt 增量，确保快照为纯净基底姿态
      if (lookAtOffsets) {
        if (name === 'neck' && lookAtOffsets.neck) {
          this._invLookAt.copy(lookAtOffsets.neck).invert();
          snap.multiply(this._invLookAt);
        } else if (name === 'head' && lookAtOffsets.head) {
          this._invLookAt.copy(lookAtOffsets.head).invert();
          snap.multiply(this._invLookAt);
        }
      }
    }

    const hips = vrm.humanoid.getNormalizedBoneNode('hips');
    if (hips && (!boneFilter || boneFilter.includes('hips'))) {
      this.hipsPosSnapshot.copy(hips.position);
    }
    this.sceneYSnapshot = vrm.scene.position.y;

    // 局部子集可更短；全身切换默认更长（约 +30%），首帧再按 Δθ 自适应
    const minDur = boneFilter ? 0.20 : 0.52;
    this.adaptiveMinDuration = minDur;
    this.transitionDuration = Math.max(minDur, duration);
    this.transitionElapsed = 0;
    this.isTransitioning = true;
    this.needsAdaptiveDuration = true;
  }

  /**
   * 在 RAF 渲染循环中统一调用。
   */
  apply(vrm: VRM | null | undefined, delta: number): void {
    if (!this.isTransitioning || !vrm?.humanoid) return;

    if (this.needsAdaptiveDuration) {
      let maxAngle = 0;
      for (const [name, snapQ] of this.boneSnapshots.entries()) {
        const node = vrm.humanoid.getNormalizedBoneNode(name as any);
        if (!node) continue;
        maxAngle = Math.max(maxAngle, snapQ.angleTo(node.quaternion));
      }
      const deg = maxAngle * (180 / Math.PI);
      let d: number;
      if (deg < 15) d = 0.29 + (deg / 15) * 0.07;
      else if (deg > 70) d = 0.72 + Math.min(1, (deg - 70) / 40) * 0.09;
      else d = 0.45 + ((deg - 15) / 55) * 0.27;
      this.transitionDuration = Math.max(this.adaptiveMinDuration, d);
      this.needsAdaptiveDuration = false;
    }

    this.transitionElapsed += delta;
    const alpha = Math.min(1.0, this.transitionElapsed / this.transitionDuration);
    // 五次平滑步阶 (Quintic Smootherstep: 6t^5 - 15t^4 + 10t^3)
    // 具有首尾速度为零、加速度为零的特性，彻底抹除运动启停时的机械撕扯感
    const t = alpha * alpha * alpha * (alpha * (alpha * 6 - 15) + 10);

    for (const [name, snapQ] of this.boneSnapshots.entries()) {
      const node = vrm.humanoid.getNormalizedBoneNode(name as any);
      if (!node) continue;
      this._targetQ.copy(node.quaternion);
      node.quaternion.copy(snapQ).slerp(this._targetQ, t);
    }

    const hips = vrm.humanoid.getNormalizedBoneNode('hips');
    if (hips) {
      this._targetP.copy(hips.position);
      hips.position.copy(this.hipsPosSnapshot).lerp(this._targetP, t);
    }

    vrm.scene.position.y = THREE.MathUtils.lerp(this.sceneYSnapshot, vrm.scene.position.y, t);

    if (alpha >= 1.0) {
      this.isTransitioning = false;
    }
  }

  isActive(): boolean {
    return this.isTransitioning;
  }

  stop(): void {
    this.isTransitioning = false;
    this.boneSnapshots.clear();
  }
}
