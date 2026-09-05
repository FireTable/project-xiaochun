import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';
import {
  PoseBuffer,
  LOWER_BODY_MASK,
  UPPER_BODY_MASK,
  type MotionBoneMask,
} from './poseBuffer';
import {
  UniversalMotionController,
  type PlayMotionOptions,
  type UniversalMotionHandle,
} from './universalMotion';

export type PipelineMotionSource = 'idle' | 'vrma' | 'emage' | 'motion';

/**
 * MotionPipeline — 统一动作融合管线调度器 (Universal Motion Pipeline)
 *
 * 核心架构特性：
 * 1. 万能动作输入 (Any Motion Ingestion)：
 *    无论是 VRMA 动作文件、ArrayBuffer 二进制流、AnimationClip 剪辑、语音生成姿态还是程序待机，
 *    全部进入此单一管线进行评估、补帧与混合。
 * 2. 单一写入者模式 (Single Bone Writer)：
 *    所有子系统（待机、主动作、步态、外部注入）仅提供数据，由管线在末端唯一原子化写入 VRM 骨骼。
 * 3. 连续平滑插补补帧 (Quintic Smootherstep Inbetweening)：
 *    切换动作时，自适应捕获当前物理瞬时姿态，基于五次平滑步阶曲线（首尾零速度零加速度）自适应补全中间帧，
 *    彻底消灭初速冲击、突变闪烁与跳帧。
 * 4. 身体部位解耦遮罩 (Bone Masking & Layering)：
 *    支持半身动作 (UpperBody)、步态解耦 (LowerBody) 以及无感视线解耦，不同身体部位协同并行。
 * 5. 全自动生命周期闭环 (Auto Lifecycle)：
 *    动作播放完毕自动平滑淡出归位到待机，无需外部 hack 状态机或抢跑。
 */
export class MotionPipeline {
  // ── 预分配零 GC 姿态缓冲区 ──
  public readonly basePose = new PoseBuffer();           // Layer 0: NaturalIdle 底层待机姿态
  public readonly actionPose = new PoseBuffer();         // Layer 1: 当前主动作姿态 (VRMA / Clip / EMAGE)
  public readonly transitionFromPose = new PoseBuffer(); // 过渡起点快照 (用于连续平滑插值)
  public readonly locomotionPose = new PoseBuffer();     // Layer 2: 步态踱步姿态
  public readonly finalPose = new PoseBuffer();          // 最终合成姿态

  // ── 通用万能动作播放子控制器 ──
  public readonly universalMotion = new UniversalMotionController();

  // ── 主动作平滑 Crossfader ──
  private activeSource: PipelineMotionSource = 'idle';
  private previousSource: PipelineMotionSource = 'idle';
  private activeMask: MotionBoneMask = 'all';

  private crossfadeElapsed = 0;
  private crossfadeDuration = 0.75;
  private isCrossfading = false;

  // 步态混合权重
  private locomotionWeight = 0.0;

  bind(vrm: VRM): void {
    this.universalMotion.bind(vrm);
  }

  /**
   * 统一动作播放万能入口：
   * 无论丢入 VRMA URL、ArrayBuffer 还是 THREE.AnimationClip，
   * 均由管线统一进行姿态采样、五次平滑步阶补帧、部位遮罩与淡出归位。
   */
  async playMotion(
    vrm: VRM,
    input: string | ArrayBuffer | THREE.AnimationClip,
    options: PlayMotionOptions = {},
    lookAtOffsets?: { neck?: THREE.Quaternion; head?: THREE.Quaternion },
  ): Promise<UniversalMotionHandle> {
    this.bind(vrm);
    const clip = await this.universalMotion.parseToClip(input, vrm);

    const fadeDur = Math.max(0.20, options.fadeDuration ?? 0.75);
    const mask = options.mask ?? 'all';

    // 启动管线平滑流转到通用动作源
    this.setMotionSource('motion', fadeDur, lookAtOffsets, mask);

    // 启动底层动画动作播放
    return this.universalMotion.play(clip, options);
  }

  /**
   * 停止当前通用动作播放，平滑淡出回待机
   */
  stopMotion(
    fadeDuration = 0.75,
    lookAtOffsets?: { neck?: THREE.Quaternion; head?: THREE.Quaternion },
  ): void {
    if (this.activeSource !== 'idle') {
      this.setMotionSource('idle', fadeDuration, lookAtOffsets);
      this.universalMotion.stop(fadeDuration);
    }
  }

  /**
   * 设置当前目标主动作源，自动启动连续平滑融合
   */
  setMotionSource(
    source: PipelineMotionSource,
    duration = 0.75,
    lookAtOffsets?: { neck?: THREE.Quaternion; head?: THREE.Quaternion },
    mask: MotionBoneMask = 'all',
  ): void {
    if (source === this.activeSource && !this.isCrossfading) return;

    // 快照当前合成姿态作为过渡起点
    this.transitionFromPose.copyFrom(this.finalPose);
    if (lookAtOffsets) {
      this.transitionFromPose.removeLookAtOffsets(lookAtOffsets);
    }

    this.previousSource = this.activeSource;
    this.activeSource = source;
    this.activeMask = mask;
    this.crossfadeDuration = Math.max(0.20, duration);
    this.crossfadeElapsed = 0;
    this.isCrossfading = true;
  }

  getActiveSource(): PipelineMotionSource {
    return this.activeSource;
  }

  isTransitioning(): boolean {
    return this.isCrossfading;
  }

  isMotionPlaying(): boolean {
    return this.activeSource === 'motion' && this.universalMotion.isPlaying();
  }

  /**
   * 姿态融合扩展 API (Motion Fusion)：
   * 允许任何外部系统在不修改核心逻辑的情况下，将任意动作或局部动作姿态向管线注入融合。
   */
  blendExternalPose(
    pose: PoseBuffer,
    weight: number,
    mask?: readonly (keyof typeof LOWER_BODY_MASK[number])[],
  ): void {
    if (weight <= 0.0001) return;
    if (mask) {
      this.finalPose.blendMasked(pose, weight, mask as any);
    } else {
      this.finalPose.slerp(pose, Math.min(1.0, weight));
    }
  }

  getFinalPose(): Readonly<PoseBuffer> {
    return this.finalPose;
  }

  /**
   * 每帧流水线核心求值与分层融合 (Motion Evaluation & Inbetweening)
   * 无论输入帧率多少，每帧在当前 delta 下自适应球形插值补全中间帧，永不跳帧。
   *
   * @param vrm             VRM 模型实例
   * @param delta           单帧时间间隔 (秒)
   * @param isStepping      当前是否处于踱步步态中
   * @param lookAtOffsets   可选的头颈视线偏移量 (供动作尾部淡出时安全采样)
   */
  evaluate(
    vrm: VRM,
    delta: number,
    isStepping: boolean,
    lookAtOffsets?: { neck?: THREE.Quaternion; head?: THREE.Quaternion },
  ): void {
    // ── 0. 如果当前处于 universalMotion 模式，更新时间轴并采样姿态 ──
    if (this.activeSource === 'motion') {
      const { isFadingOut, justEnded } = this.universalMotion.update(delta);
      this.actionPose.sampleFromVRM(vrm);

      if (isFadingOut && !this.isCrossfading) {
        // 自动触发平滑淡出回待机
        this.setMotionSource('idle', this.crossfadeDuration, lookAtOffsets);
      } else if (justEnded && this.activeSource === 'motion') {
        this.setMotionSource('idle', 0.40, lookAtOffsets);
      }
    }

    // ── 1. 步态过渡权重平滑追踪 (0.15s 柔和升降) ──
    const targetLocoW = isStepping ? 1.0 : 0.0;
    const locoBlendFactor = 1.0 - Math.exp(-12.0 * Math.min(delta, 0.1));
    this.locomotionWeight += (targetLocoW - this.locomotionWeight) * locoBlendFactor;

    // ── 2. 主动作 Crossfade 权重计算 (五次平滑步阶 Quintic Smootherstep: 零初速、零末速、加速度连续) ──
    let t = 1.0;
    if (this.isCrossfading) {
      this.crossfadeElapsed += delta;
      const alpha = Math.min(1.0, this.crossfadeElapsed / this.crossfadeDuration);
      t = alpha * alpha * alpha * (alpha * (alpha * 6 - 15) + 10);
      if (alpha >= 1.0) {
        this.isCrossfading = false;
      }
    }

    // ── 3. 分层混合合成 FinalPose (自动补全中间帧) ──
    if (this.activeSource === 'idle') {
      if (this.isCrossfading) {
        // 从上一动作平滑淡出回 Idle
        this.finalPose.copyFrom(this.transitionFromPose).slerp(this.basePose, t);
      } else {
        this.finalPose.copyFrom(this.basePose);
      }
    } else {
      // 目标为主动作 (VRMA、EMAGE 或通用动作 Motion)
      if (this.activeMask === 'upperBody') {
        // 局部上半身手势动作：下半身保持自然待机，上半身平滑混合动作姿态
        this.finalPose.copyFrom(this.basePose);
        if (this.isCrossfading) {
          this.finalPose.blendMasked(this.transitionFromPose, 1.0 - t, UPPER_BODY_MASK);
          this.finalPose.blendMasked(this.actionPose, t, UPPER_BODY_MASK);
        } else {
          this.finalPose.blendMasked(this.actionPose, 1.0, UPPER_BODY_MASK);
        }
      } else {
        // 全身主动作
        if (this.isCrossfading) {
          this.finalPose.copyFrom(this.transitionFromPose).slerp(this.actionPose, t);
        } else {
          this.finalPose.copyFrom(this.actionPose);
        }
      }
    }

    // ── 4. 步态下半身遮罩覆盖 (Lower Body Mask Override) ──
    if (this.locomotionWeight > 0.001) {
      this.finalPose.blendMasked(this.locomotionPose, this.locomotionWeight, LOWER_BODY_MASK);
    }

    // ── 5. 原子化唯一提交写入 VRM 骨骼 (Single Bone Writer) ──
    this.finalPose.commitToVRM(vrm);
  }
}
