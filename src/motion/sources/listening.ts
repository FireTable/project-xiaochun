import { type PoseBuffer } from '../pipeline/poseBuffer';
import { computeAdaptiveFadeDuration } from '../pipeline/adaptiveFade';

/**
 * 动捕级专注倾听系统 (Mocap-Driven Listening Motion System)
 *
 * 核心架构：
 * 1. 骨骼与肢体动作：彻底告别手写生硬数学欧拉角，全量由真人专业动捕资产 dm_121.vrma (/vrm/motion/listening.vrma) 驱动；
 * 2. 状态机权重 (weight)：通过 0.75s 起步黄金自适应五次平滑步阶曲线 (Quintic Smootherstep) 计算 [0, 1] 连续进度；
 * 3. 神态与眼神联动：通过 weight 无缝协同 GazeController，提供 92% 视线锁定、温润放松神态 (relaxed: 0.18, happy: 0.04)；
 * 4. 零 GC、高帧率、纯自然真人呼吸与重力流动。
 */
export class ListeningMotionSystem {
  public enabled = true;

  /** 0 为待机，平滑过渡至 1 为完整倾听 (受自适应 Quintic 驱动，保底不低于 0.75s) */
  public weight = 0;
  /** 归一化过渡进度 [0, 1] */
  private progress = 0;
  /** 过渡时长倍率，默认 1.0 */
  public crossfadeScale = 1.0;

  sampleInto(_out: PoseBuffer, _time: number, delta: number, active: boolean): void {
    const target = this.enabled && active ? 1 : 0;
    const isEntering = target > this.progress;

    // 倾听态为温和微神态 (diff ≈ 0.15~0.20)，以 0.75s 为绝对最小值底线自适应延伸
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
    }
  }
}
