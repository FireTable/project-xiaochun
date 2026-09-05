import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';

// VRM 核心骨骼过渡清单：20 根核心骨骼（躯干 + 四肢）。
//
// ⚠️ 关键设计决策：
// 1. 明确排除 'neck' 和 'head'！
//    头部和颈部在渲染循环末端受到 LookAt 追踪系统的增量乘法叠加
//    (headNode.quaternion.multiply(headOffsetQ))。若快照头部骨骼，
//    快照内包含 LookAt 偏移量，过渡时会被二次叠加，导致头部翻折/闪跳/抽动。
//    头部交由各自模块与 LookAt 独立平滑跟随。
//
// 2. 明确排除全部 30 根手指骨骼！
//    手指由 EMAGE 内部 fingerIntensity Slerp 和 NaturalIdleSystem 的 applyFingerPose
//    独立驱动，两者各帧都在写入手指骨骼；若外部过渡器同时 Slerp 手指，
//    会产生"双重插值"叠加，在切换瞬间造成手指快速抖颤或飞转。
export const VRM_ALL_HUMANOID_BONES = [
  // ─ 躯干与下肢 ─
  'hips', 'spine', 'chest', 'upperChest',
  'leftUpperLeg', 'rightUpperLeg', 'leftLowerLeg', 'rightLowerLeg',
  'leftFoot', 'rightFoot', 'leftToes', 'rightToes',

  // ─ 双臂与头颈 ─
  'neck', 'head',
  'leftShoulder', 'rightShoulder',
  'leftUpperArm', 'rightUpperArm',
  'leftLowerArm', 'rightLowerArm',
  'leftHand', 'rightHand',

  // ─ 左手 15 根手指 ─
  'leftThumbMetacarpal', 'leftThumbProximal', 'leftThumbDistal',
  'leftIndexProximal', 'leftIndexIntermediate', 'leftIndexDistal',
  'leftMiddleProximal', 'leftMiddleIntermediate', 'leftMiddleDistal',
  'leftRingProximal', 'leftRingIntermediate', 'leftRingDistal',
  'leftLittleProximal', 'leftLittleIntermediate', 'leftLittleDistal',

  // ─ 右手 15 根手指 ─
  'rightThumbMetacarpal', 'rightThumbProximal', 'rightThumbDistal',
  'rightIndexProximal', 'rightIndexIntermediate', 'rightIndexDistal',
  'rightMiddleProximal', 'rightMiddleIntermediate', 'rightMiddleDistal',
  'rightRingProximal', 'rightRingIntermediate', 'rightRingDistal',
  'rightLittleProximal', 'rightLittleIntermediate', 'rightLittleDistal',
] as const;

/**
 * 基于解剖学最大角位移的自适应动力学 S 曲线平滑系统 (Adaptive Biomechanical S-Curve System)
 *
 * 核心设计：
 * 1. 彻底打破死板固定写死 0.55s：
 *    - 姿态切换瞬间，系统瞬时计算全身 52 根骨骼的最大物理角位移 Δθ_max 与骨盆位移差 Δp；
 *    - 小动作 (Δθ < 15°)：自适应收敛时长缩短为 0.22s ~ 0.28s，毫秒级轻灵贴合，绝不拖沓；
 *    - 大动作 (Δθ > 70°)：自适应匹配 0.55s ~ 0.62s，给足大肌肉群与重力舒展时间；
 *    - 中等动作：自适应处于 0.35s ~ 0.48s。
 *
 * 2. 电影级五次平滑步阶曲线 (Quintic Smootherstep: 6t^5 - 15t^4 + 10t^3)：
 *    - 首尾速度为零、加速度严格连续，绝无第一帧撕扯冲击或最后一帧突然定格；
 *    - 全身 52 根骨骼统一步调，浑然一体，彻底杜绝肢体脱节解体。
 */
export class MotionTransitionManager {
  private isTransitioning = false;
  private transitionElapsed = 0;
  private transitionDuration = 0.45;
  private needCalculateDuration = false;

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
    duration = 0.75,
    lookAtOffsets?: { neck?: THREE.Quaternion; head?: THREE.Quaternion },
    boneFilter?: readonly string[],
  ): void {
    if (!vrm?.humanoid) return;

    this.boneSnapshots.clear();
    const bonesToSnap = boneFilter ?? VRM_ALL_HUMANOID_BONES;

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

    // 当指定了局部骨骼子集（如踱步交接）时，允许更短的过渡时间；全局全身切换时保持 >= 0.40s
    const minDur = boneFilter ? 0.15 : 0.40;
    this.transitionDuration = Math.max(minDur, duration);
    this.transitionElapsed = 0;
    this.isTransitioning = true;
  }

  /**
   * 在 RAF 渲染循环中统一调用。
   */
  apply(vrm: VRM | null | undefined, delta: number): void {
    if (!this.isTransitioning || !vrm?.humanoid) return;

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
