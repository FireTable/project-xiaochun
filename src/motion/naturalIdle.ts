import * as THREE from 'three';
import type { VRM, VRMHumanBoneName } from '@pixiv/three-vrm';

interface FingerBoneGroup {
  proximal: THREE.Object3D | null;
  intermediate: THREE.Object3D | null;
  distal: THREE.Object3D | null;
  metacarpal?: THREE.Object3D | null;
}

interface HandFingers {
  thumb: FingerBoneGroup;
  index: FingerBoneGroup;
  middle: FingerBoneGroup;
  ring: FingerBoneGroup;
  little: FingerBoneGroup;
}

/**
 * NaturalIdleSystem — 工业级 VRM 高阶仿生自然待机系统
 * 
 * 彻底解决程序化待机"像木偶、手掌死板僵硬、呼吸单一机械"等痛点:
 * 1. 生理级十指微卷松弛态 (Biomechanical Relaxed Hands):
 *    依照人体解剖学静息姿态，大拇指微内扣、食指到小指呈现由浅入深的阶梯级自然半卷曲，
 *    彻底消除 T-Pose 扁平死硬的假人手掌。
 * 2. 多频复合呼吸微律动 (Multi-Harmonic Breathing):
 *    结合胸腔深呼浅吸主频 (0.24Hz) 与次谐波扩张，锁骨/肩膀伴随 0.25s 相位滞后微抬微滚，
 *    手指指节随脉搏呼吸微幅柔和浮沉 (Micro-pulse)。
 * 3. 8字形骨盆低频重心微移 (Lissajous Postural Balance Sway):
 *    骨盆/盆骨呈现周期约 9~12 秒的慢速微重力横向重心交替，脊柱伴随反向微补偿，呈现活人站姿。
 * 4. 意识流头部微视线微颤 (Organic Gaze & Head Wander):
 *    细微的 0.8°~1.2° 视线漂移与点头节奏，消除"头部被云台焊死"的机械呆滞感。
 */
export class NaturalIdleSystem {
  public enabled = true;

  private vrm: VRM | null = null;
  private hips: THREE.Object3D | null = null;
  private spine: THREE.Object3D | null = null;
  private chest: THREE.Object3D | null = null;
  private upperChest: THREE.Object3D | null = null;
  private neck: THREE.Object3D | null = null;
  private head: THREE.Object3D | null = null;

  private leftShoulder: THREE.Object3D | null = null;
  private rightShoulder: THREE.Object3D | null = null;
  private leftUpperArm: THREE.Object3D | null = null;
  private rightUpperArm: THREE.Object3D | null = null;
  private leftLowerArm: THREE.Object3D | null = null;
  private rightLowerArm: THREE.Object3D | null = null;
  private leftHand: THREE.Object3D | null = null;
  private rightHand: THREE.Object3D | null = null;

  private leftFingers: HandFingers | null = null;
  private rightFingers: HandFingers | null = null;

  // 下半身双腿与骨盆端正立姿关键骨骼
  private leftUpperLeg: THREE.Object3D | null = null;
  private rightUpperLeg: THREE.Object3D | null = null;
  private leftLowerLeg: THREE.Object3D | null = null;
  private rightLowerLeg: THREE.Object3D | null = null;
  private leftFoot: THREE.Object3D | null = null;
  private rightFoot: THREE.Object3D | null = null;
  private leftToes: THREE.Object3D | null = null;
  private rightToes: THREE.Object3D | null = null;

  private restHipsPos: THREE.Vector3 = new THREE.Vector3();
  private restHipsQ: THREE.Quaternion = new THREE.Quaternion();
  private restLeftUpperLegQ = new THREE.Quaternion();
  private restRightUpperLegQ = new THREE.Quaternion();
  private restLeftLowerLegQ = new THREE.Quaternion();
  private restRightLowerLegQ = new THREE.Quaternion();
  private restLeftFootQ = new THREE.Quaternion();
  private restRightFootQ = new THREE.Quaternion();
  private restLeftToesQ = new THREE.Quaternion();
  private restRightToesQ = new THREE.Quaternion();

  // 预分配临时复用对象，确保 60/120 FPS 满帧零垃圾回收 (Zero-GC)
  private _targetQ = new THREE.Quaternion();
  private _tempQ = new THREE.Quaternion();
  private _euler = new THREE.Euler();
  private _hipsPos = new THREE.Vector3();

  bind(vrm: VRM): void {
    this.vrm = vrm;
    const h = vrm.humanoid;
    if (!h) return;

    const getBone = (name: VRMHumanBoneName) => h.getNormalizedBoneNode(name) ?? h.getRawBoneNode(name);

    this.hips = getBone('hips');
    if (this.hips) {
      this.restHipsPos.copy(this.hips.position);
      this.restHipsQ.copy(this.hips.quaternion);
    }

    this.leftUpperLeg = getBone('leftUpperLeg');
    if (this.leftUpperLeg) this.restLeftUpperLegQ.copy(this.leftUpperLeg.quaternion);
    this.rightUpperLeg = getBone('rightUpperLeg');
    if (this.rightUpperLeg) this.restRightUpperLegQ.copy(this.rightUpperLeg.quaternion);
    this.leftLowerLeg = getBone('leftLowerLeg');
    if (this.leftLowerLeg) this.restLeftLowerLegQ.copy(this.leftLowerLeg.quaternion);
    this.rightLowerLeg = getBone('rightLowerLeg');
    if (this.rightLowerLeg) this.restRightLowerLegQ.copy(this.rightLowerLeg.quaternion);
    this.leftFoot = getBone('leftFoot');
    if (this.leftFoot) this.restLeftFootQ.copy(this.leftFoot.quaternion);
    this.rightFoot = getBone('rightFoot');
    if (this.rightFoot) this.restRightFootQ.copy(this.rightFoot.quaternion);
    this.leftToes = getBone('leftToes');
    if (this.leftToes) this.restLeftToesQ.copy(this.leftToes.quaternion);
    this.rightToes = getBone('rightToes');
    if (this.rightToes) this.restRightToesQ.copy(this.rightToes.quaternion);
    this.spine = getBone('spine');
    this.chest = getBone('chest');
    this.upperChest = getBone('upperChest');
    this.neck = getBone('neck');
    this.head = getBone('head');

    this.leftShoulder = getBone('leftShoulder');
    this.rightShoulder = getBone('rightShoulder');
    this.leftUpperArm = getBone('leftUpperArm');
    this.rightUpperArm = getBone('rightUpperArm');
    this.leftLowerArm = getBone('leftLowerArm');
    this.rightLowerArm = getBone('rightLowerArm');
    this.leftHand = getBone('leftHand');
    this.rightHand = getBone('rightHand');

    this.leftFingers = {
      thumb: {
        metacarpal: getBone('leftThumbMetacarpal'),
        proximal: getBone('leftThumbProximal'),
        intermediate: null,
        distal: getBone('leftThumbDistal'),
      },
      index: {
        proximal: getBone('leftIndexProximal'),
        intermediate: getBone('leftIndexIntermediate'),
        distal: getBone('leftIndexDistal'),
      },
      middle: {
        proximal: getBone('leftMiddleProximal'),
        intermediate: getBone('leftMiddleIntermediate'),
        distal: getBone('leftMiddleDistal'),
      },
      ring: {
        proximal: getBone('leftRingProximal'),
        intermediate: getBone('leftRingIntermediate'),
        distal: getBone('leftRingDistal'),
      },
      little: {
        proximal: getBone('leftLittleProximal'),
        intermediate: getBone('leftLittleIntermediate'),
        distal: getBone('leftLittleDistal'),
      },
    };

    this.rightFingers = {
      thumb: {
        metacarpal: getBone('rightThumbMetacarpal'),
        proximal: getBone('rightThumbProximal'),
        intermediate: null,
        distal: getBone('rightThumbDistal'),
      },
      index: {
        proximal: getBone('rightIndexProximal'),
        intermediate: getBone('rightIndexIntermediate'),
        distal: getBone('rightIndexDistal'),
      },
      middle: {
        proximal: getBone('rightMiddleProximal'),
        intermediate: getBone('rightMiddleIntermediate'),
        distal: getBone('rightMiddleDistal'),
      },
      ring: {
        proximal: getBone('rightRingProximal'),
        intermediate: getBone('rightRingIntermediate'),
        distal: getBone('rightRingDistal'),
      },
      little: {
        proximal: getBone('rightLittleProximal'),
        intermediate: getBone('rightLittleIntermediate'),
        distal: getBone('rightLittleDistal'),
      },
    };

    // 绑定瞬间立即应用静息态，消除任何 1 毫秒的 T-Pose 或手臂平伸僵硬
    this.applyRestPoseImmediate();
  }

  /**
   * 立即应用自然静息姿势（手臂垂顺 + 十指微卷半握），防止模型加载时呈现木偶 T-Pose
   */
  applyRestPoseImmediate(): void {
    if (!this.vrm) return;

    // 1. 双臂完全自然垂顺（手掌自然贴近/顺应裙身与大腿侧面，彻底去除向后支撑或外展的僵硬感）
    if (this.leftUpperArm) {
      this.leftUpperArm.quaternion.setFromEuler(new THREE.Euler(0.0, 0.0, -1.33));
    }
    if (this.rightUpperArm) {
      this.rightUpperArm.quaternion.setFromEuler(new THREE.Euler(0.0, 0.0, 1.33));
    }
    if (this.leftLowerArm) {
      this.leftLowerArm.quaternion.setFromEuler(new THREE.Euler(0.0, 0.0, 0.04));
    }
    if (this.rightLowerArm) {
      this.rightLowerArm.quaternion.setFromEuler(new THREE.Euler(0.0, 0.0, -0.04));
    }
    if (this.leftHand) {
      this.leftHand.quaternion.setFromEuler(new THREE.Euler(0.0, 0.0, 0.0));
    }
    if (this.rightHand) {
      this.rightHand.quaternion.setFromEuler(new THREE.Euler(0.0, 0.0, 0.0));
    }

    // 2. 十指立即以 Z 轴半卷松弛
    if (this.leftFingers) {
      this.applyFingerPoseImmediate(this.leftFingers, 1);
    }
    if (this.rightFingers) {
      this.applyFingerPoseImmediate(this.rightFingers, -1);
    }

    // 3. 下半身双腿与骨盆端正归位，消除任何腿部歪斜弯折
    if (this.hips) this.hips.quaternion.copy(this.restHipsQ);
    if (this.leftUpperLeg) this.leftUpperLeg.quaternion.copy(this.restLeftUpperLegQ);
    if (this.rightUpperLeg) this.rightUpperLeg.quaternion.copy(this.restRightUpperLegQ);
    if (this.leftLowerLeg) this.leftLowerLeg.quaternion.copy(this.restLeftLowerLegQ);
    if (this.rightLowerLeg) this.rightLowerLeg.quaternion.copy(this.restRightLowerLegQ);
    if (this.leftFoot) this.leftFoot.quaternion.copy(this.restLeftFootQ);
    if (this.rightFoot) this.rightFoot.quaternion.copy(this.restRightFootQ);
    if (this.leftToes) this.leftToes.quaternion.copy(this.restLeftToesQ);
    if (this.rightToes) this.rightToes.quaternion.copy(this.restRightToesQ);

    this.vrm.scene.updateMatrixWorld(true);
  }

  private applyFingerPoseImmediate(f: HandFingers, sign: number): void {
    const setBone = (b: THREE.Object3D | null | undefined, x: number, y: number, z: number) => {
      if (!b) return;
      b.quaternion.setFromEuler(new THREE.Euler(x, y * sign, z * sign));
    };

    // 拇指
    setBone(f.thumb.metacarpal, -0.10, 0.22, -0.25);
    setBone(f.thumb.proximal, -0.06, 0.15, -0.35);
    setBone(f.thumb.distal, 0.0, 0.08, -0.30);

    // 食指
    setBone(f.index.proximal, 0.02, 0.01, -0.32);
    setBone(f.index.intermediate, 0.0, 0.0, -0.48);
    setBone(f.index.distal, 0.0, 0.0, -0.30);

    // 中指
    setBone(f.middle.proximal, 0.0, 0.0, -0.38);
    setBone(f.middle.intermediate, 0.0, 0.0, -0.58);
    setBone(f.middle.distal, 0.0, 0.0, -0.35);

    // 无名指
    setBone(f.ring.proximal, -0.02, -0.01, -0.44);
    setBone(f.ring.intermediate, 0.0, 0.0, -0.66);
    setBone(f.ring.distal, 0.0, 0.0, -0.38);

    // 小指
    setBone(f.little.proximal, -0.04, -0.02, -0.52);
    setBone(f.little.intermediate, 0.0, 0.0, -0.74);
    setBone(f.little.distal, 0.0, 0.0, -0.42);
  }

  update(time: number, idleWeight: number, bodyTurnActive = false): void {
    if (!this.enabled || !this.vrm || idleWeight <= 0.001) return;

    const t = time;

    // ─── 1. 生理多频呼吸波形 ───
    // 主频约 0.25Hz (每 4 秒一次完整胸腹吸呼)，叠加轻微二次谐波
    const breathCycle = t * 1.15;
    const breathMain = Math.sin(breathCycle);
    const breathHarmonic = Math.sin(breathCycle * 2.0 + 0.4) * 0.22;
    const breath = breathMain + breathHarmonic; // [-1.22, 1.22]

    // ─── 2. 8 字形慢频骨盆重心移动 (9~12s 周期微平衡) ───
    const swayX = Math.sin(t * 0.42) * 0.007 * idleWeight;
    const swayZ = Math.cos(t * 0.31) * 0.005 * idleWeight;

    // ponytail: bodyTurn 踱步中让出下半身控制权 — naturalIdle 每帧 slerp 腿/髋回 rest
    // 会直接把 bodyTurn 的踱步姿态清零。头/颈/手指/呼吸不 gate,继续维持 LookAt 基础姿态,
    // 防止 LookAt.multiply() 在 head/neck 上逐帧累积造成 360° 旋转。
    const legWeight = bodyTurnActive ? 0.0 : idleWeight;

    if (this.hips && !bodyTurnActive) {
      this._hipsPos.set(
        this.restHipsPos.x + swayX,
        this.restHipsPos.y + (breathMain * 0.004 + 0.002) * idleWeight,
        this.restHipsPos.z + swayZ
      );
      this.hips.position.copy(this._hipsPos);

      // 骨盆朝向平滑回归端正站姿（微小重心摆动）
      this._euler.set(0.0, swayX * 0.25, -swayX * 0.3);
      this._tempQ.setFromEuler(this._euler);
      this._targetQ.copy(this.restHipsQ).multiply(this._tempQ);
      this.hips.quaternion.slerp(this._targetQ, idleWeight);
    }

    // ─── 2.1 下半身双腿与脚掌端正站姿保障（平滑插值回归标准立姿，彻底消除任何 EMAGE 或动作残留的歪斜、弯曲与脱臼） ───
    if (this.leftUpperLeg) this.leftUpperLeg.quaternion.slerp(this.restLeftUpperLegQ, legWeight);
    if (this.rightUpperLeg) this.rightUpperLeg.quaternion.slerp(this.restRightUpperLegQ, legWeight);
    if (this.leftLowerLeg) this.leftLowerLeg.quaternion.slerp(this.restLeftLowerLegQ, legWeight);
    if (this.rightLowerLeg) this.rightLowerLeg.quaternion.slerp(this.restRightLowerLegQ, legWeight);
    if (this.leftFoot) this.leftFoot.quaternion.slerp(this.restLeftFootQ, legWeight);
    if (this.rightFoot) this.rightFoot.quaternion.slerp(this.restRightFootQ, legWeight);
    if (this.leftToes) this.leftToes.quaternion.slerp(this.restLeftToesQ, legWeight);
    if (this.rightToes) this.rightToes.quaternion.slerp(this.restRightToesQ, legWeight);

    // ─── 3. 胸腔与脊柱呼吸扩张 ───
    if (this.chest) {
      this._euler.set(-0.024 * breath, swayX * 0.4, swayZ * 0.6);
      this._targetQ.setFromEuler(this._euler);
      this.chest.quaternion.slerp(this._targetQ, idleWeight);
    }
    if (this.upperChest) {
      this._euler.set(-0.018 * breath, 0, 0);
      this._targetQ.setFromEuler(this._euler);
      this.upperChest.quaternion.slerp(this._targetQ, idleWeight);
    }
    if (this.spine) {
      this._euler.set(0.008 * breath, swayX * 0.5, swayZ * 0.5);
      this._targetQ.setFromEuler(this._euler);
      this.spine.quaternion.slerp(this._targetQ, idleWeight);
    }

    // ─── 4. 肩膀/锁骨微耸 (吸气时微滞后向上微抬微滚) ───
    const shoulderLift = Math.sin(breathCycle - 0.25) * 0.016;
    if (this.leftShoulder) {
      this._euler.set(0, 0, Math.max(0, shoulderLift));
      this._targetQ.setFromEuler(this._euler);
      this.leftShoulder.quaternion.slerp(this._targetQ, idleWeight);
    }
    if (this.rightShoulder) {
      this._euler.set(0, 0, -Math.max(0, shoulderLift));
      this._targetQ.setFromEuler(this._euler);
      this.rightShoulder.quaternion.slerp(this._targetQ, idleWeight);
    }

    // ─── 5. 双臂完全自然垂顺（手掌自然贴近/顺应裙身与大腿侧面，彻底去除向后支撑的僵硬感） ───
    // UpperArm: 自然垂挂 (~ -76°)，随呼吸极其轻微舒张；零后弓，零多余扭曲
    const armHangZ_L = -1.33 + breath * 0.012;
    const armHangZ_R =  1.33 - breath * 0.012;

    if (this.leftUpperArm) {
      this._euler.set(0.0, 0.0, armHangZ_L);
      this._targetQ.setFromEuler(this._euler);
      this.leftUpperArm.quaternion.slerp(this._targetQ, idleWeight);
    }
    if (this.rightUpperArm) {
      this._euler.set(0.0, 0.0, armHangZ_R);
      this._targetQ.setFromEuler(this._euler);
      this.rightUpperArm.quaternion.slerp(this._targetQ, idleWeight);
    }

    // 肘关节自然微弯 slack
    if (this.leftLowerArm) {
      this._euler.set(0.0, 0.0, 0.04);
      this._targetQ.setFromEuler(this._euler);
      this.leftLowerArm.quaternion.slerp(this._targetQ, idleWeight);
    }
    if (this.rightLowerArm) {
      this._euler.set(0.0, 0.0, -0.04);
      this._targetQ.setFromEuler(this._euler);
      this.rightLowerArm.quaternion.slerp(this._targetQ, idleWeight);
    }

    // 手腕自然垂顺：掌心自然贴合裙侧，手指自然沿大腿/裙边优雅垂下
    if (this.leftHand) {
      this._euler.set(0.0, 0.0, 0.0);
      this._targetQ.setFromEuler(this._euler);
      this.leftHand.quaternion.slerp(this._targetQ, idleWeight);
    }
    if (this.rightHand) {
      this._euler.set(0.0, 0.0, 0.0);
      this._targetQ.setFromEuler(this._euler);
      this.rightHand.quaternion.slerp(this._targetQ, idleWeight);
    }

    // ─── 6. 核心：十指 Z 轴真指节向内自然半卷 (Biomechanical Knuckle Flexion) ───
    // 在 VRM 1.0 规范中，Z 轴是真正的关节屈伸轴！配合呼吸动态张弛 (pulse) 产生清晰可见的指关节微动
    const fingerPulse = Math.sin(breathCycle * 0.95) * 0.06;

    if (this.leftFingers) {
      this.applyFingerPose(this.leftFingers, fingerPulse, idleWeight, 1);
    }
    if (this.rightFingers) {
      this.applyFingerPose(this.rightFingers, fingerPulse, idleWeight, -1);
    }

    // ─── 7. 头部生命感微视线漂移 (Micro-Gaze Wander) ───
    if (this.head) {
      const headX = (Math.sin(t * 1.15) * 0.012 - 0.008) * idleWeight;
      const headY = Math.sin(t * 0.65) * 0.022 * idleWeight;
      const headZ = (-swayZ * 0.6 + Math.sin(t * 0.9) * 0.015) * idleWeight;
      this._euler.set(headX, headY, headZ);
      this._targetQ.setFromEuler(this._euler);
      this.head.quaternion.slerp(this._targetQ, idleWeight);
    }
    if (this.neck) {
      const neckY = Math.sin(t * 0.65) * 0.012 * idleWeight;
      this._euler.set(0, neckY, 0);
      this._targetQ.setFromEuler(this._euler);
      this.neck.quaternion.slerp(this._targetQ, idleWeight);
    }
  }

  /**
   * 应用自然半卷放松手势 (以 Z 轴实施真指关节内屈)
   * @param f 手指骨骼引用
   * @param pulse 呼吸微律动 (约 ±3.5 度呼吸浮沉)
   * @param weight 混合权重
   * @param sign 左右对称标志 (1: 左手, -1: 右手)
   */
  private applyFingerPose(f: HandFingers, pulse: number, weight: number, sign: number): void {
    const slerpBone = (b: THREE.Object3D | null | undefined, x: number, y: number, z: number) => {
      if (!b) return;
      this._euler.set(x, y * sign, z * sign);
      this._targetQ.setFromEuler(this._euler);
      b.quaternion.slerp(this._targetQ, weight);
    };

    // ── 拇指 (自然前倾对掌，拇指在身前内侧) ──
    slerpBone(f.thumb.metacarpal, -0.10, 0.22, -0.25);
    slerpBone(f.thumb.proximal, -0.06, 0.15, -0.35 - pulse * 0.5);
    slerpBone(f.thumb.distal, 0.0, 0.08, -0.30 - pulse * 0.5);

    // ── 食指 (顺应大腿下垂，指尖向掌心自然半卷弧线) ──
    slerpBone(f.index.proximal, 0.02, 0.01, -0.32 - pulse);
    slerpBone(f.index.intermediate, 0.0, 0.0, -0.48 - pulse);
    slerpBone(f.index.distal, 0.0, 0.0, -0.30 - pulse * 0.5);

    // ── 中指 (卷度略增) ──
    slerpBone(f.middle.proximal, 0.0, 0.0, -0.38 - pulse);
    slerpBone(f.middle.intermediate, 0.0, 0.0, -0.58 - pulse);
    slerpBone(f.middle.distal, 0.0, 0.0, -0.35 - pulse * 0.5);

    // ── 无名指 ──
    slerpBone(f.ring.proximal, -0.02, -0.01, -0.44 - pulse);
    slerpBone(f.ring.intermediate, 0.0, 0.0, -0.66 - pulse);
    slerpBone(f.ring.distal, 0.0, 0.0, -0.38 - pulse * 0.5);

    // ── 小指 (经典动漫美型放松卷度最深) ──
    slerpBone(f.little.proximal, -0.04, -0.02, -0.52 - pulse);
    slerpBone(f.little.intermediate, 0.0, 0.0, -0.74 - pulse);
    slerpBone(f.little.distal, 0.0, 0.0, -0.42 - pulse * 0.5);
  }
}
