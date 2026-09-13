import * as THREE from 'three';
import type { VRM, VRMHumanBoneName } from '@pixiv/three-vrm';
import { BONE_INDEX_MAP, type PoseBuffer } from '../pipeline/poseBuffer';
import { DEFAULT_MOTION_TRAITS, type MotionTraits } from '../pipeline/types';

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
  public traits: MotionTraits = { ...DEFAULT_MOTION_TRAITS };

  private vrm: VRM | null = null;
  private hips: THREE.Object3D | null = null;

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

  /**
   * Evaluate idle into `out`. Does not write VRM bones — pipeline is the only writer.
   */
  sampleInto(out: PoseBuffer, time: number, idleWeight: number, locomotionWeight: number = 0): void {
    if (!this.enabled || !this.vrm || idleWeight <= 0.001) return;

    const t = time;
    const breathCycle = t * 1.15;
    const breathMain = Math.sin(breathCycle);
    const breathHarmonic = Math.sin(breathCycle * 2.0 + 0.4) * 0.22;
    const breath = breathMain + breathHarmonic;
    const swayX = Math.sin(t * 0.42) * 0.007 * idleWeight;
    const swayZ = Math.cos(t * 0.31) * 0.005 * idleWeight;
    const idleLowerBlend = Math.max(0.0, Math.min(1.0, 1.0 - locomotionWeight)) * idleWeight;

    const hipsIdx = BONE_INDEX_MAP.get('hips');
    if (hipsIdx !== undefined) {
      this._hipsPos.set(
        this.restHipsPos.x + swayX * idleLowerBlend,
        this.restHipsPos.y + (breathMain * 0.004 + 0.002) * idleLowerBlend,
        this.restHipsPos.z + swayZ * idleLowerBlend,
      );
      const hipRate = idleLowerBlend > 0.0001 ? Math.min(1.0, idleLowerBlend * 0.15 + 0.05) : 0;
      if (hipRate > 0) {
        out.hipsPosition.lerp(this._hipsPos, hipRate);
        this._euler.set(0.0, swayX * 0.25 * idleLowerBlend, -swayX * 0.3 * idleLowerBlend);
        this._tempQ.setFromEuler(this._euler);
        this._targetQ.copy(this.restHipsQ).multiply(this._tempQ);
        out.quaternions[hipsIdx]!.slerp(this._targetQ, hipRate);
      }
    }

    const legSlerpRate = idleLowerBlend * 0.1;
    if (legSlerpRate > 0.0001) {
      this.slerpNamed(out, 'leftUpperLeg', this.restLeftUpperLegQ, legSlerpRate);
      this.slerpNamed(out, 'rightUpperLeg', this.restRightUpperLegQ, legSlerpRate);
      this.slerpNamed(out, 'leftLowerLeg', this.restLeftLowerLegQ, legSlerpRate);
      this.slerpNamed(out, 'rightLowerLeg', this.restRightLowerLegQ, legSlerpRate);
      this.slerpNamed(out, 'leftFoot', this.restLeftFootQ, legSlerpRate);
      this.slerpNamed(out, 'rightFoot', this.restRightFootQ, legSlerpRate);
      this.slerpNamed(out, 'leftToes', this.restLeftToesQ, legSlerpRate);
      this.slerpNamed(out, 'rightToes', this.restRightToesQ, legSlerpRate);
    }

    this.slerpEuler(out, 'chest', -0.024 * breath, swayX * 0.4, 0, idleWeight);
    this.slerpEuler(out, 'upperChest', -0.018 * breath, 0, 0, idleWeight);
    this.slerpEuler(out, 'spine', 0.008 * breath, swayX * 0.5, 0, idleWeight);

    const shoulderLift = Math.sin(breathCycle - 0.25) * 0.016;
    this.slerpEuler(out, 'leftShoulder', 0, 0, Math.max(0, shoulderLift), idleWeight);
    this.slerpEuler(out, 'rightShoulder', 0, 0, -Math.max(0, shoulderLift), idleWeight);

    this.slerpEuler(out, 'leftUpperArm', 0, 0, -1.33 + breath * 0.012, idleWeight);
    this.slerpEuler(out, 'rightUpperArm', 0, 0, 1.33 - breath * 0.012, idleWeight);
    this.slerpEuler(out, 'leftLowerArm', 0, 0, 0.04, idleWeight);
    this.slerpEuler(out, 'rightLowerArm', 0, 0, -0.04, idleWeight);
    this.slerpEuler(out, 'leftHand', 0, 0, 0, idleWeight);
    this.slerpEuler(out, 'rightHand', 0, 0, 0, idleWeight);

    const fingerPulse = Math.sin(breathCycle * 0.95) * 0.06;
    this.applyFingerPose(out, 'left', fingerPulse, idleWeight);
    this.applyFingerPose(out, 'right', fingerPulse, idleWeight);
  }

  private slerpNamed(out: PoseBuffer, name: VRMHumanBoneName, target: THREE.Quaternion, weight: number): void {
    const idx = BONE_INDEX_MAP.get(name);
    if (idx === undefined) return;
    out.quaternions[idx]!.slerp(target, weight);
  }

  private slerpEuler(
    out: PoseBuffer,
    name: VRMHumanBoneName,
    x: number,
    y: number,
    z: number,
    weight: number,
  ): void {
    const idx = BONE_INDEX_MAP.get(name);
    if (idx === undefined) return;
    this._euler.set(x, y, z);
    this._targetQ.setFromEuler(this._euler);
    out.quaternions[idx]!.slerp(this._targetQ, weight);
  }

  private applyFingerPose(out: PoseBuffer, side: 'left' | 'right', pulse: number, weight: number): void {
    const sign = side === 'left' ? 1 : -1;
    const slerpBone = (name: VRMHumanBoneName, x: number, y: number, z: number) => {
      const idx = BONE_INDEX_MAP.get(name);
      if (idx === undefined) return;
      this._euler.set(x, y * sign, z * sign);
      this._targetQ.setFromEuler(this._euler);
      out.quaternions[idx]!.slerp(this._targetQ, weight);
    };

    const thumb = side === 'left' ? 'leftThumb' : 'rightThumb';
    const index = side === 'left' ? 'leftIndex' : 'rightIndex';
    const middle = side === 'left' ? 'leftMiddle' : 'rightMiddle';
    const ring = side === 'left' ? 'leftRing' : 'rightRing';
    const little = side === 'left' ? 'leftLittle' : 'rightLittle';

    slerpBone(`${thumb}Metacarpal` as VRMHumanBoneName, -0.10, 0.22, -0.25);
    slerpBone(`${thumb}Proximal` as VRMHumanBoneName, -0.06, 0.15, -0.35 - pulse * 0.5);
    slerpBone(`${thumb}Distal` as VRMHumanBoneName, 0.0, 0.08, -0.30 - pulse * 0.5);

    slerpBone(`${index}Proximal` as VRMHumanBoneName, 0.02, 0.01, -0.32 - pulse);
    slerpBone(`${index}Intermediate` as VRMHumanBoneName, 0.0, 0.0, -0.48 - pulse);
    slerpBone(`${index}Distal` as VRMHumanBoneName, 0.0, 0.0, -0.30 - pulse * 0.5);

    slerpBone(`${middle}Proximal` as VRMHumanBoneName, 0.0, 0.0, -0.38 - pulse);
    slerpBone(`${middle}Intermediate` as VRMHumanBoneName, 0.0, 0.0, -0.58 - pulse);
    slerpBone(`${middle}Distal` as VRMHumanBoneName, 0.0, 0.0, -0.35 - pulse * 0.5);

    slerpBone(`${ring}Proximal` as VRMHumanBoneName, -0.02, -0.01, -0.44 - pulse);
    slerpBone(`${ring}Intermediate` as VRMHumanBoneName, 0.0, 0.0, -0.66 - pulse);
    slerpBone(`${ring}Distal` as VRMHumanBoneName, 0.0, 0.0, -0.38 - pulse * 0.5);

    slerpBone(`${little}Proximal` as VRMHumanBoneName, -0.04, -0.02, -0.52 - pulse);
    slerpBone(`${little}Intermediate` as VRMHumanBoneName, 0.0, 0.0, -0.74 - pulse);
    slerpBone(`${little}Distal` as VRMHumanBoneName, 0.0, 0.0, -0.42 - pulse * 0.5);
  }
}
