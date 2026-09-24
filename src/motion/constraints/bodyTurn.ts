import * as THREE from 'three';
import type { VRM, VRMHumanBoneName } from '@pixiv/three-vrm';
import { BONE_INDEX_MAP, type PoseBuffer } from '../pipeline/poseBuffer';
import { APP_CONFIG } from '../../config';

// ─── 踱步状态机 ───────────────────────────────────────────────────────────────
const SP = { IDLE: 0, LIFT: 1, SWING: 2, PLANT: 3, SETTLE: 4 } as const;
type StepPhase = typeof SP[keyof typeof SP];

function getPhaseDuration(phase: StepPhase): number {
  switch (phase) {
    case SP.LIFT: return APP_CONFIG.bodyTurn.phaseDuration.lift;
    case SP.SWING: return APP_CONFIG.bodyTurn.phaseDuration.swing;
    case SP.PLANT: return APP_CONFIG.bodyTurn.phaseDuration.plant;
    case SP.SETTLE: return APP_CONFIG.bodyTurn.phaseDuration.settle;
    default: return 0;
  }
}

/**
 * BodyTurnSystem — 程序化物理转身踱步系统
 *
 * 替换 vrmEngine.ts 中硬编码的 rotation.y 匀速叠加 + 微弱 sin 腿摆，
 * 实现"意图先行 → 迈步跟进 → 重心摆动 → 归位"的真实行走转向感。
 *
 * 两层叠加：
 * 1. 临界阻尼弹簧 Yaw 追踪 — 场景转向有加速感 + 柔和收尾
 * 2. 踱步状态机 — LIFT → SWING → PLANT → SETTLE 左右腿交替，带重心偏移
 * 不旋转 spine/chest/upperChest；躯干由 Layer-1 管，头颈由 Gaze 管。
 *
 * 接口：
 *   bind(vrm)                          — 模型加载后调用一次，绑定骨骼并记录静息姿态
 *   update(delta, normYaw, allowLocomotion)  — 每帧调用，返回本帧应叠加到场景的 yawDelta (rad)
 *   reset()                            — 模型卸载时调用，清空状态
 */
export class BodyTurnSystem {
  // ─── 配置常量（统一从 APP_CONFIG.bodyTurn 读取） ───────────────────────────
  /** normYaw 超过此阈值（rad）才触发踱步转身 (约 24°，适中意图延迟) */
  private get TURN_START_THRESHOLD() { return APP_CONFIG.bodyTurn.turnStartThreshold; }
  /** normYaw 小于此阈值（rad）时结束转身 (约 11.5°，进入舒适视线区并收步定住) */
  private get TURN_STOP_THRESHOLD() { return APP_CONFIG.bodyTurn.turnStopThreshold; }
  /** 弹簧刚度（临界阻尼：d = 2*√k） */
  private get SPRING_K() { return APP_CONFIG.bodyTurn.springK; }
  /** 踱步抬腿时 lowerLeg 弯曲角度（rad） */
  private get STEP_LOWER_LEG_BEND() { return APP_CONFIG.bodyTurn.stepLowerLegBend; }
  /** 踱步时 upperLeg 前抬角度（rad） */
  private get STEP_UPPER_LEG_LIFT() { return APP_CONFIG.bodyTurn.stepUpperLegLift; }
  /** 踱步时脚踝背屈角度（rad） */
  private get STEP_ANKLE_FLEX() { return APP_CONFIG.bodyTurn.stepAnkleFlex; }
  /** 踱步时髋部侧移量（hips local X，m） */
  private get HIP_SWAY_AMOUNT() { return APP_CONFIG.bodyTurn.hipSwayAmount; }
  /** 踱步时重心上下沉浮（Bounce，Y轴，m） */
  private get HIP_BOUNCE_AMOUNT() { return APP_CONFIG.bodyTurn.hipBounceAmount; }

  // ─── VRM 骨骼引用 ────────────────────────────────────────────────────────────
  private vrm: VRM | null = null;

  private hips: THREE.Object3D | null = null;

  private leftUpperLeg: THREE.Object3D | null = null;
  private rightUpperLeg: THREE.Object3D | null = null;
  private leftLowerLeg: THREE.Object3D | null = null;
  private rightLowerLeg: THREE.Object3D | null = null;
  private leftFoot: THREE.Object3D | null = null;
  private rightFoot: THREE.Object3D | null = null;

  // ─── 静息四元数（bind 时快照）────────────────────────────────────────────────
  private restHipsPos = new THREE.Vector3();
  private restHipsQ = new THREE.Quaternion();
  private restLeftUpperLegQ = new THREE.Quaternion();
  private restRightUpperLegQ = new THREE.Quaternion();
  private restLeftLowerLegQ = new THREE.Quaternion();
  private restRightLowerLegQ = new THREE.Quaternion();
  private restLeftFootQ = new THREE.Quaternion();
  private restRightFootQ = new THREE.Quaternion();

  // ─── 独立下半身姿态缓存（解耦直接写骨骼，支持零冲突分层混合）────────────────
  private currentHipsPos = new THREE.Vector3();
  private currentHipsQ = new THREE.Quaternion();
  private currentLeftUpperLegQ = new THREE.Quaternion();
  private currentRightUpperLegQ = new THREE.Quaternion();
  private currentLeftLowerLegQ = new THREE.Quaternion();
  private currentRightLowerLegQ = new THREE.Quaternion();
  private currentLeftFootQ = new THREE.Quaternion();
  private currentRightFootQ = new THREE.Quaternion();

  // ─── 弹簧 Yaw 追踪状态 ──────────────────────────────────────────────────────
  public yawVel = 0.0;      // 弹簧角速度（rad/s）

  // ─── 踱步状态机 ─────────────────────────────────────────────────────────────
  public isTurning = false;
  private phase: StepPhase = SP.IDLE;
  private phaseTimer = 0.0;
  public stepLeft = true;   // 下一步迈哪条腿（交替）

  // 踱步权重（0=停止，1=全力）— 用于平滑进入/退出
  public stepBlendWeight = 0.0;

  // ─── Zero-GC 预分配临时变量 ──────────────────────────────────────────────────
  private _q = new THREE.Quaternion();
  private _q2 = new THREE.Quaternion();
  private _eu = new THREE.Euler(0, 0, 0, 'YXZ');
  private _v = new THREE.Vector3();

  // ─── Public API ──────────────────────────────────────────────────────────────

  bind(vrm: VRM): void {
    this.vrm = vrm;
    const h = vrm.humanoid;
    if (!h) return;

    const get = (n: VRMHumanBoneName) => h.getNormalizedBoneNode(n) ?? h.getRawBoneNode(n);

    this.hips = get('hips');
    this.leftUpperLeg = get('leftUpperLeg');
    this.rightUpperLeg = get('rightUpperLeg');
    this.leftLowerLeg = get('leftLowerLeg');
    this.rightLowerLeg = get('rightLowerLeg');
    this.leftFoot = get('leftFoot');
    this.rightFoot = get('rightFoot');

    if (this.hips) {
      this.restHipsPos.copy(this.hips.position);
      this.restHipsQ.copy(this.hips.quaternion);
    }
    if (this.leftUpperLeg) this.restLeftUpperLegQ.copy(this.leftUpperLeg.quaternion);
    if (this.rightUpperLeg) this.restRightUpperLegQ.copy(this.rightUpperLeg.quaternion);
    if (this.leftLowerLeg) this.restLeftLowerLegQ.copy(this.leftLowerLeg.quaternion);
    if (this.rightLowerLeg) this.restRightLowerLegQ.copy(this.rightLowerLeg.quaternion);
    if (this.leftFoot) this.restLeftFootQ.copy(this.leftFoot.quaternion);
    if (this.rightFoot) this.restRightFootQ.copy(this.rightFoot.quaternion);

    this.reset();
  }

  reset(): void {
    this.yawVel = 0;
    this.isTurning = false;
    this.phase = SP.IDLE;
    this.phaseTimer = 0;
    this.stepBlendWeight = 0;

    this.currentHipsPos.copy(this.restHipsPos);
    this.currentHipsQ.copy(this.restHipsQ);
    this.currentLeftUpperLegQ.copy(this.restLeftUpperLegQ);
    this.currentRightUpperLegQ.copy(this.restRightUpperLegQ);
    this.currentLeftLowerLegQ.copy(this.restLeftLowerLegQ);
    this.currentRightLowerLegQ.copy(this.restRightLowerLegQ);
    this.currentLeftFootQ.copy(this.restLeftFootQ);
    this.currentRightFootQ.copy(this.restRightFootQ);
  }

  /**
   * 将当前步态下半身姿态直接写入 PoseBuffer（零 GC）
   */
  copyToLowerBodyBuffer(out: PoseBuffer): void {
    const setQ = (bone: VRMHumanBoneName, q: THREE.Quaternion) => {
      const idx = BONE_INDEX_MAP.get(bone);
      if (idx !== undefined) out.quaternions[idx]!.copy(q);
    };
    setQ('leftUpperLeg', this.currentLeftUpperLegQ);
    setQ('rightUpperLeg', this.currentRightUpperLegQ);
    setQ('leftLowerLeg', this.currentLeftLowerLegQ);
    setQ('rightLowerLeg', this.currentRightLowerLegQ);
    setQ('leftFoot', this.currentLeftFootQ);
    setQ('rightFoot', this.currentRightFootQ);
    setQ('hips', this.currentHipsQ);
    out.hipsPosition.copy(this.currentHipsPos);
  }

  /**
   * 当前是否处于踱步动作中(LIFT/SWING/PLANT/SETTLE 任一阶段)。
   * 用于让 vrmEngine 的 levelFeet 在踱步时让出脚部控制权，
   * 否则 footIK 会把脚踝的背屈/旋转强抹平,踱步完全看不见。
   */
  isStepping(): boolean {
    return this.phase !== SP.IDLE;
  }

  public getPhase(): StepPhase {
    return this.phase;
  }

  public getPhaseProgress(): number {
    const dur = getPhaseDuration(this.phase);
    return dur > 0 ? Math.min(1.0, this.phaseTimer / dur) : 0;
  }

  getPhaseName(): string {
    const names = ['IDLE', 'LIFT', 'SWING', 'PLANT', 'SETTLE'];
    return names[this.phase] ?? 'UNKNOWN';
  }

  /** Outfit-swap: snapshot stepping/yaw internals (bind calls reset). */
  captureSwapState(): {
    yawVel: number;
    isTurning: boolean;
    phase: number;
    phaseTimer: number;
    stepLeft: boolean;
    stepBlendWeight: number;
  } {
    return {
      yawVel: this.yawVel,
      isTurning: this.isTurning,
      phase: this.phase,
      phaseTimer: this.phaseTimer,
      stepLeft: this.stepLeft,
      stepBlendWeight: this.stepBlendWeight,
    };
  }

  restoreSwapState(s: {
    yawVel: number;
    isTurning: boolean;
    phase: number;
    phaseTimer: number;
    stepLeft: boolean;
    stepBlendWeight: number;
  }): void {
    this.yawVel = s.yawVel;
    this.isTurning = s.isTurning;
    this.phase = s.phase as StepPhase;
    this.phaseTimer = s.phaseTimer;
    this.stepLeft = s.stepLeft;
    this.stepBlendWeight = s.stepBlendWeight;
  }

  /**
   * 返回左右脚当前的接地权重 [0, 1] (供 FootIK 动力学自适应避让求解)
   * 1.0 = 踩实地面；0.0 = 抬腿悬空迈步
   */
  getFootGroundedAlpha(): { left: number; right: number } {
    if (this.phase === SP.IDLE || this.stepBlendWeight < 0.01) {
      return { left: 1.0, right: 1.0 };
    }

    const dur = getPhaseDuration(this.phase);
    const rawT = dur > 0 ? Math.min(1.0, this.phaseTimer / dur) : 1.0;

    let steppingAlpha = 1.0;
    if (this.phase === SP.LIFT) {
      steppingAlpha = 1.0 - rawT;
    } else if (this.phase === SP.SWING) {
      steppingAlpha = 0.0;
    } else if (this.phase === SP.PLANT) {
      steppingAlpha = rawT;
    } else if (this.phase === SP.SETTLE) {
      steppingAlpha = 1.0;
    }

    const finalSteppingAlpha = THREE.MathUtils.lerp(1.0, steppingAlpha, this.stepBlendWeight);

    return this.stepLeft
      ? { left: finalSteppingAlpha, right: 1.0 }
      : { left: 1.0, right: finalSteppingAlpha };
  }

  /**
   * 每帧调用。
   * @param delta      帧时间（秒）
   * @param normYaw    相机相对模型的偏航角（rad），范围 [-π, π]，正值 = 相机在角色右边
   * @param allowLocomotion  false 时禁用踱步（说话 EMAGE 等种植姿源）
   * @returns                本帧应叠加到 vrm.scene.rotation.y 的 yawDelta（rad）
   */
  update(delta: number, normYaw: number, allowLocomotion: boolean = true): number {
    if (!this.vrm) return 0;

    const dt = Math.min(delta, 0.05);

    const absYaw = Math.abs(normYaw);

    // ── 1. 转身状态机触发与流转 ───────────────────────────────────────────────
    if (allowLocomotion) {
      if (!this.isTurning && absYaw > this.TURN_START_THRESHOLD) {
        this.isTurning = true;
        // 生物力学生理匹配先导腿：向左转(normYaw > 0)先迈左腿；向右转(normYaw < 0)先迈右腿，彻底杜绝交叉内别腿顿挫
        this.stepLeft = normYaw >= 0;
        // 从 IDLE 触发时立即开始第一步
        if (this.phase === SP.IDLE) {
          this.phase = SP.LIFT;
          this.phaseTimer = 0;
        }
      } else if (this.isTurning && absYaw < this.TURN_STOP_THRESHOLD) {
        this.isTurning = false;
        // 允许当前步完整走完完整的 LIFT -> SWING -> PLANT -> SETTLE，杜绝半空强掐动作导致骨盆颠晃顿挫
      }
    }

    // 待机状态下双足稳固接地，杜绝无迈步的“旋转木马滑转”；小角度偏角由头颈注视 (Gaze) 自然承担
    if (this.phase === SP.IDLE && !this.isTurning) {
      this.yawVel = 0;
      this.stepBlendWeight = 0;
      const settleDt = Math.min(1.0, dt * 8.0);
      this.currentLeftUpperLegQ.slerp(this.restLeftUpperLegQ, settleDt);
      this.currentRightUpperLegQ.slerp(this.restRightUpperLegQ, settleDt);
      this.currentLeftLowerLegQ.slerp(this.restLeftLowerLegQ, settleDt);
      this.currentRightLowerLegQ.slerp(this.restRightLowerLegQ, settleDt);
      this.currentLeftFootQ.slerp(this.restLeftFootQ, settleDt);
      this.currentRightFootQ.slerp(this.restRightFootQ, settleDt);
      this.currentHipsPos.lerp(this.restHipsPos, settleDt);
      this.currentHipsQ.slerp(this.restHipsQ, settleDt);
      return 0;
    }

    // ── 2. 踱步过程中的角速度追踪（带启动平滑 Ease-In，消除第一帧猛拽顿挫）─────
    const startEase = Math.min(1.0, this.stepBlendWeight * 1.6 + 0.15);
    const k = this.SPRING_K * startEase;
    const d = 2.0 * Math.sqrt(this.SPRING_K);   // 保持全阻尼系数，防止欠阻尼过冲
    const yawForce = k * normYaw - d * this.yawVel;
    this.yawVel += yawForce * dt;
    const maxVel = APP_CONFIG.bodyTurn.maxYawVel;
    this.yawVel = Math.max(-maxVel, Math.min(maxVel, this.yawVel));

    // 在收步阶段 (SETTLE 且不再继续转) 随落脚自然平稳减速归零
    let stepDecel = 1.0;
    if (this.phase === SP.SETTLE && !this.isTurning) {
      const settleDur = getPhaseDuration(SP.SETTLE);
      const t = settleDur > 0 ? Math.min(1.0, this.phaseTimer / settleDur) : 1.0;
      stepDecel = (1.0 - t) * (1.0 - t);
      this.yawVel *= Math.max(0, 1.0 - dt * 8.0);
    }
    const yawDelta = this.yawVel * dt * stepDecel;

    // ── 3. 踱步权重平滑 ───────────────────────────────────────────────────────
    const targetBlend = this.isTurning ? 1.0 : 0.0;
    this.stepBlendWeight += (targetBlend - this.stepBlendWeight) * Math.min(1.0, dt * 7.0);

    // ── 4. 踱步状态机（不允许 locomotion 时已在上方置 IDLE 跳过）───────────
    if (allowLocomotion && this.phase !== SP.IDLE) {
      this.phaseTimer += dt;
      const phaseDur = getPhaseDuration(this.phase);

      // 当前步的 t ∈ [0,1]，使用平滑曲线
      const rawT = phaseDur > 0 ? Math.min(1.0, this.phaseTimer / phaseDur) : 1.0;
      const t = rawT * rawT * (3 - 2 * rawT); // smoothstep

      // 决定哪条腿在"迈步"，哪条在"支撑"
      const steppingLeft = this.stepLeft;


      const restSteppingUpper = steppingLeft ? this.restLeftUpperLegQ : this.restRightUpperLegQ;
      const restSteppingLower = steppingLeft ? this.restLeftLowerLegQ : this.restRightLowerLegQ;
      const restSteppingFoot = steppingLeft ? this.restLeftFootQ : this.restRightFootQ;
      const restSupportUpper = steppingLeft ? this.restRightUpperLegQ : this.restLeftUpperLegQ;
      const restSupportLower = steppingLeft ? this.restRightLowerLegQ : this.restLeftLowerLegQ;

      const curSteppingUpper = steppingLeft ? this.currentLeftUpperLegQ : this.currentRightUpperLegQ;
      const curSteppingLower = steppingLeft ? this.currentLeftLowerLegQ : this.currentRightLowerLegQ;
      const curSteppingFoot = steppingLeft ? this.currentLeftFootQ : this.currentRightFootQ;
      const curSupportUpper = steppingLeft ? this.currentRightUpperLegQ : this.currentLeftUpperLegQ;
      const curSupportLower = steppingLeft ? this.currentRightLowerLegQ : this.currentLeftLowerLegQ;

      // 转向方向决定大腿前摆的 X 轴符号（VRM：X+ = 前抬）
      const liftSign = -1.0; // upperLeg 向前抬起为 X 负（VRM normalized 坐标）

      switch (this.phase) {
        case SP.LIFT: {
          // 迈出腿：大腿向前微抬，小腿弯曲
          const upperLiftAngle = liftSign * this.STEP_UPPER_LEG_LIFT * t * this.stepBlendWeight;
          const lowerBendAngle = this.STEP_LOWER_LEG_BEND * t * this.stepBlendWeight;
          const ankleFlexAngle = -this.STEP_ANKLE_FLEX * t * this.stepBlendWeight;

          this._eu.set(upperLiftAngle, 0, 0, 'YXZ');
          this._q.setFromEuler(this._eu);
          this._q2.copy(restSteppingUpper).multiply(this._q);
          curSteppingUpper.slerp(this._q2, Math.min(1.0, dt * 12.0));

          this._eu.set(lowerBendAngle, 0, 0, 'YXZ');
          this._q.setFromEuler(this._eu);
          this._q2.copy(restSteppingLower).multiply(this._q);
          curSteppingLower.slerp(this._q2, Math.min(1.0, dt * 12.0));

          this._eu.set(ankleFlexAngle, 0, 0, 'YXZ');
          this._q.setFromEuler(this._eu);
          this._q2.copy(restSteppingFoot).multiply(this._q);
          curSteppingFoot.slerp(this._q2, Math.min(1.0, dt * 12.0));

          // 支撑腿：保持端正
          curSupportUpper.slerp(restSupportUpper, Math.min(1.0, dt * 8.0));
          curSupportLower.slerp(restSupportLower, Math.min(1.0, dt * 8.0));

          // 髋部向支撑腿侧微移（重心转移，骨盆侧倾，重心微浮）
          const supportSign = steppingLeft ? 1.0 : -1.0;
          const liftBounce = Math.sin(t * Math.PI) * 0.2;
          this._applyHipDynamics(supportSign * t, -liftBounce, this.stepBlendWeight, dt);
          break;
        }

        case SP.SWING: {
          // 前摆：大腿继续保持抬起，脚踝切换到背屈
          const upperAngle = liftSign * this.STEP_UPPER_LEG_LIFT * this.stepBlendWeight;
          const ankleAngle = this.STEP_ANKLE_FLEX * t * this.stepBlendWeight; // 从背屈转正

          this._eu.set(upperAngle, 0, 0, 'YXZ');
          this._q.setFromEuler(this._eu);
          this._q2.copy(restSteppingUpper).multiply(this._q);
          curSteppingUpper.slerp(this._q2, Math.min(1.0, dt * 10.0));

          // 小腿从弯曲逐渐伸直
          const lowerAngle = this.STEP_LOWER_LEG_BEND * (1.0 - t) * this.stepBlendWeight;
          this._eu.set(lowerAngle, 0, 0, 'YXZ');
          this._q.setFromEuler(this._eu);
          this._q2.copy(restSteppingLower).multiply(this._q);
          curSteppingLower.slerp(this._q2, Math.min(1.0, dt * 10.0));

          this._eu.set(ankleAngle, 0, 0, 'YXZ');
          this._q.setFromEuler(this._eu);
          this._q2.copy(restSteppingFoot).multiply(this._q);
          curSteppingFoot.slerp(this._q2, Math.min(1.0, dt * 10.0));

          // 前摆：支撑侧受力，维持轻柔的骨盆横滚侧倾与微旋
          const supportSign = steppingLeft ? 1.0 : -1.0;
          this._applyHipDynamics(supportSign, 0.05, this.stepBlendWeight, dt);
          break;
        }

        case SP.PLANT: {
          // 落脚：全腿归位
          curSteppingUpper.slerp(restSteppingUpper, Math.min(1.0, dt * 15.0));
          curSteppingLower.slerp(restSteppingLower, Math.min(1.0, dt * 15.0));
          curSteppingFoot.slerp(restSteppingFoot, Math.min(1.0, dt * 15.0));

          // 落脚踩实：身体重心从支撑腿平稳过渡回正，产生轻柔的落地减震 (Bounce)
          const supportSign = steppingLeft ? 1.0 : -1.0;
          const plantBounce = Math.sin(t * Math.PI) * 0.8;
          const plantSide = supportSign * (1.0 - t * 0.5);
          this._applyHipDynamics(plantSide, plantBounce, this.stepBlendWeight, dt);
          break;
        }

        case SP.SETTLE: {
          // 全身归位：髋部和所有腿平滑回正
          curSteppingUpper.slerp(restSteppingUpper, Math.min(1.0, dt * 6.0));
          curSteppingLower.slerp(restSteppingLower, Math.min(1.0, dt * 6.0));
          curSupportUpper.slerp(restSupportUpper, Math.min(1.0, dt * 6.0));
          curSupportLower.slerp(restSupportLower, Math.min(1.0, dt * 6.0));

          const supportSign = steppingLeft ? 1.0 : -1.0;
          const settleSide = supportSign * 0.5 * (1.0 - t);
          const settleBounce = (1.0 - t) * 0.3;
          this._applyHipDynamics(settleSide, settleBounce, (1.0 - t) * this.stepBlendWeight, dt);
          break;
        }
      }

      // ── 状态推进 ──────────────────────────────────────────────────────────
      if (rawT >= 1.0) {
        switch (this.phase) {
          case SP.LIFT:
            this.phase = SP.SWING;
            this.phaseTimer = 0;
            break;
          case SP.SWING:
            this.phase = SP.PLANT;
            this.phaseTimer = 0;
            break;
          case SP.PLANT:
            this.phase = SP.SETTLE;
            this.phaseTimer = 0;
            break;
          case SP.SETTLE:
            // 一步完成：换腿。只有仍处于主动转身且偏差依然显著（> 停止阈值）时才继续迈下一步
            this.stepLeft = !this.stepLeft;
            if (this.isTurning && absYaw > this.TURN_STOP_THRESHOLD) {
              this.phase = SP.LIFT;
              this.phaseTimer = 0;
            } else {
              this.isTurning = false;
              this.phase = SP.IDLE;
            }
            break;
        }
      }
    } else if (this.phase === SP.IDLE) {
      const settleDt = Math.min(1.0, dt * 6.0);
      this.currentLeftUpperLegQ.slerp(this.restLeftUpperLegQ, settleDt);
      this.currentRightUpperLegQ.slerp(this.restRightUpperLegQ, settleDt);
      this.currentLeftLowerLegQ.slerp(this.restLeftLowerLegQ, settleDt);
      this.currentRightLowerLegQ.slerp(this.restRightLowerLegQ, settleDt);
      this.currentLeftFootQ.slerp(this.restLeftFootQ, settleDt);
      this.currentRightFootQ.slerp(this.restRightFootQ, settleDt);
      this.currentHipsPos.lerp(this.restHipsPos, settleDt);
      this.currentHipsQ.slerp(this.restHipsQ, settleDt);
    }

    return yawDelta;
  }

  // ─── 内部辅助 ────────────────────────────────────────────────────────────────

  /**
   * 应用骨盆拟人生理动力学（侧移 X、沉浮 Y Bounce、横滚 Roll 倾角、偏航 Yaw 旋动）。
   * @param sideSign   +1 = 支撑腿在右（重心右移），-1 = 支撑腿在左，0 = 归中
   * @param bounceMult 重心下沉系数 [-0.3, 1.0] (落脚踩实缓冲达到峰值)
   * @param weight     步态混合权重 0~1
   * @param dt         帧时间
   */
  private _applyHipDynamics(sideSign: number, bounceMult: number, weight: number, dt: number): void {
    const targetX = this.restHipsPos.x + sideSign * this.HIP_SWAY_AMOUNT * weight;
    const targetY = this.restHipsPos.y - bounceMult * this.HIP_BOUNCE_AMOUNT * weight;
    this._v.set(targetX, targetY, this.restHipsPos.z);
    this.currentHipsPos.lerp(this._v, Math.min(1.0, dt * 8.0));

    // 骨盆旋转保持与 Layer-1 呼吸待机姿态一致（避免孤立扭转破坏脊柱平衡与腿部协调）
    this.currentHipsQ.slerp(this.restHipsQ, Math.min(1.0, dt * 8.0));
  }
}
