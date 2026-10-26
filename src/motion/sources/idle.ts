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

export interface BodyTurnPhysicsContext {
  yawVel: number;
  isStepping: boolean;
  stepLeft: boolean;
  phase: number;
  phaseProgress: number;
}

/**
 * 自然待机系统 (Natural Idle System)
 *
 * 专注于人体站姿的真实感与松弛感（杜绝程序化机械假人）：
 * 1. 真实换脚站姿状态机 (Weight-Shift State): 模拟人站久了重心在左右脚之间缓慢自然转换。
 * 2. 非对称松弛手臂 (Asymmetric Rest Arms): 承重侧手臂自然下垂贴腿，放松侧肘部自然微屈 12°~16°，十指保持解剖学自然微屈半握，杜绝机械抽动。
 * 3. 慢速有机微晃 (Organic Vital Sway): 周期 6~8s 的横向与微侧晃动，消灭石膏雕像感。
 * 4. 偶发深吸气叹息 (Deep Sigh / Breath Relief): 每隔 28~48s 胸腔微起伏舒展。
 * 5. 偶发躯干轻微舒展 (Torso Stretch / Micro-turn)。
 * 6. 严格优先级让位: 说话 (isSpeaking) 或踱步 (locomotionWeight > 0) 时迅速平滑让位。
 * 7. 步态动力学耦合 (Locomotion Inertia & Follow-through): 转身时躯干惯性滞后、摆臂随动与回弹。
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

  // ── 模块 1：站姿重心换脚状态机 (Weight-Shift State) ──
  private currentWeightShift = 0.0; // -1 (左脚) ~ 1 (右脚)
  private targetWeightShift = 0.0;
  private weightShiftTimer = 5.0;
  private isShiftingWeight = false;
  private shiftProgress = 0.0;
  private shiftStartValue = 0.0;
  private shiftDuration = 1.6;

  // ── 模块 2：偶发舒展微转体 (Torso Stretch / Micro-turn) ──
  private torsoTurnTimer = 10.0;
  private torsoTurnPhase: 'idle' | 'enter' | 'hold' | 'exit' = 'idle';
  private torsoTurnElapsed = 0.0;
  private torsoTurnDuration = 0.0;
  private torsoTurnTargetYaw = 0.0;
  private currentTorsoTurnYaw = 0.0;

  // ── 模块 3：偶发深吸气叹息 (Deep Sigh / Breath Relief) ──
  private deepBreathTimer = 20.0;
  private isDeepBreathing = false;
  private deepBreathElapsed = 0.0;
  private currentDeepBreathPower = 0.0;


  // 预分配临时复用对象，确保 60/120 FPS 满帧零垃圾回收 (Zero-GC)
  private _targetQ = new THREE.Quaternion();
  private _tempQ = new THREE.Quaternion();
  private _euler = new THREE.Euler();
  private _hipsPos = new THREE.Vector3();
  private lastTime = 0;

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

    // 拇指 (掌侧外展微倾，自然依托掌侧)
    setBone(f.thumb.metacarpal, -0.06, 0.12, -0.10);
    setBone(f.thumb.proximal, -0.03, 0.08, -0.12);
    setBone(f.thumb.distal, 0.0, 0.04, -0.08);

    // 食指 (放松微曲约 7°~13°，呈优雅阶梯)
    setBone(f.index.proximal, 0.015, 0.008, -0.15);
    setBone(f.index.intermediate, 0.0, 0.0, -0.22);
    setBone(f.index.distal, 0.0, 0.0, -0.10);

    // 中指
    setBone(f.middle.proximal, 0.0, 0.0, -0.17);
    setBone(f.middle.intermediate, 0.0, 0.0, -0.26);
    setBone(f.middle.distal, 0.0, 0.0, -0.12);

    // 无名指
    setBone(f.ring.proximal, -0.015, -0.008, -0.20);
    setBone(f.ring.intermediate, 0.0, 0.0, -0.30);
    setBone(f.ring.distal, 0.0, 0.0, -0.14);

    // 小指
    setBone(f.little.proximal, -0.025, -0.015, -0.24);
    setBone(f.little.intermediate, 0.0, 0.0, -0.34);
    setBone(f.little.distal, 0.0, 0.0, -0.16);
  }

  /**
   * Evaluate idle into `out`. Does not write VRM bones — pipeline is the only writer.
   */
  sampleInto(
    out: PoseBuffer,
    time: number,
    idleWeight: number,
    locomotionWeight: number = 0,
    deltaParam?: number,
    isSpeaking: boolean = false,
    isActiveAction: boolean = false,
    _bodyTurnCtx?: BodyTurnPhysicsContext,
  ): void {
    if (!this.enabled || !this.vrm || idleWeight <= 0.001) return;

    const dt = deltaParam ?? (this.lastTime > 0 ? Math.min(0.1, Math.max(0.001, time - this.lastTime)) : 0.016);
    this.lastTime = time;

    const isBusy = isSpeaking || isActiveAction || locomotionWeight > 0.1 || Boolean(_bodyTurnCtx?.isStepping);

    // 踱步或移心期间：将待机旧重心平滑归零，杜绝转身停步后骨盆横向猛拽或反向跳变
    if (locomotionWeight > 0.05 || _bodyTurnCtx?.isStepping) {
      this.currentWeightShift = THREE.MathUtils.damp(this.currentWeightShift, 0.0, 12.0, dt);
      this.isShiftingWeight = false;
      this.shiftProgress = 0;
      this.weightShiftTimer = 8.0 + Math.random() * 8.0;

      if (this.torsoTurnPhase !== 'idle') {
        this.torsoTurnPhase = 'idle';
        this.currentTorsoTurnYaw = THREE.MathUtils.damp(this.currentTorsoTurnYaw, 0.0, 12.0, dt);
        this.torsoTurnTimer = 12.0 + Math.random() * 8.0;
      }
    }

    // ── 模块 1：站姿重心换脚状态机 (Weight-Shift State) ──
    // 告别连续机械摇摆：换脚后在左脚或右脚稳稳停靠 10~22 秒，重力感扎实真实；思考与动作期间绝不突兀换腿
    if (!this.isShiftingWeight) {
      if (!isBusy) {
        this.weightShiftTimer -= dt;
        if (this.weightShiftTimer <= 0) {
          this.shiftStartValue = this.currentWeightShift;
          if (Math.abs(this.currentWeightShift) < 0.2) {
            this.targetWeightShift = Math.random() < 0.5 ? (0.65 + Math.random() * 0.35) : -(0.65 + Math.random() * 0.35);
          } else if (this.currentWeightShift > 0) {
            this.targetWeightShift = Math.random() < 0.75 ? -(0.65 + Math.random() * 0.35) : 0;
          } else {
            this.targetWeightShift = Math.random() < 0.75 ? (0.65 + Math.random() * 0.35) : 0;
          }
          this.shiftProgress = 0;
          this.shiftDuration = 1.4 + Math.random() * 0.8;
          this.isShiftingWeight = true;
        }
      }
    } else if (!isBusy) {
      this.shiftProgress += (dt / this.shiftDuration);
      if (this.shiftProgress >= 1.0) {
        this.shiftProgress = 1.0;
        this.currentWeightShift = this.targetWeightShift;
        this.isShiftingWeight = false;
        this.weightShiftTimer = 10.0 + Math.random() * 12.0;
      } else {
        const p = this.shiftProgress;
        const smoothP = p * p * p * (p * (p * 6 - 15) + 10);
        this.currentWeightShift = this.shiftStartValue + (this.targetWeightShift - this.shiftStartValue) * smoothP;
      }
    }

    // ── 模块 2：偶发身躯转转与舒展 (Torso Stretch / Micro-turn) ──
    if (this.torsoTurnPhase === 'idle') {
      if (!isBusy) {
        this.torsoTurnTimer -= dt;
        if (this.torsoTurnTimer <= 0) {
          this.torsoTurnPhase = 'enter';
          this.torsoTurnElapsed = 0;
          const side = Math.random() < 0.5 ? 1 : -1;
          this.torsoTurnTargetYaw = side * (0.055 + Math.random() * 0.035);
        }
      }
    } else if (this.torsoTurnPhase === 'enter') {
      if (isBusy) {
        this.torsoTurnPhase = 'exit';
        this.torsoTurnElapsed = 0;
      } else {
        this.torsoTurnElapsed += dt;
        const enterDur = 1.2;
        const p = Math.min(1.0, this.torsoTurnElapsed / enterDur);
        const smoothP = p * p * (3 - 2 * p);
        this.currentTorsoTurnYaw = this.torsoTurnTargetYaw * smoothP;
        if (p >= 1.0) {
          this.torsoTurnPhase = 'hold';
          this.torsoTurnElapsed = 0;
          this.torsoTurnDuration = 3.0 + Math.random() * 2.5;
        }
      }
    } else if (this.torsoTurnPhase === 'hold') {
      this.torsoTurnElapsed += dt;
      if (this.torsoTurnElapsed >= this.torsoTurnDuration || isBusy) {
        this.torsoTurnPhase = 'exit';
        this.torsoTurnElapsed = 0;
      }
    } else if (this.torsoTurnPhase === 'exit') {
      this.torsoTurnElapsed += dt;
      const exitDur = isBusy ? 0.75 : 1.4;
      const p = Math.min(1.0, this.torsoTurnElapsed / exitDur);
      const smoothP = p * p * (3 - 2 * p);
      this.currentTorsoTurnYaw = this.torsoTurnTargetYaw * (1.0 - smoothP);
      if (p >= 1.0) {
        this.currentTorsoTurnYaw = 0;
        this.torsoTurnPhase = 'idle';
        this.torsoTurnTimer = 16.0 + Math.random() * 18.0;
      }
    }

    // ── 模块 3：偶发深吸气叹息 (Deep Sigh / Breath Relief) ──
    if (!this.isDeepBreathing) {
      if (!isBusy) {
        this.deepBreathTimer -= dt;
        if (this.deepBreathTimer <= 0) {
          this.isDeepBreathing = true;
          this.deepBreathElapsed = 0;
        }
      }
    } else {
      this.deepBreathElapsed += dt;
      const totalDur = 4.2;
      if (this.deepBreathElapsed >= totalDur || isBusy) {
        this.isDeepBreathing = false;
        this.currentDeepBreathPower = 0;
        this.deepBreathTimer = 32.0 + Math.random() * 25.0;
      } else {
        const tS = this.deepBreathElapsed;
        if (tS < 1.5) {
          const p = tS / 1.5;
          this.currentDeepBreathPower = Math.sin(p * Math.PI * 0.5);
        } else {
          const p = (tS - 1.5) / 2.7;
          this.currentDeepBreathPower = Math.cos(p * Math.PI * 0.5);
        }
      }
    }

    // ── 模块 4：轻柔生命基态呼吸 (Subtle Baseline Breath) ──
    const breathCycle = time * 1.25;
    const baseBreath = Math.sin(breathCycle) * 0.5 + Math.sin(breathCycle * 2.0 + 0.3) * 0.12;

    // 优先级防护：BodyTurn 介入或主动作激活时下半身与转体优雅让位
    const actionFade = isActiveAction ? 0.0 : 1.0;
    const idleLowerBlend = Math.max(0.0, Math.min(1.0, 1.0 - locomotionWeight)) * idleWeight;

    // ── 身体慢速有机微晃 (Organic Sway: 周期 6~8s，横向 ±7mm，微侧转 ±1.2°，消除石膏雕像死板感) ──
    const organicSwayX = (Math.sin(time * 0.55) * 0.007 + Math.sin(time * 0.28) * 0.004) * idleLowerBlend * actionFade;
    const organicSwayZ = Math.cos(time * 0.42) * 0.005 * idleLowerBlend * actionFade;
    const organicSwayYaw = Math.sin(time * 0.35) * 0.015 * actionFade;

    // ── 骨盆 Hips：换脚站姿停靠 + 有机微晃 + 浅呼吸微沉浮 ──
    const hipsIdx = BONE_INDEX_MAP.get('hips');
    if (hipsIdx !== undefined) {
      const hipSwayX = (this.currentWeightShift * 0.016 * idleWeight + organicSwayX) * (isActiveAction ? 0.5 : 1.0);
      const hipBobY = (baseBreath * 0.0025 + this.currentDeepBreathPower * 0.004) * idleWeight * actionFade;
      this._hipsPos.set(
        this.restHipsPos.x + hipSwayX * idleLowerBlend,
        this.restHipsPos.y + hipBobY * idleLowerBlend,
        this.restHipsPos.z + organicSwayZ,
      );
      const hipRate = idleLowerBlend > 0.0001 ? Math.min(1.0, idleLowerBlend * 0.20 + 0.05) : 0;
      if (hipRate > 0) {
        out.hipsPosition.lerp(this._hipsPos, hipRate);
        const hipRoll = -this.currentWeightShift * 0.026 * idleLowerBlend * actionFade;
        const hipYaw = (this.currentWeightShift * 0.032 + this.currentTorsoTurnYaw * 0.25 + organicSwayYaw) * idleLowerBlend * actionFade;
        this._euler.set(0.0, hipYaw, hipRoll);
        this._tempQ.setFromEuler(this._euler);
        this._targetQ.copy(this.restHipsQ).multiply(this._tempQ);
        out.quaternions[hipsIdx]!.slerp(this._targetQ, hipRate);
      }
    }

    // 双腿端正保持微弱稳定率，踱步时由 BodyTurn 接管
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

    // ── 躯干脊柱与胸腔 (Spine & Chest) ──
    // 原地小踱步转身保持上半身平稳端庄，不施加反向力矩扭扯与侧倾代偿，彻底消灭起步时的回正抽动与偏斜
    const spinePitch = 0.010 * baseBreath + 0.015 * this.currentDeepBreathPower;
    const spineYaw = (this.currentTorsoTurnYaw * 0.65 - this.currentWeightShift * 0.010 + organicSwayYaw * 0.6) * actionFade;
    const spineRoll = this.currentWeightShift * 0.018 * idleLowerBlend;
    this.slerpEuler(out, 'spine', spinePitch, spineYaw, spineRoll, idleWeight);

    const chestPitch = -0.022 * baseBreath - 0.048 * this.currentDeepBreathPower;
    const chestYaw = (this.currentTorsoTurnYaw * 0.85 - this.currentWeightShift * 0.008 + organicSwayYaw * 0.8) * actionFade;
    const chestRoll = this.currentWeightShift * 0.012 * idleLowerBlend;
    this.slerpEuler(out, 'chest', chestPitch, chestYaw, chestRoll, idleWeight);

    const upperChestPitch = -0.014 * baseBreath - 0.028 * this.currentDeepBreathPower;
    const upperChestYaw = this.currentTorsoTurnYaw * 0.30 * actionFade;
    this.slerpEuler(out, 'upperChest', upperChestPitch, upperChestYaw, 0, idleWeight);

    // ── 双肩与锁骨 ──
    const shoulderLift = Math.max(0, baseBreath) * 0.016 + this.currentDeepBreathPower * 0.035;
    this.slerpEuler(out, 'leftShoulder', 0, 0, shoulderLift, idleWeight);
    this.slerpEuler(out, 'rightShoulder', 0, 0, -shoulderLift, idleWeight);

    // ── 双臂与小臂芦苇晃动 (Organic Arm & Forearm Reed Sway) ──
    const swaySlow = time * 0.55;

    // 上臂悬垂微动 (UpperArm Float)
    const leftUpperPitch = Math.sin(breathCycle - 0.30) * 0.012 + (this.currentWeightShift > 0.3 ? 0.015 : 0.0);
    const rightUpperPitch = Math.sin(breathCycle - 0.38) * 0.012 + (this.currentWeightShift < -0.3 ? 0.015 : 0.0);
    const leftUpperRoll = -1.33 - this.currentWeightShift * 0.012 + Math.sin(swaySlow - 0.4) * 0.008;
    const rightUpperRoll = 1.33 - this.currentWeightShift * 0.012 - Math.sin(swaySlow - 0.4) * 0.008;

    this.slerpEuler(out, 'leftUpperArm', leftUpperPitch, 0.02, leftUpperRoll, idleWeight);
    this.slerpEuler(out, 'rightUpperArm', rightUpperPitch, -0.02, rightUpperRoll, idleWeight);

    // 小臂芦苇微晃 (Forearm Reed Sway - 相位滞后的大臂弹性惯性随动)
    const leftElbowReed = 0.045 + Math.sin(breathCycle - 0.85) * 0.014 + Math.sin(swaySlow - 1.1) * 0.008;
    const rightElbowReed = 0.045 + Math.sin(breathCycle - 0.95) * 0.014 - Math.sin(swaySlow - 1.1) * 0.008;
    const leftLowerPitch = Math.sin(breathCycle - 1.0) * 0.010;
    const rightLowerPitch = Math.sin(breathCycle - 1.1) * 0.010;

    this.slerpEuler(out, 'leftLowerArm', leftLowerPitch, 0.03, leftElbowReed, idleWeight);
    this.slerpEuler(out, 'rightLowerArm', rightLowerPitch, -0.03, -rightElbowReed, idleWeight);

    // 手腕轻柔悬垂随动 (Wrist Hang & Float)
    const leftHandPitch = 0.035 + Math.sin(breathCycle - 1.35) * 0.012;
    const rightHandPitch = 0.035 + Math.sin(breathCycle - 1.45) * 0.012;
    const leftHandRoll = Math.sin(swaySlow - 1.5) * 0.008;
    const rightHandRoll = -Math.sin(swaySlow - 1.5) * 0.008;

    this.slerpEuler(out, 'leftHand', leftHandPitch, 0, leftHandRoll, idleWeight);
    this.slerpEuler(out, 'rightHand', rightHandPitch, 0, rightHandRoll, idleWeight);

    // ── 头颈部轻微呼吸跟随 ──
    const neckPitch = 0.008 * baseBreath;
    this.slerpEuler(out, 'neck', neckPitch * 0.5, 0, 0, idleWeight);
    this.slerpEuler(out, 'head', neckPitch * 0.5, 0, 0, idleWeight);

    // ── 十指解剖学自然放松 + 随呼吸小角度动态舒展 (Breath-coupled Organic Cascading Unfurling) ──
    const fingerWeight = idleWeight * actionFade;
    this.applyFingerPose(out, 'left', time, breathCycle, fingerWeight);
    this.applyFingerPose(out, 'right', time, breathCycle, fingerWeight);
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

  private applyFingerPose(
    out: PoseBuffer,
    side: 'left' | 'right',
    time: number,
    breathCycle: number,
    weight: number,
  ): void {
    if (weight <= 0.0001) return;

    const sign = side === 'left' ? 1 : -1;
    const isLeft = side === 'left';

    // 左右手呼吸相位与微幅侧倾差异（消除左右完全镜像死板感）
    const sidePhase = isLeft ? 0.0 : 0.45;
    // 重心侧手臂较贴体安静，悬空自由侧手掌舒展呼吸幅度略大
    const sideWeightFactor = (isLeft ? this.currentWeightShift : -this.currentWeightShift) > 0.1 ? 0.88 : 1.12;

    const slerpBone = (name: VRMHumanBoneName, x: number, y: number, z: number) => {
      const idx = BONE_INDEX_MAP.get(name);
      if (idx === undefined) return;
      this._euler.set(x, y * sign, z * sign);
      this._targetQ.setFromEuler(this._euler);
      out.quaternions[idx]!.slerp(this._targetQ, weight);
    };

    const thumb = isLeft ? 'leftThumb' : 'rightThumb';
    const index = isLeft ? 'leftIndex' : 'rightIndex';
    const middle = isLeft ? 'leftMiddle' : 'rightMiddle';
    const ring = isLeft ? 'leftRing' : 'rightRing';
    const little = isLeft ? 'leftLittle' : 'rightLittle';

    // 缓慢有机微摆（避免单一正弦波单调重复）
    const microTremor = Math.sin(time * 0.45 + (isLeft ? 0 : 1.2)) * 0.04;
    const deepBoost = this.currentDeepBreathPower * 0.35;

    // ── 各指生理级级联时差波浪（食指先吸气舒展，小指滞后随动，指节间由近端到远端微滞后） ──
    // 吸气舒展量：0=完全微卷待机，1=优雅舒展展开
    const computeInhaleWave = (phaseLag: number, amp: number) => {
      const wave = (Math.sin(breathCycle - phaseLag - sidePhase) + 1.0) * 0.5;
      const combined = Math.min(1.0, Math.max(0.0, wave * amp + microTremor + deepBoost));
      // 舒展系数：吸气展开时减小弯曲（乘以 1 - combined * 0.46），保留优雅柔和微弧度
      return 1.0 - combined * 0.46 * sideWeightFactor;
    };

    // 1. 食指（最外侧优雅舒展，相位先行）
    const openIndex = computeInhaleWave(1.35, 1.0);
    slerpBone(`${index}Proximal` as VRMHumanBoneName, 0.015, 0.008, -0.15 * openIndex);
    slerpBone(`${index}Intermediate` as VRMHumanBoneName, 0.0, 0.0, -0.22 * openIndex);
    slerpBone(`${index}Distal` as VRMHumanBoneName, 0.0, 0.0, -0.10 * (openIndex * 0.95 + 0.05));

    // 2. 中指（手掌中轴稳定依托，微滞后 0.15s）
    const openMiddle = computeInhaleWave(1.55, 0.95);
    slerpBone(`${middle}Proximal` as VRMHumanBoneName, 0.0, 0.0, -0.17 * openMiddle);
    slerpBone(`${middle}Intermediate` as VRMHumanBoneName, 0.0, 0.0, -0.26 * openMiddle);
    slerpBone(`${middle}Distal` as VRMHumanBoneName, 0.0, 0.0, -0.12 * (openMiddle * 0.95 + 0.05));

    // 3. 无名指（自然内敛微凹，微滞后 0.30s）
    const openRing = computeInhaleWave(1.75, 0.92);
    slerpBone(`${ring}Proximal` as VRMHumanBoneName, -0.015, -0.008, -0.20 * openRing);
    slerpBone(`${ring}Intermediate` as VRMHumanBoneName, 0.0, 0.0, -0.30 * openRing);
    slerpBone(`${ring}Distal` as VRMHumanBoneName, 0.0, 0.0, -0.14 * (openRing * 0.95 + 0.05));

    // 4. 小指（最内侧收束，微外展与滞后 0.45s 涟漪波浪）
    const openLittle = computeInhaleWave(1.95, 0.90);
    slerpBone(`${little}Proximal` as VRMHumanBoneName, -0.025, -0.015, -0.24 * openLittle);
    slerpBone(`${little}Intermediate` as VRMHumanBoneName, 0.0, 0.0, -0.34 * openLittle);
    slerpBone(`${little}Distal` as VRMHumanBoneName, 0.0, 0.0, -0.16 * (openLittle * 0.95 + 0.05));

    // 5. 拇指（掌侧外展微倾，随胸腔呼吸有机微开合）
    const openThumb = computeInhaleWave(1.45, 0.85);
    slerpBone(`${thumb}Metacarpal` as VRMHumanBoneName, -0.06 * openThumb, 0.12 * openThumb, -0.10 * openThumb);
    slerpBone(`${thumb}Proximal` as VRMHumanBoneName, -0.03 * openThumb, 0.08 * openThumb, -0.12 * openThumb);
    slerpBone(`${thumb}Distal` as VRMHumanBoneName, 0.0, 0.04 * openThumb, -0.08 * openThumb);
  }
}
