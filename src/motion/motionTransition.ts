import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';

// VRM 规范中全部 55 根人体标准化骨骼 (包括全身骨骼与左右手全部 30 个指节)
export const VRM_ALL_HUMANOID_BONES = [
  'hips', 'spine', 'chest', 'upperChest', 'neck', 'head',
  'leftShoulder', 'rightShoulder', 'leftUpperArm', 'rightUpperArm',
  'leftLowerArm', 'rightLowerArm', 'leftHand', 'rightHand',
  'leftUpperLeg', 'rightUpperLeg', 'leftLowerLeg', 'rightLowerLeg',
  'leftFoot', 'rightFoot', 'leftToes', 'rightToes',
  // 左手 15 个指节骨骼
  'leftThumbMetacarpal', 'leftThumbProximal', 'leftThumbDistal',
  'leftIndexProximal', 'leftIndexIntermediate', 'leftIndexDistal',
  'leftMiddleProximal', 'leftMiddleIntermediate', 'leftMiddleDistal',
  'leftRingProximal', 'leftRingIntermediate', 'leftRingDistal',
  'leftLittleProximal', 'leftLittleIntermediate', 'leftLittleDistal',
  // 右手 15 个指节骨骼
  'rightThumbMetacarpal', 'rightThumbProximal', 'rightThumbDistal',
  'rightIndexProximal', 'rightIndexIntermediate', 'rightIndexDistal',
  'rightMiddleProximal', 'rightMiddleIntermediate', 'rightMiddleDistal',
  'rightRingProximal', 'rightRingIntermediate', 'rightRingDistal',
  'rightLittleProximal', 'rightLittleIntermediate', 'rightLittleDistal',
] as const;

/**
 * 全局统一动作平滑过渡管理器 (Global Motion Transition Manager)
 * 解决 Idle -> Think -> Emage -> Idle 及 VRMA 动作切换时的一切跳变、瞬移与僵硬断层。
 *
 * 核心原理：
 * 任何动作源发起切换时，毫秒级无感知捕获模型全部 55 根骨骼的当前实时四元数与 hips/scene 坐标；
 * 在随后的过渡时间窗 (例如 0.55s) 内，利用五次平滑步阶 (Quintic Smootherstep) 曲线对每一根骨骼执行
 * 球面线性插值 (Slerp)，保证一阶导数与二阶导数严格连续，实现零冲击、无缝如丝的电影级过渡。
 */
export class MotionTransitionManager {
  private isTransitioning = false;
  private transitionElapsed = 0;
  private transitionDuration = 0.55;

  private boneSnapshots = new Map<string, THREE.Quaternion>();
  private hipsPosSnapshot = new THREE.Vector3();
  private sceneYSnapshot = 0;

  // 预分配 scratch 临时变量，杜绝 60/120 FPS RAF 循环中的垃圾回收卡顿 (GC Free)
  private _targetQ = new THREE.Quaternion();
  private _targetP = new THREE.Vector3();

  /**
   * 触发一次全局平滑过渡。
   * 记录当前瞬间角色的真实生理姿态。
   */
  startTransition(vrm: VRM | null | undefined, duration = 0.55): void {
    if (!vrm?.humanoid) return;

    // 1. 毫秒级捕获全部 55 根骨骼实时朝向
    for (const name of VRM_ALL_HUMANOID_BONES) {
      const node = vrm.humanoid.getNormalizedBoneNode(name as any);
      if (!node) continue;
      const snap = this.boneSnapshots.get(name);
      if (snap) {
        snap.copy(node.quaternion);
      } else {
        this.boneSnapshots.set(name, node.quaternion.clone());
      }
    }

    // 2. 捕获 hips 根骨骼世界/局部相对坐标
    const hips = vrm.humanoid.getNormalizedBoneNode('hips');
    if (hips) {
      this.hipsPosSnapshot.copy(hips.position);
    }

    // 3. 捕获模型场景垂直位置
    this.sceneYSnapshot = vrm.scene.position.y;

    this.transitionDuration = Math.max(0.08, duration);
    this.transitionElapsed = 0;
    this.isTransitioning = true;
  }

  /**
   * 在 RAF 渲染循环中，当当前活动动作生成器 (VRMA、EMAGE 或 NaturalIdle)
   * 刚刚更新好当前帧目标骨骼后统一调用。
   */
  apply(vrm: VRM | null | undefined, delta: number): void {
    if (!this.isTransitioning || !vrm?.humanoid) return;

    this.transitionElapsed += delta;
    const alpha = Math.min(1.0, this.transitionElapsed / this.transitionDuration);
    // 五次平滑步阶 (Quintic Smootherstep: 6t^5 - 15t^4 + 10t^3)
    // 具有首尾速度为零、加速度为零的特性，彻底抹除运动启停时的机械生硬感
    const t = alpha * alpha * alpha * (alpha * (alpha * 6 - 15) + 10);

    for (const [name, snapQ] of this.boneSnapshots.entries()) {
      const node = vrm.humanoid.getNormalizedBoneNode(name as any);
      if (!node) continue;
      // 保存当前动作生成器刚刚计算的目标四元数
      this._targetQ.copy(node.quaternion);
      // 将节点设为过渡起始快照，并向目标四元数平滑 Slerp
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
