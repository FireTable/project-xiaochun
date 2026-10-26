import * as THREE from 'three';
import type { VRMHumanBoneName } from '@pixiv/three-vrm';
import { BONE_INDEX_MAP, type PoseBuffer } from '../pipeline/poseBuffer';
import { SOURCE_FADE_DURATION } from '../pipeline/selectLiveMotionSource';

/**
 * 倾听动作系统 (Listening Motion System)
 *
 * 姿态：单手（右手）托腮，身体微倾，歪头玩味注视。
 * - 左臂：自然垂顺在身体左侧（Z 轴负向垂落）。
 * - 右臂：大臂贴胸前收，小臂深屈折叠向上，手掌微托下颌，食指轻贴脸颊。
 * - 躯干与头颈：轻微前倾与向右侧偏，随呼吸微动。
 *
 * 过渡曲线：与全局 MotionPipeline 严格统一，采用标准 0.75s 五次平滑步阶曲线 (Quintic Smootherstep)。
 */
export class ListeningMotionSystem {
  public enabled = true;

  /** 0 为待机，平滑过渡至 1 为完整托腮倾听 (受 0.75s Quintic 驱动) */
  public weight = 0;
  /** 归一化过渡进度 [0, 1] */
  private progress = 0;
  /** 过渡时长倍率，默认 1.0 (基准时长 0.75s) */
  public crossfadeScale = 1.0;

  private _euler = new THREE.Euler();
  private _targetQ = new THREE.Quaternion();

  sampleInto(out: PoseBuffer, time: number, delta: number, active: boolean): void {
    const target = this.enabled && active ? 1 : 0;
    const duration = Math.max(0.2, SOURCE_FADE_DURATION * this.crossfadeScale);

    if (target > this.progress) {
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
    const breath = Math.sin(time * 1.25);
    const sway = Math.sin(time * 0.9) * 0.015;

    // ── 1. 躯干与胸腔：专注微前倾 + 侧倾迎合托手侧 ──
    this.slerpEuler(out, 'spine', 0.03, 0.02, -0.02, w * 0.7);
    this.slerpEuler(out, 'chest', 0.05 + breath * 0.006, 0.02 + sway, -0.03, w * 0.85);
    this.slerpEuler(out, 'upperChest', 0.03, 0.01, -0.02, w * 0.85);

    // ── 2. 头颈部：随右侧托手自然歪头 ──
    this.slerpEuler(out, 'neck', 0.03 + breath * 0.004, 0.02, 0.03, w);
    this.slerpEuler(out, 'head', 0.04 + Math.sin(time * 1.8) * 0.006, sway * 0.4, 0.065, w);

    // ── 3. 左臂：保持自然垂顺在身体侧面 (VRM 左大臂垂顺 Z ≈ -1.33) ──
    this.slerpEuler(out, 'leftShoulder', 0.01, 0, -0.02, w);
    this.slerpEuler(out, 'leftUpperArm', 0.04, 0.02, -1.33, w);
    this.slerpEuler(out, 'leftLowerArm', 0.0, 0.0, 0.08, w);
    this.slerpEuler(out, 'leftHand', 0.04, 0.0, 0.0, w);

    // ── 4. 右臂：核心托腮折叠动力学 (VRM 右大臂垂顺基准 Z ≈ +1.33) ──
    // 右肩微耸前引
    this.slerpEuler(out, 'rightShoulder', 0.02, -0.03, 0.04, w);
    // 右大臂：向前俯仰 (X ≈ -1.15) 并贴胸向内 (Y ≈ 0.55, Z ≈ 1.30)
    this.slerpEuler(out, 'rightUpperArm', -1.15 + breath * 0.008, 0.55, 1.30, w);
    // 右小臂：深屈手肘向上引向脸颊 (Y 轴折叠向上 2.05 rad，Z 轴微内收 0.25 rad)
    this.slerpEuler(out, 'rightLowerArm', 0.0, 2.05, 0.25, w);
    // 右手腕：轻度背屈托下巴
    this.slerpEuler(out, 'rightHand', 0.15, -0.10, 0.05, w);

    // ── 5. 右手五指造型：大拇指托颌、食指点颊、三指自然收拢 ──
    this.applyChinRestHand(out, w);
  }

  private applyChinRestHand(out: PoseBuffer, w: number): void {
    // 大拇指承托
    this.slerpEuler(out, 'rightThumbMetacarpal', -0.08, -0.18, 0.20, w);
    this.slerpEuler(out, 'rightThumbProximal', -0.04, -0.12, 0.26, w);
    this.slerpEuler(out, 'rightThumbDistal', 0.0, -0.05, 0.20, w);

    // 食指自然伸展微屈（贴在脸颊）
    this.slerpEuler(out, 'rightIndexProximal', 0.02, -0.01, 0.18, w);
    this.slerpEuler(out, 'rightIndexIntermediate', 0.0, 0.0, 0.20, w);
    this.slerpEuler(out, 'rightIndexDistal', 0.0, 0.0, 0.12, w);

    // 中指 / 无名指 / 小指：自然半握蜷在下巴底
    this.slerpEuler(out, 'rightMiddleProximal', 0.0, 0.0, 0.45, w);
    this.slerpEuler(out, 'rightMiddleIntermediate', 0.0, 0.0, 0.65, w);
    this.slerpEuler(out, 'rightMiddleDistal', 0.0, 0.0, 0.35, w);

    this.slerpEuler(out, 'rightRingProximal', -0.02, 0.01, 0.50, w);
    this.slerpEuler(out, 'rightRingIntermediate', 0.0, 0.0, 0.70, w);
    this.slerpEuler(out, 'rightRingDistal', 0.0, 0.0, 0.40, w);

    this.slerpEuler(out, 'rightLittleProximal', -0.04, 0.02, 0.55, w);
    this.slerpEuler(out, 'rightLittleIntermediate', 0.0, 0.0, 0.75, w);
    this.slerpEuler(out, 'rightLittleDistal', 0.0, 0.0, 0.45, w);
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
