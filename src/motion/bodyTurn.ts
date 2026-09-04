import * as THREE from 'three';
import type { VRM, VRMHumanBoneName } from '@pixiv/three-vrm';

// ─── 踱步状态机 ───────────────────────────────────────────────────────────────
const SP = { IDLE: 0, LIFT: 1, SWING: 2, PLANT: 3, SETTLE: 4 } as const;
type StepPhase = typeof SP[keyof typeof SP];

const PHASE_DURATION: Record<StepPhase, number> = {
  [SP.IDLE]:   0,
  [SP.LIFT]:   0.18,
  [SP.SWING]:  0.14,
  [SP.PLANT]:  0.08,
  [SP.SETTLE]: 0.18,
};

/**
 * BodyTurnSystem — 程序化物理转身踱步系统
 *
 * 替换 vrmEngine.ts 中硬编码的 rotation.y 匀速叠加 + 微弱 sin 腿摆，
 * 实现"意图先行 → 迈步跟进 → 重心摆动 → 归位"的真实行走转向感。
 *
 * 三层叠加：
 * 1. 临界阻尼弹簧 Yaw 追踪 — 场景转向有加速感 + 柔和收尾
 * 2. 脊柱预旋 — upperChest/chest/spine 各自按权重提前转向，"意图先行"
 * 3. 踱步状态机 — LIFT → SWING → PLANT → SETTLE 左右腿交替，带重心偏移
 *
 * 接口：
 *   bind(vrm)                          — 模型加载后调用一次，绑定骨骼并记录静息姿态
 *   update(delta, normYaw, emageLive)  — 每帧调用，返回本帧应叠加到场景的 yawDelta (rad)
 *   reset()                            — 模型卸载时调用，清空状态
 */
export class BodyTurnSystem {
  // ─── 配置常量 ────────────────────────────────────────────────────────────────
  /** normYaw 超过此阈值（rad）才触发踱步转身 */
  private readonly TURN_START_THRESHOLD  = 0.90;
  /** normYaw 小于此阈值（rad）时结束转身 */
  private readonly TURN_STOP_THRESHOLD   = 0.30;
  /** 弹簧刚度（临界阻尼：d = 2*√k） */
  private readonly SPRING_K              = 8.0;
  /** 踱步抬腿时 lowerLeg 弯曲角度（rad） */
  private readonly STEP_LOWER_LEG_BEND  = 0.36;
  /** 踱步时 upperLeg 前抬角度（rad） */
  private readonly STEP_UPPER_LEG_LIFT  = 0.20;
  /** 踱步时脚踝背屈角度（rad） */
  private readonly STEP_ANKLE_FLEX      = 0.12;
  /** 踱步时髋部侧移量（hips local X，m） */
  private readonly HIP_SWAY_AMOUNT      = 0.018;

  // ─── VRM 骨骼引用 ────────────────────────────────────────────────────────────
  private vrm: VRM | null = null;

  private hips:          THREE.Object3D | null = null;
  private spine:         THREE.Object3D | null = null;
  private chest:         THREE.Object3D | null = null;
  private upperChest:    THREE.Object3D | null = null;

  private leftUpperLeg:  THREE.Object3D | null = null;
  private rightUpperLeg: THREE.Object3D | null = null;
  private leftLowerLeg:  THREE.Object3D | null = null;
  private rightLowerLeg: THREE.Object3D | null = null;
  private leftFoot:      THREE.Object3D | null = null;
  private rightFoot:     THREE.Object3D | null = null;

  // ─── 静息四元数（bind 时快照）────────────────────────────────────────────────
  private restHipsPos       = new THREE.Vector3();
  private restLeftUpperLegQ  = new THREE.Quaternion();
  private restRightUpperLegQ = new THREE.Quaternion();
  private restLeftLowerLegQ  = new THREE.Quaternion();
  private restRightLowerLegQ = new THREE.Quaternion();
  private restLeftFootQ      = new THREE.Quaternion();
  private restRightFootQ     = new THREE.Quaternion();
  private restSpineQ         = new THREE.Quaternion();
  private restChestQ         = new THREE.Quaternion();
  private restUpperChestQ    = new THREE.Quaternion();

  // ─── 弹簧 Yaw 追踪状态 ──────────────────────────────────────────────────────
  private yawVel = 0.0;      // 弹簧角速度（rad/s）

  // ─── 踱步状态机 ─────────────────────────────────────────────────────────────
  private isTurning  = false;
  private phase: StepPhase = SP.IDLE;
  private phaseTimer = 0.0;
  private stepLeft   = true;   // 下一步迈哪条腿（交替）

  // 脊柱延迟预旋缓冲（滚动平均延迟）
  private spineDelayBuf:  number[] = new Array(10).fill(0);  // ~166ms @ 60fps
  private chestDelayBuf:  number[] = new Array(5).fill(0);   // ~83ms  @ 60fps
  private spineDelayIdx  = 0;
  private chestDelayIdx  = 0;

  // 当前脊柱/胸腔旋转权重（平滑过渡用）
  private spineYawCurrent    = 0.0;
  private chestYawCurrent    = 0.0;
  private upperChestYawCur   = 0.0;

  // 踱步权重（0=停止，1=全力）— 用于平滑进入/退出
  private stepBlendWeight    = 0.0;

  // ─── Zero-GC 预分配临时变量 ──────────────────────────────────────────────────
  private _q   = new THREE.Quaternion();
  private _q2  = new THREE.Quaternion();
  private _eu  = new THREE.Euler(0, 0, 0, 'YXZ');
  private _v   = new THREE.Vector3();

  // ─── Public API ──────────────────────────────────────────────────────────────

  bind(vrm: VRM): void {
    this.vrm = vrm;
    const h = vrm.humanoid;
    if (!h) return;

    const get = (n: VRMHumanBoneName) => h.getNormalizedBoneNode(n) ?? h.getRawBoneNode(n);

    this.hips          = get('hips');
    this.spine         = get('spine');
    this.chest         = get('chest');
    this.upperChest    = get('upperChest');
    this.leftUpperLeg  = get('leftUpperLeg');
    this.rightUpperLeg = get('rightUpperLeg');
    this.leftLowerLeg  = get('leftLowerLeg');
    this.rightLowerLeg = get('rightLowerLeg');
    this.leftFoot      = get('leftFoot');
    this.rightFoot     = get('rightFoot');

    if (this.hips)          this.restHipsPos.copy(this.hips.position);
    if (this.leftUpperLeg)  this.restLeftUpperLegQ.copy(this.leftUpperLeg.quaternion);
    if (this.rightUpperLeg) this.restRightUpperLegQ.copy(this.rightUpperLeg.quaternion);
    if (this.leftLowerLeg)  this.restLeftLowerLegQ.copy(this.leftLowerLeg.quaternion);
    if (this.rightLowerLeg) this.restRightLowerLegQ.copy(this.rightLowerLeg.quaternion);
    if (this.leftFoot)      this.restLeftFootQ.copy(this.leftFoot.quaternion);
    if (this.rightFoot)     this.restRightFootQ.copy(this.rightFoot.quaternion);
    if (this.spine)         this.restSpineQ.copy(this.spine.quaternion);
    if (this.chest)         this.restChestQ.copy(this.chest.quaternion);
    if (this.upperChest)    this.restUpperChestQ.copy(this.upperChest.quaternion);

    this.reset();
  }

  reset(): void {
    this.yawVel          = 0;
    this.isTurning       = false;
    this.phase           = SP.IDLE;
    this.phaseTimer      = 0;
    this.stepBlendWeight = 0;
    this.spineYawCurrent     = 0;
    this.chestYawCurrent     = 0;
    this.upperChestYawCur    = 0;
    this.spineDelayBuf.fill(0);
    this.chestDelayBuf.fill(0);
  }

  /**
   * 当前是否处于踱步动作中(LIFT/SWING/PLANT/SETTLE 任一阶段)。
   * 用于让 vrmEngine 的 levelFeet 在踱步时让出脚部控制权，
   * 否则 footIK 会把脚踝的背屈/旋转强抹平,踱步完全看不见。
   */
  isStepping(): boolean {
    return this.phase !== SP.IDLE;
  }

  /**
   * 每帧调用。
   * @param delta      帧时间（秒）
   * @param normYaw    相机相对模型的偏航角（rad），范围 [-π, π]，正值 = 相机在角色右边
   * @param emageLive  EMAGE 说话中时为 true，此时完全禁用踱步（不抢腿部骨骼）
   * @returns          本帧应叠加到 vrm.scene.rotation.y 的 yawDelta（rad）
   */
  update(delta: number, normYaw: number, emageLive: boolean): number {
    if (!this.vrm) return 0;

    const dt = Math.min(delta, 0.05);

    // ── 1. 弹簧 Yaw 追踪 ─────────────────────────────────────────────────────
    const k = this.SPRING_K;
    const d = 2.0 * Math.sqrt(k);   // 临界阻尼系数
    const yawForce = k * normYaw - d * this.yawVel;
    this.yawVel += yawForce * dt;
    // 最大转速限制（防止异常帧 delta 导致暴转）
    this.yawVel = Math.max(-4.0, Math.min(4.0, this.yawVel));
    const yawDelta = this.yawVel * dt;

    // ── 2. 转身状态机触发 ─────────────────────────────────────────────────────
    if (!emageLive) {
      const absYaw = Math.abs(normYaw);
      if (!this.isTurning && absYaw > this.TURN_START_THRESHOLD) {
        this.isTurning = true;
        // 从 IDLE 触发时立即开始第一步
        if (this.phase === SP.IDLE) {
          this.phase      = SP.LIFT;
          this.phaseTimer = 0;
        }
      } else if (this.isTurning && absYaw < this.TURN_STOP_THRESHOLD) {
        this.isTurning = false;
        // 如果当前步骤还没结束，让它 SETTLE 收尾
        if (this.phase === SP.LIFT || this.phase === SP.SWING) {
          this.phase      = SP.PLANT;
          this.phaseTimer = 0;
        }
      }
    } else {
      // EMAGE 活跃时强制退出转身
      if (this.isTurning) {
        this.isTurning = false;
        this.phase     = SP.IDLE;
      }
    }

    // ── 3. 踱步权重平滑 ───────────────────────────────────────────────────────
    const targetBlend = this.isTurning ? 1.0 : 0.0;
    this.stepBlendWeight += (targetBlend - this.stepBlendWeight) * Math.min(1.0, dt * 7.0);

    // ── 4. 脊柱延迟预旋 ───────────────────────────────────────────────────────
    // 将 normYaw 推入延迟缓冲，模拟上身/腰椎的滞后响应
    this.chestDelayBuf[this.chestDelayIdx % this.chestDelayBuf.length] = normYaw;
    this.chestDelayIdx++;
    const chestDelayedYaw = this.chestDelayBuf[this.chestDelayIdx % this.chestDelayBuf.length] ?? 0;

    this.spineDelayBuf[this.spineDelayIdx % this.spineDelayBuf.length] = normYaw;
    this.spineDelayIdx++;
    const spineDelayedYaw = this.spineDelayBuf[this.spineDelayIdx % this.spineDelayBuf.length] ?? 0;

    // 脊柱预旋目标（仅在转身激活期间，平滑收敛到 0）
    const upperChestTarget = this.isTurning ? normYaw        * 0.30 : 0;
    const chestTarget      = this.isTurning ? chestDelayedYaw * 0.20 : 0;
    const spineTarget      = this.isTurning ? spineDelayedYaw * 0.10 : 0;

    const spineBlend = Math.min(1.0, dt * 5.0);
    this.upperChestYawCur += (upperChestTarget - this.upperChestYawCur) * spineBlend;
    this.chestYawCurrent  += (chestTarget      - this.chestYawCurrent)  * spineBlend;
    this.spineYawCurrent  += (spineTarget      - this.spineYawCurrent)  * spineBlend;

    // 应用脊柱预旋
    if (this.upperChest && Math.abs(this.upperChestYawCur) > 0.001) {
      this._eu.set(0, this.upperChestYawCur, 0, 'YXZ');
      this._q.setFromEuler(this._eu);
      this._q2.copy(this.restUpperChestQ).multiply(this._q);
      this.upperChest.quaternion.slerp(this._q2, Math.min(1.0, dt * 8.0));
    }
    if (this.chest && Math.abs(this.chestYawCurrent) > 0.001) {
      this._eu.set(0, this.chestYawCurrent, 0, 'YXZ');
      this._q.setFromEuler(this._eu);
      this._q2.copy(this.restChestQ).multiply(this._q);
      this.chest.quaternion.slerp(this._q2, Math.min(1.0, dt * 6.0));
    }
    if (this.spine && Math.abs(this.spineYawCurrent) > 0.001) {
      this._eu.set(0, this.spineYawCurrent, 0, 'YXZ');
      this._q.setFromEuler(this._eu);
      this._q2.copy(this.restSpineQ).multiply(this._q);
      this.spine.quaternion.slerp(this._q2, Math.min(1.0, dt * 5.0));
    }

    // ── 5. 踱步状态机（emageLive 时已在上方置 IDLE 跳过）───────────────────
    if (!emageLive && this.phase !== SP.IDLE) {
      this.phaseTimer += dt;
      const phaseDur = PHASE_DURATION[this.phase];

      // 当前步的 t ∈ [0,1]，使用平滑曲线
      const rawT = phaseDur > 0 ? Math.min(1.0, this.phaseTimer / phaseDur) : 1.0;
      const t    = rawT * rawT * (3 - 2 * rawT); // smoothstep

      // 决定哪条腿在"迈步"，哪条在"支撑"
      const steppingLeft = this.stepLeft;

      const steppingUpperLeg  = steppingLeft ? this.leftUpperLeg  : this.rightUpperLeg;
      const steppingLowerLeg  = steppingLeft ? this.leftLowerLeg  : this.rightLowerLeg;
      const steppingFoot      = steppingLeft ? this.leftFoot      : this.rightFoot;
      const supportUpperLeg   = steppingLeft ? this.rightUpperLeg : this.leftUpperLeg;
      const supportLowerLeg   = steppingLeft ? this.rightLowerLeg : this.leftLowerLeg;
      const restSteppingUpper = steppingLeft ? this.restLeftUpperLegQ  : this.restRightUpperLegQ;
      const restSteppingLower = steppingLeft ? this.restLeftLowerLegQ  : this.restRightLowerLegQ;
      const restSteppingFoot  = steppingLeft ? this.restLeftFootQ      : this.restRightFootQ;
      const restSupportUpper  = steppingLeft ? this.restRightUpperLegQ : this.restLeftUpperLegQ;
      const restSupportLower  = steppingLeft ? this.restRightLowerLegQ : this.restLeftLowerLegQ;

      // 转向方向决定大腿前摆的 X 轴符号（VRM：X+ = 前抬）
      const liftSign = -1.0; // upperLeg 向前抬起为 X 负（VRM normalized 坐标）

      switch (this.phase) {
        case SP.LIFT: {
          // 迈出腿：大腿向前微抬，小腿弯曲
          const upperLiftAngle = liftSign * this.STEP_UPPER_LEG_LIFT * t * this.stepBlendWeight;
          const lowerBendAngle = this.STEP_LOWER_LEG_BEND * t * this.stepBlendWeight;
          const ankleFlexAngle = -this.STEP_ANKLE_FLEX * t * this.stepBlendWeight;

          if (steppingUpperLeg) {
            this._eu.set(upperLiftAngle, 0, 0, 'YXZ');
            this._q.setFromEuler(this._eu);
            this._q2.copy(restSteppingUpper).multiply(this._q);
            steppingUpperLeg.quaternion.slerp(this._q2, Math.min(1.0, dt * 12.0));
          }
          if (steppingLowerLeg) {
            this._eu.set(lowerBendAngle, 0, 0, 'YXZ');
            this._q.setFromEuler(this._eu);
            this._q2.copy(restSteppingLower).multiply(this._q);
            steppingLowerLeg.quaternion.slerp(this._q2, Math.min(1.0, dt * 12.0));
          }
          if (steppingFoot) {
            this._eu.set(ankleFlexAngle, 0, 0, 'YXZ');
            this._q.setFromEuler(this._eu);
            this._q2.copy(restSteppingFoot).multiply(this._q);
            steppingFoot.quaternion.slerp(this._q2, Math.min(1.0, dt * 12.0));
          }
          // 支撑腿：保持端正
          if (supportUpperLeg) supportUpperLeg.quaternion.slerp(restSupportUpper, Math.min(1.0, dt * 8.0));
          if (supportLowerLeg) supportLowerLeg.quaternion.slerp(restSupportLower, Math.min(1.0, dt * 8.0));
          // 髋部向支撑腿侧微移（重心转移）
          this._applyHipSway(steppingLeft ? 1.0 : -1.0, t * this.stepBlendWeight, dt);
          break;
        }

        case SP.SWING: {
          // 前摆：大腿继续保持抬起，脚踝切换到背屈
          const upperAngle = liftSign * this.STEP_UPPER_LEG_LIFT * this.stepBlendWeight;
          const ankleAngle = this.STEP_ANKLE_FLEX * t * this.stepBlendWeight; // 从背屈转正

          if (steppingUpperLeg) {
            this._eu.set(upperAngle, 0, 0, 'YXZ');
            this._q.setFromEuler(this._eu);
            this._q2.copy(restSteppingUpper).multiply(this._q);
            steppingUpperLeg.quaternion.slerp(this._q2, Math.min(1.0, dt * 10.0));
          }
          if (steppingLowerLeg) {
            // 小腿从弯曲逐渐伸直
            const lowerAngle = this.STEP_LOWER_LEG_BEND * (1.0 - t) * this.stepBlendWeight;
            this._eu.set(lowerAngle, 0, 0, 'YXZ');
            this._q.setFromEuler(this._eu);
            this._q2.copy(restSteppingLower).multiply(this._q);
            steppingLowerLeg.quaternion.slerp(this._q2, Math.min(1.0, dt * 10.0));
          }
          if (steppingFoot) {
            this._eu.set(ankleAngle, 0, 0, 'YXZ');
            this._q.setFromEuler(this._eu);
            this._q2.copy(restSteppingFoot).multiply(this._q);
            steppingFoot.quaternion.slerp(this._q2, Math.min(1.0, dt * 10.0));
          }
          this._applyHipSway(steppingLeft ? 1.0 : -1.0, this.stepBlendWeight, dt);
          break;
        }

        case SP.PLANT: {
          // 落脚：全腿归位
          if (steppingUpperLeg) steppingUpperLeg.quaternion.slerp(restSteppingUpper, Math.min(1.0, dt * 15.0));
          if (steppingLowerLeg) steppingLowerLeg.quaternion.slerp(restSteppingLower, Math.min(1.0, dt * 15.0));
          if (steppingFoot)     steppingFoot.quaternion.slerp(restSteppingFoot, Math.min(1.0, dt * 15.0));
          // 重心切换到刚落地的腿
          this._applyHipSway(steppingLeft ? -1.0 : 1.0, t * this.stepBlendWeight, dt);
          break;
        }

        case SP.SETTLE: {
          // 全身归位：髋部和所有腿平滑回正
          if (steppingUpperLeg)  steppingUpperLeg.quaternion.slerp(restSteppingUpper, Math.min(1.0, dt * 6.0));
          if (steppingLowerLeg)  steppingLowerLeg.quaternion.slerp(restSteppingLower, Math.min(1.0, dt * 6.0));
          if (supportUpperLeg)   supportUpperLeg.quaternion.slerp(restSupportUpper, Math.min(1.0, dt * 6.0));
          if (supportLowerLeg)   supportLowerLeg.quaternion.slerp(restSupportLower, Math.min(1.0, dt * 6.0));
          this._applyHipSway(0, 1.0 - t, dt);
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
            // 一步完成：换腿，如果还在转就继续下一步
            this.stepLeft = !this.stepLeft;
            if (this.isTurning) {
              this.phase      = SP.LIFT;
              this.phaseTimer = 0;
            } else {
              this.phase = SP.IDLE;
            }
            break;
        }
      }
    } else if (this.phase === SP.IDLE && !emageLive) {
      // 不在转身时，确保腿部骨骼平滑归位（防止 EMAGE 退出后残留腿部姿态）
      // 此逻辑与 naturalIdle 的 restQ slerp 协同，不重复应用（仅在 bodyTurn 有残留时清理）
    }

    return yawDelta;
  }

  // ─── 内部辅助 ────────────────────────────────────────────────────────────────

  /**
   * 应用髋部侧移重心（相对静息位置的 X 轴偏移）。
   * @param sideSign  +1 = 向右移（支撑腿在右），-1 = 向左移，0 = 归中
   * @param weight    混合权重 0~1
   * @param dt        帧时间
   */
  private _applyHipSway(sideSign: number, weight: number, dt: number): void {
    if (!this.hips) return;
    const targetX = this.restHipsPos.x + sideSign * this.HIP_SWAY_AMOUNT * weight;
    this._v.set(targetX, this.hips.position.y, this.hips.position.z);
    this.hips.position.lerp(this._v, Math.min(1.0, dt * 8.0));
  }
}
