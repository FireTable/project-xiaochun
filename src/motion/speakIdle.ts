import * as THREE from 'three';

const NUM_JOINTS = 55;
const FINGER_INDICES = new Set(Array.from({ length: 30 }, (_, i) => 25 + i));

// VRM 标准下自然垂臂的静息四元数 (用于自适应判断当前手臂是在身前手势态还是身侧垂顺态)
const REST_ARM_L_Q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, -1.33));
const REST_ARM_R_Q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, 1.33));

/**
 * SpeakIdleSystem — 高阶自适应言谈间歇仿生微律动系统
 *
 * 与 NaturalIdle 的固定站立垂手待机不同，SpeakIdle 核心在于【随机应变，随势而动】：
 * 1. 姿态感知与分类 (Gesture Context Awareness):
 *    - 若前段结束时手势举在身前/胸前，保持言谈悬浮态 (Conversational Hold)，施加呼吸浮力浮沉，
 *      且若等待超过 1.5s 施加极其轻微的重力自然微沉降，绝不瞬间掉手或定格成蜡像；
 *    - 若手臂已在身侧低位，顺应身体侧线保持低位松弛浮沉。
 * 2. VRM 1.0 生理真指节 (Anatomical Knuckle Flexion):
 *    - 严格依照解剖学沿 Z 轴实施真指关节内卷，左右手符号对称 (sign)，
 *      保留 EMAGE 原生手形的前提下，叠加脉搏呼吸微舒缩 (Micro-pulse)。
 * 3. 意识流交谈视线游移 (Organic Gaze Wander):
 *    - 细微的 1°~2° 倾听点头与思考游移，消除头部云台定格感。
 * 4. 多频复合躯干呼吸律动:
 *    - 胸腔深呼浅吸主频 (0.24Hz) 驱动脊柱与胸腔起伏，锁骨与肩膀微耸滞后。
 */
export class SpeakIdleSystem {
  private active = false;
  private timer = 0;
  private baseQ = Array.from({ length: NUM_JOINTS }, () => new THREE.Quaternion());

  // 当前手臂手势状态识别 (true = 正在身前/胸前做手势中, false = 低位垂臂)
  private leftArmRaised = false;
  private rightArmRaised = false;

  // 预分配临时复用对象，确保 60/120 FPS 满帧 0 垃圾回收 (Zero-GC)
  private _qGoal = new THREE.Quaternion();
  private _deltaQ = new THREE.Quaternion();
  private _euler = new THREE.Euler(0, 0, 0, 'YXZ');

  /**
   * 激活言谈间歇待机：
   * 锁定当前姿态，并分析双臂手势高度，因地制宜确定随后的微动模式
   */
  enter(currentBoneQ: THREE.Quaternion[]): void {
    if (this.active) return;
    this.active = true;
    this.timer = 0;

    for (let i = 0; i < NUM_JOINTS; i++) {
      if (currentBoneQ[i]) {
        this.baseQ[i]!.copy(currentBoneQ[i]!);
      }
    }

    // 智能动作识别：通过与标准垂臂四元数的夹角判断手势高度
    // 左大臂 index 16, 右大臂 index 17
    const dotL = Math.abs(this.baseQ[16]!.dot(REST_ARM_L_Q));
    const dotR = Math.abs(this.baseQ[17]!.dot(REST_ARM_R_Q));
    // 夹角 > 25° (dot < 0.975) 视为处于身前活跃手势态
    this.leftArmRaised = dotL < 0.975;
    this.rightArmRaised = dotR < 0.975;
  }

  exit(): void {
    this.active = false;
  }

  isActive(): boolean {
    return this.active;
  }

  /**
   * 每帧执行微律动驱动 (随机应变叠加在 baseQ 之上)
   */
  update(
    delta: number,
    bones: (THREE.Object3D | null)[],
    currentBoneQ: THREE.Quaternion[],
  ): void {
    if (!this.active) return;

    this.timer += delta;
    const t = this.timer;

    // 柔和平滑切入包络 (前 0.35s 从 0 平滑淡入微动，杜绝突变)
    const blendEnvelope = Math.min(1.0, t / 0.35);

    // ─── 1. 生理多频呼吸波形 (周期 ~2.4s) ───
    const breathCycle = t * 2.4;
    const breathMain = Math.sin(breathCycle);
    const breathHarmonic = Math.sin(breathCycle * 2.0 + 0.3) * 0.18;
    const breath = (breathMain + breathHarmonic) * blendEnvelope;

    // ─── 2. 8字形慢频低重力重心平衡微移 (周期 ~10s) ───
    const swayX = Math.sin(t * 0.6) * 0.008 * blendEnvelope;
    const swayZ = Math.cos(t * 0.45) * 0.006 * blendEnvelope;

    // ─── 3. 肩膀/锁骨微耸 (吸气时微滞后向上微抬) ───
    const shoulderLift = Math.max(0, Math.sin(breathCycle - 0.25)) * 0.016 * blendEnvelope;

    // ─── 4. 手指 Z 轴真指节向内脉搏微卷 (脉搏舒缩) ───
    const fingerPulse = Math.sin(t * 2.2) * 0.035 * blendEnvelope;

    // ─── 5. 意识流头部活人微视线游移 (倾听与思考) ───
    const headNod = (Math.sin(t * 1.15) * 0.014 - 0.004) * blendEnvelope;
    const headTurn = Math.sin(t * 0.65) * 0.018 * blendEnvelope;
    const headTilt = (-swayZ * 0.5 + Math.sin(t * 0.85) * 0.012) * blendEnvelope;

    // ─── 6. 长等待手势重力自然微沉降 (Micro-settle) ───
    // 若手势悬在胸前超过 1.5s，人类肌肉会自然放松沉降约 1°~2°，消除“画面暂停”感
    const settle = (t > 1.5 ? Math.min(0.04, (t - 1.5) * 0.015) : 0.0) * blendEnvelope;

    // 阻尼跟随速度 (约 6.0，丝滑柔顺)
    const followFactor = 1.0 - Math.exp(-6.5 * Math.max(0.001, delta));

    for (let i = 0; i < NUM_JOINTS; i++) {
      const bone = bones[i];
      if (!bone) continue;

      const qGoal = this._qGoal.copy(this.baseQ[i]!);

      if (i === 0) {
        // 骨盆 (hips): 微重力轻微呼吸起伏与横向微移
        this._euler.set(-0.006 * breath, swayX * 0.3, swayZ * 0.4);
        this._deltaQ.setFromEuler(this._euler);
        qGoal.multiply(this._deltaQ);
      } else if (i === 3) {
        // 腰椎 (spine): 反向平衡补偿与呼吸微扩张
        this._euler.set(0.010 * breath, swayX * 0.4, swayZ * 0.4);
        this._deltaQ.setFromEuler(this._euler);
        qGoal.multiply(this._deltaQ);
      } else if (i === 6 || i === 9) {
        // 胸腔 (chest) 与上胸腔 (upperChest): 显著呼吸舒张
        const factor = i === 6 ? -0.022 : -0.016;
        this._euler.set(factor * breath, swayX * 0.2, swayZ * 0.3);
        this._deltaQ.setFromEuler(this._euler);
        qGoal.multiply(this._deltaQ);
      } else if (i === 13 || i === 14) {
        // 左右肩膀微耸 (Z 轴：左正右负)
        const side = i === 13 ? 1 : -1;
        this._euler.set(0, 0, side * shoulderLift);
        this._deltaQ.setFromEuler(this._euler);
        qGoal.multiply(this._deltaQ);
      } else if (i === 16 || i === 17) {
        // 左右大臂：根据当前是在胸前做手势还是垂臂，自适应处理！
        const isLeft = (i === 16);
        const isRaised = isLeft ? this.leftArmRaised : this.rightArmRaised;
        const side = isLeft ? 1 : -1;

        if (isRaised) {
          // 身前手势态：保持悬停交谈态，伴随呼吸浮沉与缓慢重力松弛微沉降
          const armBuoyancy = Math.sin(breathCycle - 0.20) * 0.014 * blendEnvelope;
          // X 轴轻微俯仰微沉降，Z 轴轻微开合浮沉
          this._euler.set(settle + armBuoyancy * 0.6, 0, side * armBuoyancy * 0.5);
        } else {
          // 垂臂态：顺应身体侧线微舒张
          const armHangSwing = breath * 0.010;
          this._euler.set(0, 0, side * armHangSwing);
        }
        this._deltaQ.setFromEuler(this._euler);
        qGoal.multiply(this._deltaQ);
      } else if (i === 18 || i === 19) {
        // 左右小臂 (肘关节)：手势态时提供自然的肘部柔和微屈浮沉
        const isLeft = (i === 18);
        const isRaised = isLeft ? this.leftArmRaised : this.rightArmRaised;
        if (isRaised) {
          const elbowPulse = Math.sin(breathCycle * 0.95) * 0.012 * blendEnvelope;
          this._euler.set(elbowPulse, 0, 0);
          this._deltaQ.setFromEuler(this._euler);
          qGoal.multiply(this._deltaQ);
        }
      } else if (i === 12 || i === 15) {
        // 头部与颈部：意识流微视线与轻微探寻思考
        const factor = i === 15 ? 1.0 : 0.45;
        this._euler.set(headNod * factor, headTurn * factor, headTilt * factor);
        this._deltaQ.setFromEuler(this._euler);
        qGoal.multiply(this._deltaQ);
      } else if (FINGER_INDICES.has(i)) {
        // VRM 1.0 严格解剖学十指微卷：以 Z 轴实施真指关节脉搏收缩
        // 左手指 25~39 (sign = 1, 内卷向 -Z); 右手指 40~54 (sign = -1, 内卷向 +Z)
        const sign = i < 40 ? 1 : -1;
        this._euler.set(0, 0, sign * (-fingerPulse));
        this._deltaQ.setFromEuler(this._euler);
        qGoal.multiply(this._deltaQ);
      }

      currentBoneQ[i]!.slerp(qGoal, followFactor);
      bone.quaternion.copy(currentBoneQ[i]!);
    }
  }
}
