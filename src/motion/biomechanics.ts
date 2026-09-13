import * as THREE from 'three';
import type { VRMHumanBoneName } from '@pixiv/three-vrm';

/**
 * 躯干与颈椎矢状面俯仰 (Pitch) 生理极限权威阈值表 (Single Source of Truth)
 * 在 VRM 规范化骨骼坐标系中，绕局部 X 轴旋转为矢状面俯仰 (Pitch)：
 * +X 为前屈躬身，-X 为后仰。
 *
 * 无论输入源来自 NaturalIdle、EMAGE 语音动作、VRMA 资产动画还是 UniversalMotion，
 * 也无论管线是否发生了下半身踱步 (BodyTurn) 图层解耦，
 * 管线终点合成器 (Compositor) 均严格执行此生理极限，从数学上彻底杜绝前躬、驼背与探颈！
 */
export const TORSO_PITCH_BONES: readonly VRMHumanBoneName[] = [
  'hips', 'spine', 'chest', 'upperChest',
];

export const TORSO_PITCH_LIMITS: Partial<Record<VRMHumanBoneName, { min: number; max: number }>> = {
  hips:       { min: -0.015, max: 0.03 },
  spine:      { min: -0.015, max: 0.02 },
  chest:      { min: -0.015, max: 0.02 },
  upperChest: { min: -0.02,  max: 0.025 },
};

// 预分配复用变量，确保 60/120 FPS 满帧零垃圾回收 (Zero-GC)
const _tmpEuler = new THREE.Euler(0, 0, 0, 'YXZ');
const _deltaQ = new THREE.Quaternion();

/**
 * 限制四元数的矢状面俯仰角 (Pitch)，彻底消除前躬、驼背与探颈
 * 采用 'YXZ' 欧拉角分解，100% 保留偏航 (Yaw, 转身转头) 与侧倾 (Roll, 侧身微动)
 *
 * @param qGoal    待限幅的目标四元数 (直接就地修改)
 * @param minPitch 最小俯仰角 (rad，后仰极限)
 * @param maxPitch 最大俯仰角 (rad，前屈极限)
 * @param rest     可选的静息姿态基准 (若提供则相对 rest 增量限幅)
 */
export function clampQuaternionPitch(
  qGoal: THREE.Quaternion,
  minPitch: number,
  maxPitch: number,
  rest?: THREE.Quaternion | null,
): void {
  if (rest) {
    _deltaQ.copy(rest).invert().multiply(qGoal);
    _tmpEuler.setFromQuaternion(_deltaQ, 'YXZ');
    _tmpEuler.x = THREE.MathUtils.clamp(_tmpEuler.x, minPitch, maxPitch);
    _deltaQ.setFromEuler(_tmpEuler);
    qGoal.copy(rest).multiply(_deltaQ);
  } else {
    _tmpEuler.setFromQuaternion(qGoal, 'YXZ');
    _tmpEuler.x = THREE.MathUtils.clamp(_tmpEuler.x, minPitch, maxPitch);
    qGoal.setFromEuler(_tmpEuler);
  }
}
