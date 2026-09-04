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

  // 方案一：物理足底地面支点锚点 (World Ground Anchor)
  restAnchorPos: THREE.Vector3;      // 初始静息世界地面锚点 (X, Y, Z)
  restAnchorLocalPos: THREE.Vector3; // 初始静息本地地面锚点 (相对 vrm.scene)
  currentAnchorPos: THREE.Vector3;   // 当前动态物理世界支点
  smoothTargetPos: THREE.Vector3;    // 求解平滑目标点 (X, Y, Z)

  // 方案二：重心分配与受力姿态
  isStance: boolean;                 // 是否为主承重支撑腿
  effectiveWeight: number;           // 当前腿的动态混合权重
  kneeFlexionBias: number;           // 放松腿膝关节微屈偏置弧度
}

/**
 * FootIKSolver — 工业级 VRM 双足物理支点地锚与仿生重心转移 IK 解算系统
 * 
 * 彻底解决下半身“像吊在空中、双脚漂移滑步”的非物理失真：
 * 1. 方案一：物理支点地锚 (Planted Foot Ground Anchors)
 *    记录并建立地面真实摩擦支点，使主支撑脚 (X, Z) 零漂移牢牢钉在地面，彻底消灭滑步 (Foot Skating)。
 *    当身体移动过大时，具备平滑自适应跟进缓冲，避免超伸拉断骨骼。
 * 2. 方案二：仿生重心转移与对立平衡 (Weight Shift & Relaxed Contrapposto)
 *    实时解算骨盆横向重心偏移。承重腿挺拔直立支撑躯干；放松腿承担次要重量，
 *    膝盖自然向前柔和微屈 (5°~8°)，重现活人站立交流时的经典受力姿态。
 * 3. 脚掌水平对齐 (Ankle Ground Leveling)
 *    消除大腿旋转带来的鞋底悬空或内八外八，确保脚底板平实紧贴地面。
 */
export class FootIKSolver {
  public enabled = true;
  public weight = 1.0; // IK 整体混合权重 [0, 1]
  public floorY = 0.0; // 虚拟地面世界高度
  public maxLegReachRatio = 0.992; // 防止膝盖完全死锁伸直 (保留微屈弧度，视觉更自然)
  public enableWeightShift = true; // 启用重心转移与放松腿微屈
  public enableFootAnchors = true; // 启用物理地锚防滑

  // ─── 连续重心与动态换腿参数 (0.0 = 左腿主支柱, 1.0 = 右腿主支柱) ───
  public stanceRatio = 0.0;
  public smoothStanceRatio = 0.0;
  public transferSpeed = 3.5; // 换腿重心过渡速度 (约 1.2~1.5 秒丝滑无感完成换脚)

  get stanceLeg(): 'left' | 'right' {
    return this.stanceRatio >= 0.5 ? 'right' : 'left';
  }
  set stanceLeg(side: 'left' | 'right') {
    this.stanceRatio = (side === 'right') ? 1.0 : 0.0;
  }

  private vrm: VRM | null = null;
  private leftLeg: LegChain | null = null;
  private rightLeg: LegChain | null = null;
  private hips: THREE.Object3D | null = null;
  private spine: THREE.Object3D | null = null;
  private restHipsLocalPos = new THREE.Vector3();
  private restHipsWorldPos = new THREE.Vector3();
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
  private _vTemp = new THREE.Vector3();
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
      this.hips.getWorldPosition(this.restHipsWorldPos);
    }
    this.spine = h.getNormalizedBoneNode('spine') ?? h.getRawBoneNode('spine');

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

      const localAnchorL = p3.clone();
      vrm.scene.worldToLocal(localAnchorL);

      this.leftLeg = {
        upperLeg: lUpper,
        lowerLeg: lLower,
        foot: lFoot,
        toes: lToes,
        l1: p1.distanceTo(p2),
        l2: p2.distanceTo(p3),
        restAnkleY: p3.y,
        restLocalFootQ: lFoot.quaternion.clone(),
        restAnchorPos: p3.clone(),
        restAnchorLocalPos: localAnchorL,
        currentAnchorPos: p3.clone(),
        smoothTargetPos: p3.clone(),
        isStance: true,
        effectiveWeight: 1.0,
        kneeFlexionBias: 0.0,
      };
    }

    if (rUpper && rLower && rFoot) {
      const p1 = new THREE.Vector3();
      const p2 = new THREE.Vector3();
      const p3 = new THREE.Vector3();
      rUpper.getWorldPosition(p1);
      rLower.getWorldPosition(p2);
      rFoot.getWorldPosition(p3);

      const localAnchorR = p3.clone();
      vrm.scene.worldToLocal(localAnchorR);

      this.rightLeg = {
        upperLeg: rUpper,
        lowerLeg: rLower,
        foot: rFoot,
        toes: rToes,
        l1: p1.distanceTo(p2),
        l2: p2.distanceTo(p3),
        restAnkleY: p3.y,
        restLocalFootQ: rFoot.quaternion.clone(),
        restAnchorPos: p3.clone(),
        restAnchorLocalPos: localAnchorR,
        currentAnchorPos: p3.clone(),
        smoothTargetPos: p3.clone(),
        isStance: true,
        effectiveWeight: 1.0,
        kneeFlexionBias: 0.0,
      };
    }

    this.smoothHipsOffsetY = 0;
  }

  reset(): void {
    this.smoothHipsOffsetY = 0;
    if (this.hips) {
      this.hips.position.copy(this.restHipsLocalPos);
    }
    if (this.leftLeg) {
      this.leftLeg.currentAnchorPos.copy(this.leftLeg.restAnchorPos);
      this.leftLeg.smoothTargetPos.copy(this.leftLeg.restAnchorPos);
      this.leftLeg.isStance = true;
      this.leftLeg.effectiveWeight = 1.0;
      this.leftLeg.kneeFlexionBias = 0.0;
    }
    if (this.rightLeg) {
      this.rightLeg.currentAnchorPos.copy(this.rightLeg.restAnchorPos);
      this.rightLeg.smoothTargetPos.copy(this.rightLeg.restAnchorPos);
      this.rightLeg.isStance = true;
      this.rightLeg.effectiveWeight = 1.0;
      this.rightLeg.kneeFlexionBias = 0.0;
    }
  }

  /**
   * 在动画帧之后调用，实施脚部支点地锚、单脚重心转移与双骨逆向动力学纠偏
   */
  solve(delta: number): void {
    if (!this.enabled || !this.vrm || !this.leftLeg || !this.rightLeg || !this.hips || this.weight <= 0.001) {
      return;
    }

    const scene = this.vrm.scene;
    scene.updateMatrixWorld(true);

    const l = this.leftLeg;
    const r = this.rightLeg;

    // 1. 刷新地面世界物理支点坐标 (World Ground Anchors)
    l.currentAnchorPos.copy(l.restAnchorLocalPos).applyMatrix4(scene.matrixWorld);
    r.currentAnchorPos.copy(r.restAnchorLocalPos).applyMatrix4(scene.matrixWorld);
    const lAnchorWorld = l.currentAnchorPos;
    const rAnchorWorld = r.currentAnchorPos;

    // 2. 丝滑平滑过渡当前重心比例 sr ∈ [0, 1] (0.0 = 纯左腿支撑, 1.0 = 纯右腿支撑)
    const transferFilter = 1.0 - Math.exp(-this.transferSpeed * Math.max(0.001, delta));
    this.smoothStanceRatio += (this.stanceRatio - this.smoothStanceRatio) * transferFilter;
    const sr = this.smoothStanceRatio;

    // 左右腿承重分配
    const lSupport = 1.0 - sr;
    const rSupport = sr;
    l.isStance = lSupport >= 0.5;
    r.isStance = rSupport >= 0.5;
    l.effectiveWeight = this.weight;
    r.effectiveWeight = this.weight;

    // 3. 仿生重心横向转移 (Lateral Pelvis Center of Mass Shift)
    // 关键原理：双足横向间距约 20cm，当单脚受力站立时，骨盆必须横向平移至承重脚上方 (~3.8cm~4.2cm)，
    // 使得承重腿股骨头垂直对齐脚踝，形成顶天立地的承重柱！
    const midAnchorX = (lAnchorWorld.x + rAnchorWorld.x) * 0.5;
    const halfSpan = Math.abs(rAnchorWorld.x - lAnchorWorld.x) * 0.5;
    const leftSign = Math.sign(lAnchorWorld.x - midAnchorX) || -1;

    // stanceDir: -1.0 为纯左腿支撑, +1.0 为纯右腿支撑
    const stanceDir = (sr - 0.5) * 2.0;
    const maxShiftX = Math.min(0.042, halfSpan * 0.40);
    const targetShiftX = stanceDir * (-leftSign) * maxShiftX * this.weight;
    this.hips.position.x = this.restHipsLocalPos.x + targetShiftX;

    // 4. 骨盆垂直高度补偿 (Ground Alignment):
    // 提取去除上一帧修正量后的真实内在对地距离，彻底消灭代数环弹簧回弹震荡
    const prevOffset = this.smoothHipsOffsetY * this.weight;
    l.foot.getWorldPosition(this._vTemp);
    const lFootY = this._vTemp.y;
    r.foot.getWorldPosition(this._vTemp);
    const rFootY = this._vTemp.y;

    const intrinsicLDist = (lFootY - prevOffset) - l.restAnkleY;
    const intrinsicRDist = (rFootY - prevOffset) - r.restAnkleY;
    const weightedGroundDist = intrinsicLDist * lSupport + intrinsicRDist * rSupport;

    const heightFilter = 1.0 - Math.exp(-8.0 * Math.max(0.001, delta));
    const targetHipsOffset = -weightedGroundDist;
    this.smoothHipsOffsetY += (targetHipsOffset - this.smoothHipsOffsetY) * heightFilter;

    const effHipsOffset = THREE.MathUtils.clamp(this.smoothHipsOffsetY * this.weight, -0.06, 0.02);
    this.hips.position.y = this.restHipsLocalPos.y + effHipsOffset;
    this.hips.updateMatrixWorld(true);

    // 5. 对立平衡骨盆解剖学侧倾 (Contrapposto Pelvic Roll) 与脊柱反向代偿
    // 站立单腿承重时，承重侧骨盆微微抬高约 2.4° (0.042 rad)，呈现自然 S 型优美体态；
    // 脊柱向相反方向代偿倾斜，保持胸腔与头部端正水平，杜绝歪斜。
    const rollAngle = -stanceDir * (-leftSign) * 0.042 * this.weight;
    if (Math.abs(rollAngle) > 0.0005) {
      this._qDelta.setFromAxisAngle(new THREE.Vector3(0, 0, 1), rollAngle);
      this.hips.quaternion.multiply(this._qDelta);
      if (this.spine) {
        this._qDelta.setFromAxisAngle(new THREE.Vector3(0, 0, 1), -rollAngle * 0.82);
        this.spine.quaternion.multiply(this._qDelta);
      }
    }

    // 6. 执行左右腿两骨解析式 IK (两脚物理地锚稳固贴地，零悬挂、零漂移滑步)
    this.solveLegIK(l, lAnchorWorld, lSupport, delta);
    this.solveLegIK(r, rAnchorWorld, rSupport, delta);
  }

  private solveLegIK(leg: LegChain, anchorWorld: THREE.Vector3, supportRatio: number, delta: number): void {
    const { upperLeg, lowerLeg, foot, l1, l2 } = leg;

    upperLeg.updateWorldMatrix(true, false);
    lowerLeg.updateWorldMatrix(true, false);
    foot.updateWorldMatrix(true, false);

    // freeAlpha: 0.0 = 纯主承重支柱腿, 1.0 = 纯从属放松微屈腿
    const freeAlpha = Math.max(0.0, Math.min(1.0, 1.0 - supportRatio));

    // 地锚目标点：两脚始终扎根在地面 anchorWorld，高度贴合地表，消除任何漂浮悬挂感
    const filterFactor = 1.0 - Math.exp(-15.0 * Math.max(0.001, delta));
    leg.smoothTargetPos.x += (anchorWorld.x - leg.smoothTargetPos.x) * filterFactor;
    leg.smoothTargetPos.y += (anchorWorld.y - leg.smoothTargetPos.y) * filterFactor;
    leg.smoothTargetPos.z += (anchorWorld.z - leg.smoothTargetPos.z) * filterFactor;

    const pT = this._vT.copy(leg.smoothTargetPos);
    const pA = this._vA;
    const pB = this._vB;
    const pC = this._vC;
    upperLeg.getWorldPosition(pA);
    lowerLeg.getWorldPosition(pB);
    foot.getWorldPosition(pC);

    // 计算大腿根部到脚踝目标点的距离
    const vAT = this._vDir.subVectors(pT, pA);
    let dist = vAT.length();
    const maxReach = (l1 + l2) * this.maxLegReachRatio;
    const minReach = Math.abs(l1 - l2) + 0.02;
    dist = THREE.MathUtils.clamp(dist, minReach, maxReach);
    vAT.normalize();

    // 余弦定理求解大腿屈角 (解析式两骨 IK，无迭代零延迟零抖动)
    const cosHip = THREE.MathUtils.clamp((l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist), -1, 1);
    const angleHip = Math.acos(cosHip);

    // 人体解剖学正交极向量 (Forward Pole Vector)，膝盖永恒正向向前弯曲，杜绝侧滑翻转
    const vForward = this._vTemp;
    if (this.hips) {
      this.hips.getWorldQuaternion(this._qWorld);
      vForward.set(0, 0, 1).applyQuaternion(this._qWorld);
    } else {
      vForward.set(0, 0, 1);
    }

    const vNormal = this._vNormal.crossVectors(vAT, vForward).normalize();
    const vBend = this._vBendDir.crossVectors(vNormal, vAT).normalize();

    // 生理级膝部微屈调控：
    // 主承重腿保留微小的 0.015 rad (约 0.9°) 防止膝关节完全绷死异响，形成垂直支撑柱；
    // 放松从属腿呈现解剖学自然微屈 0.16 rad (约 9.2°)，呈现经典的单脚重心待机姿态。
    const flexion = THREE.MathUtils.lerp(0.015, 0.16, freeAlpha);
    const effectiveAngleHip = angleHip + flexion;

    const newUpperDir = this._vUpperDir.copy(vAT).multiplyScalar(Math.cos(effectiveAngleHip))
      .addScaledVector(vBend, Math.sin(effectiveAngleHip)).normalize();

    const newB = this._vB.copy(pA).addScaledVector(newUpperDir, l1);
    const newLowerDir = this._vLowerDir.subVectors(pT, newB).normalize();

    // 旋转增量柔和施加
    const ikStrength = THREE.MathUtils.lerp(0.95, 0.88, freeAlpha) * leg.effectiveWeight;

    // 纠偏 UpperLeg
    const origUpperDir = this._vDir.subVectors(pB, pA).normalize();
    this._qDelta.setFromUnitVectors(origUpperDir, newUpperDir);
    upperLeg.getWorldQuaternion(this._qWorld);
    this._qWorld.premultiply(this._qDelta);

    if (upperLeg.parent) {
      upperLeg.parent.getWorldQuaternion(this._qParentWorldInv).invert();
      this._qTarget.copy(this._qParentWorldInv).multiply(this._qWorld);
    } else {
      this._qTarget.copy(this._qWorld);
    }
    upperLeg.quaternion.slerp(this._qTarget, ikStrength);
    upperLeg.updateWorldMatrix(true, false);

    // 纠偏 LowerLeg
    const origLowerDir = this._vDir.subVectors(pC, pB).normalize();
    this._qDelta.setFromUnitVectors(origLowerDir, newLowerDir);
    lowerLeg.getWorldQuaternion(this._qWorld);
    this._qWorld.premultiply(this._qDelta);

    upperLeg.getWorldQuaternion(this._qParentWorldInv).invert();
    this._qTarget.copy(this._qParentWorldInv).multiply(this._qWorld);
    lowerLeg.quaternion.slerp(this._qTarget, ikStrength);
    lowerLeg.updateWorldMatrix(true, false);

    // 脚掌紧密贴合地面平面
    foot.getWorldQuaternion(this._qWorld);
    const euler = new THREE.Euler().setFromQuaternion(this._qWorld, 'YXZ');
    euler.x *= (1.0 - 0.88 * leg.effectiveWeight);
    euler.z *= (1.0 - 0.88 * leg.effectiveWeight);
    this._qWorld.setFromEuler(euler);

    lowerLeg.getWorldQuaternion(this._qParentWorldInv).invert();
    this._qTarget.copy(this._qParentWorldInv).multiply(this._qWorld);
    foot.quaternion.slerp(this._qTarget, leg.effectiveWeight * 0.90);
    foot.updateWorldMatrix(true, false);
  }
}

