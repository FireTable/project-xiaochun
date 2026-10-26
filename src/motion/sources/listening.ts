import * as THREE from 'three';
import type { VRMHumanBoneName } from '@pixiv/three-vrm';
import { BONE_INDEX_MAP, type PoseBuffer } from '../pipeline/poseBuffer';
import { computeAdaptiveFadeDuration } from '../pipeline/adaptiveFade';

/**
 * 专注倾听动作系统 (Attentive Listening Motion System)
 *
 * 核心设计蓝图（4 维少女专注体态）：
 * 1. 手部姿态：双手自然背后相扣/轻叠（规整乖巧端正，零发丝物理碰撞与穿模，面部轮廓干净留白）；
 * 2. 躯干体态：上身专注微前倾 ~3°（拉近心理距离）+ 微偏航 ~2.5° 迎合 + 18s 超低频重心微漂移与呼吸；
 * 3. 头颈部：亲和力侧倾 ~6° + 核心灵魂「相槌 (Aizuchi) 微点头」（每隔 ~2.8s 产生一次柔和点头：下点0.25s ➔ 停留0.15s ➔ 慢回弹0.45s ➔ 停顿）；
 * 4. 眼神表情：92% 时间视线专注锁定用户，眉眼放松舒展 (relaxed: 0.18)，嘴角平顺微抿 (happy: 0.04)；
 * 5. 过渡节奏：严格坚守 0.75s 黄金自适应底线，五次平滑步阶曲线 (Quintic Smootherstep)。
 */
export class ListeningMotionSystem {
  public enabled = true;

  /** 0 为待机，平滑过渡至 1 为完整专注倾听 (受自适应 Quintic 驱动，保底不低于 0.75s) */
  public weight = 0;
  /** 归一化过渡进度 [0, 1] */
  private progress = 0;
  /** 过渡时长倍率，默认 1.0 */
  public crossfadeScale = 1.0;

  private _euler = new THREE.Euler();
  private _targetQ = new THREE.Quaternion();

  sampleInto(out: PoseBuffer, time: number, delta: number, active: boolean): void {
    const target = this.enabled && active ? 1 : 0;
    const isEntering = target > this.progress;

    // 倾听态为温和微神态 (diff ≈ 0.15~0.20)，以 0.75s 为绝对最小值底线自适应延伸至 ~0.80s
    const duration = computeAdaptiveFadeDuration(0.20, {
      crossfadeScale: this.crossfadeScale,
      isActionToIdle: !isEntering,
    });

    if (isEntering) {
      this.progress = Math.min(1.0, this.progress + delta / duration);
    } else if (target < this.progress) {
      this.progress = Math.max(0.0, this.progress - delta / duration);
    }

    // 采用与全局管线 100% 一致的五次平滑步阶曲线 (首尾零速度零加速度，消除任何机械冲击)
    const p = this.progress;
    this.weight = p * p * p * (p * (p * 6 - 15) + 10);

    if (this.weight < 0.0005) {
      this.weight = 0;
      return;
    }

    const w = this.weight;

    // ── 生理节律与超低频微动 ──
    // 呼吸波动 (约 3.6s 周期)
    const breath = Math.sin(time * 1.75);
    // 18s 超低频重心漂移微晃 (彻底消除木桩死板定格感)
    const slowDrift = Math.sin(time * (Math.PI * 2 / 18.0)) * 0.012;
    const slowSway = Math.cos(time * (Math.PI * 2 / 14.0)) * 0.008;

    // ── 1. 躯干与体态：前倾倾注 (~3°) + 微侧身迎合 (~2.5°) ──
    // spine: 前倾 ~1.4° (0.025 rad) + 微侧偏航 ~1.4° (0.025 rad)
    this.slerpEuler(out, 'spine', 0.025 + breath * 0.003, 0.025 + slowDrift, -0.010 + slowSway, w * 0.75);
    // chest: 前倾 ~1.6° (0.028 rad) + 微侧偏航 ~1.1° (0.020 rad) + 呼吸起伏
    this.slerpEuler(out, 'chest', 0.028 + breath * 0.006, 0.020 + slowDrift * 0.6, -0.012, w * 0.85);
    // upperChest: 前倾 ~0.9° (0.015 rad)
    this.slerpEuler(out, 'upperChest', 0.015 + breath * 0.004, 0.010, -0.008, w * 0.85);

    // ── 2. 头颈部：歪头倾听 (~6.3°) + 核心灵魂「相槌（Aizuchi）微点头」 ──
    // 相槌动态循环：周期 2.85s (下点 0.25s ➔ 停留 0.15s ➔ 慢回弹 0.45s ➔ 待机停顿 2.0s)
    const aizuchiPeriod = 2.85;
    const cycleT = (time + 0.3) % aizuchiPeriod;
    let nodPitch = 0.0; // 弧度

    if (cycleT < 0.25) {
      // Phase 1: 0.25s 柔和下点 (幅值 ~2° = 0.035 rad)
      const t1 = cycleT / 0.25;
      const s1 = t1 * t1 * (3 - 2 * t1); // smoothstep
      nodPitch = 0.035 * s1;
    } else if (cycleT < 0.40) {
      // Phase 2: 0.15s 短暂停留（心领神会）
      nodPitch = 0.035;
    } else if (cycleT < 0.85) {
      // Phase 3: 0.45s 慢速柔和回弹
      const t3 = (cycleT - 0.40) / 0.45;
      const s3 = t3 * t3 * (3 - 2 * t3);
      nodPitch = 0.035 * (1.0 - s3);
    } else {
      // Phase 4: 待机聆听静止期 (2.0s)
      nodPitch = 0.0;
    }

    // neck: 轻微俯仰随动 + 侧倾 ~2.3° (0.040 rad) + 偏航
    this.slerpEuler(out, 'neck', 0.015 + nodPitch * 0.35 + breath * 0.003, 0.015 + slowDrift * 0.4, 0.040, w);
    // head: 主点头幅值 + 侧倾 ~4.0° (0.070 rad)
    this.slerpEuler(out, 'head', 0.020 + nodPitch * 0.65, slowSway * 0.5, 0.070, w);

    // ── 3. 手部姿态：双手自然背后轻扣（规整乖巧、彻底杜绝发丝与衣服穿模） ──
    // 左肩与右肩：轻微后展 (Retraction)，打开胸膛
    this.slerpEuler(out, 'leftShoulder', 0.02, -0.04, -0.04, w);
    this.slerpEuler(out, 'rightShoulder', 0.02, 0.04, 0.04, w);

    // 左大臂：顺肩向下后方自然收拢 (X: +0.25 伸展向后, Y: -0.18 内收向腰背, Z: -1.30 下垂)
    this.slerpEuler(out, 'leftUpperArm', 0.25 + breath * 0.004, -0.18, -1.30, w);
    // 右大臂：顺肩向下后方自然收拢 (X: +0.25 伸展向后, Y: +0.18 内收向腰背, Z: +1.30 下垂)
    this.slerpEuler(out, 'rightUpperArm', 0.25 + breath * 0.004, 0.18, 1.30, w);

    // 左小臂：手肘轻折向后腰/尾椎部位 (X: -0.10, Y: -0.22, Z: -0.28)
    this.slerpEuler(out, 'leftLowerArm', -0.10, -0.22, -0.28, w);
    // 右小臂：手肘轻折向后腰/尾椎部位 (X: -0.10, Y: +0.22, Z: +0.28)
    this.slerpEuler(out, 'rightLowerArm', -0.10, 0.22, 0.28, w);

    // 左手手腕：在后腰处放松轻叠
    this.slerpEuler(out, 'leftHand', -0.06, -0.10, 0.12, w);
    // 右手手腕：轻扣在左手背/手腕处
    this.slerpEuler(out, 'rightHand', -0.06, 0.10, -0.12, w);

    // ── 4. 双手十指造型：后背放松微卷轻搭，优雅舒展 ──
    this.applyBackFingersPose(out, w);
  }

  /** 双手置于后腰时的自然微扣十指造型 */
  private applyBackFingersPose(out: PoseBuffer, w: number): void {
    // 左手五指：自然微曲轻搭
    this.slerpEuler(out, 'leftThumbMetacarpal', -0.05, 0.05, -0.15, w);
    this.slerpEuler(out, 'leftThumbProximal', -0.04, 0.08, -0.18, w);
    this.slerpEuler(out, 'leftThumbDistal', 0.0, 0.05, -0.12, w);

    this.slerpEuler(out, 'leftIndexProximal', 0.04, 0.0, -0.25, w);
    this.slerpEuler(out, 'leftIndexIntermediate', 0.0, 0.0, -0.32, w);
    this.slerpEuler(out, 'leftIndexDistal', 0.0, 0.0, -0.20, w);

    this.slerpEuler(out, 'leftMiddleProximal', 0.02, 0.0, -0.28, w);
    this.slerpEuler(out, 'leftMiddleIntermediate', 0.0, 0.0, -0.35, w);
    this.slerpEuler(out, 'leftMiddleDistal', 0.0, 0.0, -0.22, w);

    this.slerpEuler(out, 'leftRingProximal', 0.0, 0.0, -0.30, w);
    this.slerpEuler(out, 'leftRingIntermediate', 0.0, 0.0, -0.38, w);
    this.slerpEuler(out, 'leftRingDistal', 0.0, 0.0, -0.24, w);

    this.slerpEuler(out, 'leftLittleProximal', -0.02, 0.0, -0.32, w);
    this.slerpEuler(out, 'leftLittleIntermediate', 0.0, 0.0, -0.40, w);
    this.slerpEuler(out, 'leftLittleDistal', 0.0, 0.0, -0.26, w);

    // 右手五指：对称轻扣
    this.slerpEuler(out, 'rightThumbMetacarpal', -0.05, -0.05, 0.15, w);
    this.slerpEuler(out, 'rightThumbProximal', -0.04, -0.08, 0.18, w);
    this.slerpEuler(out, 'rightThumbDistal', 0.0, -0.05, 0.12, w);

    this.slerpEuler(out, 'rightIndexProximal', 0.04, 0.0, 0.25, w);
    this.slerpEuler(out, 'rightIndexIntermediate', 0.0, 0.0, 0.32, w);
    this.slerpEuler(out, 'rightIndexDistal', 0.0, 0.0, 0.20, w);

    this.slerpEuler(out, 'rightMiddleProximal', 0.02, 0.0, 0.28, w);
    this.slerpEuler(out, 'rightMiddleIntermediate', 0.0, 0.0, 0.35, w);
    this.slerpEuler(out, 'rightMiddleDistal', 0.0, 0.0, 0.22, w);

    this.slerpEuler(out, 'rightRingProximal', 0.0, 0.0, 0.30, w);
    this.slerpEuler(out, 'rightRingIntermediate', 0.0, 0.0, 0.38, w);
    this.slerpEuler(out, 'rightRingDistal', 0.0, 0.0, 0.24, w);

    this.slerpEuler(out, 'rightLittleProximal', -0.02, 0.0, 0.32, w);
    this.slerpEuler(out, 'rightLittleIntermediate', 0.0, 0.0, 0.40, w);
    this.slerpEuler(out, 'rightLittleDistal', 0.0, 0.0, 0.26, w);
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
    if (idx === undefined || weight <= 0) return;
    this._euler.set(x, y, z);
    this._targetQ.setFromEuler(this._euler);
    out.quaternions[idx]!.slerp(this._targetQ, weight);
  }
}
