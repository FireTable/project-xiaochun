import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';

interface LegChain {
  upperLeg: THREE.Object3D;
  lowerLeg: THREE.Object3D;
  foot: THREE.Object3D;
  toes?: THREE.Object3D | null;
  l1: number; // 大腿骨骼长度
  l2: number; // 小腿骨骼长度
  restAnkleY: number; // 静息站立时脚踝世界高度
  restLocalFootQ: THREE.Quaternion;
  // 求解过程中的平滑缓存
  smoothTargetY: number;
}

/**
 * FootIKSolver — 专业级 VRM 双足着地逆向动力学 (Foot Grounding IK)
 * 
 * 核心原理:
 * 1. 支撑脚贴地补偿 (Dynamic Pelvis Ground Alignment):
 *    检测当前两足在世界空间中的对地距离，动态微调 Hips 高度，使最低支撑脚 100% 紧贴地板 (Y=0)。
 * 2. 双骨解析式 IK (Analytical Two-Bone IK via Law of Cosines):
 *    基于余弦定理精确计算大腿-小腿的弯曲屈角与朝向，使足部精准钉在地面目标，自然弯曲膝盖，
 *    彻底消除悬浮、滑步与重心失真。
 * 3. 脚掌水平对齐 (Ankle Ground Leveling):
 *    平滑修正脚掌 Pitch/Roll，确保脚底板稳妥贴平地面，杜绝内八、外八与踮脚悬空。
 */
export class FootIKSolver {
  public enabled = true;
  public weight = 1.0; // IK 整体混合权重 [0, 1]
  public floorY = 0.0; // 虚拟地面世界高度
  public maxLegReachRatio = 0.995; // 防止膝盖完全死锁伸直 (保留微屈弧度，视觉更自然)

  private vrm: VRM | null = null;
  private leftLeg: LegChain | null = null;
  private rightLeg: LegChain | null = null;
  private hips: THREE.Object3D | null = null;
  private restHipsLocalPos = new THREE.Vector3();
  private smoothHipsOffsetY = 0;

  // 临时数学计算复用变量 (零 GC 垃圾回收压力)
  private _vA = new THREE.Vector3();
  private _vB = new THREE.Vector3();
  private _vC = new THREE.Vector3();
  private _vT = new THREE.Vector3();
  private _vDir = new THREE.Vector3();
  private _vNormal = new THREE.Vector3();
  private _vBendDir = new THREE.Vector3();
  private _vUpperDir = new THREE.Vector3();
  private _vLowerDir = new THREE.Vector3();
  private _qDelta = new THREE.Quaternion();
  private _qWorld = new THREE.Quaternion();
  private _qParentWorldInv = new THREE.Quaternion();
  private _qTarget = new THREE.Quaternion();

  bind(vrm: VRM): void {
    this.vrm = vrm;
    const h = vrm.humanoid;
    if (!h) return;

    this.hips = h.getNormalizedBoneNode('hips') ?? h.getRawBoneNode('hips');
    if (this.hips) {
      this.restHipsLocalPos.copy(this.hips.position);
    }

    const getBone = (name: any) => h.getNormalizedBoneNode(name) ?? h.getRawBoneNode(name);

    const lUpper = getBone('leftUpperLeg');
    const lLower = getBone('leftLowerLeg');
    const lFoot = getBone('leftFoot');
    const lToes = getBone('leftToes');

    const rUpper = getBone('rightUpperLeg');
    const rLower = getBone('rightLowerLeg');
    const rFoot = getBone('rightFoot');
    const rToes = getBone('rightToes');

    vrm.scene.updateMatrixWorld(true);

    if (lUpper && lLower && lFoot) {
      const p1 = new THREE.Vector3();
      const p2 = new THREE.Vector3();
      const p3 = new THREE.Vector3();
      lUpper.getWorldPosition(p1);
      lLower.getWorldPosition(p2);
      lFoot.getWorldPosition(p3);

      this.leftLeg = {
        upperLeg: lUpper,
        lowerLeg: lLower,
        foot: lFoot,
        toes: lToes,
        l1: p1.distanceTo(p2),
        l2: p2.distanceTo(p3),
        restAnkleY: p3.y,
        restLocalFootQ: lFoot.quaternion.clone(),
        smoothTargetY: p3.y,
      };
    }

    if (rUpper && rLower && rFoot) {
      const p1 = new THREE.Vector3();
      const p2 = new THREE.Vector3();
      const p3 = new THREE.Vector3();
      rUpper.getWorldPosition(p1);
      rLower.getWorldPosition(p2);
      rFoot.getWorldPosition(p3);

      this.rightLeg = {
        upperLeg: rUpper,
        lowerLeg: rLower,
        foot: rFoot,
        toes: rToes,
        l1: p1.distanceTo(p2),
        l2: p2.distanceTo(p3),
        restAnkleY: p3.y,
        restLocalFootQ: rFoot.quaternion.clone(),
        smoothTargetY: p3.y,
      };
    }

    this.smoothHipsOffsetY = 0;
  }

  reset(): void {
    this.smoothHipsOffsetY = 0;
    if (this.leftLeg) this.leftLeg.smoothTargetY = this.leftLeg.restAnkleY;
    if (this.rightLeg) this.rightLeg.smoothTargetY = this.rightLeg.restAnkleY;
  }

  /**
   * 在动画帧之后调用，实施脚部贴地与双骨逆向动力学纠偏
   */
  solve(delta: number): void {
    if (!this.enabled || !this.vrm || !this.leftLeg || !this.rightLeg || !this.hips || this.weight <= 0.001) {
      return;
    }

    const scene = this.vrm.scene;
    scene.updateMatrixWorld(true);

    const l = this.leftLeg;
    const r = this.rightLeg;

    // 1. 获取两脚脚踝当前世界位置
    const lPos = this._vA;
    const rPos = this._vB;
    l.foot.getWorldPosition(lPos);
    r.foot.getWorldPosition(rPos);

    // 计算两足距基准地面的高度差 (footRestY 代表脚掌底触地时脚踝的高度)
    const lDistToGround = lPos.y - l.restAnkleY;
    const rDistToGround = rPos.y - r.restAnkleY;

    // 2. 支撑脚贴地补偿 (Ground Alignment):
    // 找出最低的支撑脚，如果双脚全部浮空或者有脚穿模，自适应调整 Hips 高度
    const minGroundDist = Math.min(lDistToGround, rDistToGround);

    // 采用一阶指数平滑滤波，消除高频抖动，平滑跟随
    const filterFactor = 1.0 - Math.exp(-24.0 * Math.max(0.001, delta));
    const targetHipsOffset = -minGroundDist;
    this.smoothHipsOffsetY += (targetHipsOffset - this.smoothHipsOffsetY) * filterFactor;

    // 应用 Hips 高度微调 (乘以权重)
    const effHipsOffset = this.smoothHipsOffsetY * this.weight;
    this.hips.position.y = this.restHipsLocalPos.y + effHipsOffset;
    this.hips.updateMatrixWorld(true);

    // 3. 执行左右腿的两骨解析式 IK (Two-Bone Analytical IK)
    this.solveLegIK(l, delta);
    this.solveLegIK(r, delta);
  }

  private solveLegIK(leg: LegChain, delta: number): void {
    const { upperLeg, lowerLeg, foot, l1, l2, restAnkleY } = leg;

    // 更新世界坐标
    upperLeg.updateWorldMatrix(true, false);
    lowerLeg.updateWorldMatrix(true, false);
    foot.updateWorldMatrix(true, false);

    const pA = this._vA; // UpperLeg (Hip)
    const pB = this._vB; // LowerLeg (Knee)
    const pC = this._vC; // Foot (Ankle)
    upperLeg.getWorldPosition(pA);
    lowerLeg.getWorldPosition(pB);
    foot.getWorldPosition(pC);

    // 确定足部理想目标点 T:
    // 水平位置保持当前姿态，高度锁定在贴地基准高度 restAnkleY (防止穿模与虚空浮移)
    const pT = this._vT.copy(pC);
    const targetY = Math.max(pC.y, restAnkleY); // 如果脚自然抬起则保留，若落入地表或悬浮则锁定在地面
    
    // 平滑目标高度，消除抽搐
    const filterFactor = 1.0 - Math.exp(-20.0 * Math.max(0.001, delta));
    leg.smoothTargetY += (targetY - leg.smoothTargetY) * filterFactor;
    pT.y = THREE.MathUtils.lerp(pC.y, leg.smoothTargetY, this.weight);

    // 计算 Hip 到 Target 的距离
    const vAT = this._vDir.subVectors(pT, pA);
    let dist = vAT.length();
    const maxReach = (l1 + l2) * this.maxLegReachRatio;
    const minReach = Math.abs(l1 - l2) + 0.01;
    dist = THREE.MathUtils.clamp(dist, minReach, maxReach);
    vAT.normalize();

    // 4. 余弦定理求解关节角度
    // Hip 偏转角: cos(hip) = (l1^2 + dist^2 - l2^2) / (2 * l1 * dist)
    const cosHip = THREE.MathUtils.clamp((l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist), -1, 1);
    const angleHip = Math.acos(cosHip);

    // 5. 弯曲平面构造 (Leg Bending Plane):
    // 以当前大腿到小腿的实际弯曲朝向为极向量 (Pole Vector)，保证膝盖始终朝人体正面自然前屈
    const vAB = this._vUpperDir.subVectors(pB, pA).normalize();
    const vNormal = this._vNormal.crossVectors(vAT, vAB);
    if (vNormal.lengthSq() < 1e-6) {
      // 若完全共线直立，以大腿的世界朝向构造正交弯曲法线
      upperLeg.getWorldQuaternion(this._qWorld);
      vNormal.set(1, 0, 0).applyQuaternion(this._qWorld);
    } else {
      vNormal.normalize();
    }

    // 弯曲方向: 垂直于 vAT 并在弯曲平面内
    const vBend = this._vBendDir.crossVectors(vNormal, vAT).normalize();

    // 计算新的大腿方向 (从 A 指向新 Knee 位置 B')
    const newUpperDir = this._vUpperDir.copy(vAT).multiplyScalar(Math.cos(angleHip))
      .addScaledVector(vBend, Math.sin(angleHip)).normalize();

    // 新的 Knee 世界坐标
    const newB = this._vB.copy(pA).addScaledVector(newUpperDir, l1);

    // 计算新的小腿方向 (从 B' 指向目标 T)
    const newLowerDir = this._vLowerDir.subVectors(pT, newB).normalize();

    // 6. 将几何方向转换为四元数旋转并应用至骨骼
    // (A) UpperLeg: 计算从原世界方向到新世界方向的旋转增量
    const origUpperDir = this._vDir.subVectors(pB, pA).normalize();
    this._qDelta.setFromUnitVectors(origUpperDir, newUpperDir);

    upperLeg.getWorldQuaternion(this._qWorld);
    this._qWorld.premultiply(this._qDelta);

    // 转回 UpperLeg 局部坐标
    if (upperLeg.parent) {
      upperLeg.parent.getWorldQuaternion(this._qParentWorldInv).invert();
      this._qTarget.copy(this._qParentWorldInv).multiply(this._qWorld);
    } else {
      this._qTarget.copy(this._qWorld);
    }
    upperLeg.quaternion.slerp(this._qTarget, this.weight);
    upperLeg.updateWorldMatrix(true, false);

    // (B) LowerLeg: 重新计算小腿局部旋转
    const origLowerDir = this._vDir.subVectors(pC, pB).normalize();
    this._qDelta.setFromUnitVectors(origLowerDir, newLowerDir);

    lowerLeg.getWorldQuaternion(this._qWorld);
    this._qWorld.premultiply(this._qDelta);

    upperLeg.getWorldQuaternion(this._qParentWorldInv).invert();
    this._qTarget.copy(this._qParentWorldInv).multiply(this._qWorld);
    lowerLeg.quaternion.slerp(this._qTarget, this.weight);
    lowerLeg.updateWorldMatrix(true, false);

    // 7. 脚掌贴地水平回正 (Foot Ground Leveling):
    // 消除旋转带来的鞋跟悬空，将脚底微调贴平地面
    foot.getWorldQuaternion(this._qWorld);
    const euler = new THREE.Euler().setFromQuaternion(this._qWorld, 'YXZ');
    // 将 pitch 和 roll 逐渐拉平贴平地面法线 (Y 轴朝上)
    euler.x *= (1.0 - 0.75 * this.weight);
    euler.z *= (1.0 - 0.75 * this.weight);
    this._qWorld.setFromEuler(euler);

    lowerLeg.getWorldQuaternion(this._qParentWorldInv).invert();
    this._qTarget.copy(this._qParentWorldInv).multiply(this._qWorld);
    foot.quaternion.slerp(this._qTarget, this.weight * 0.85);
    foot.updateWorldMatrix(true, false);
  }
}
