import * as THREE from 'three';
import type { VRM, VRMHumanBoneName } from '@pixiv/three-vrm';
import {
  PoseBuffer,
  LEGS_MASK,
  copyTransitionSnapshot,
  type MotionBoneMask,
} from './poseBuffer';
import {
  UniversalMotionController,
  type PlayMotionOptions,
  type UniversalMotionHandle,
} from '../sources/clip';
import { NaturalIdleSystem } from '../sources/idle';
import { VRMAMotionPlayer } from '../sources/vrma';
import { EmagePlayer } from '../sources/emage';
import { FootIKSolver } from '../constraints/footIK';
import { BodyTurnSystem } from '../constraints/bodyTurn';
import { GazeController } from '../constraints/gaze';
import { MotionTransitionManager } from './transition';
import { DEFAULT_MOTION_TRAITS, type MotionConstraint, type MotionSource, type MotionTraits } from './types';
import {
  selectLiveMotionSource,
  writerToPipelineSource,
  SOURCE_FADE_DURATION,
  WRITER_FADE_DURATION,
  type LiveMotionWriter,
} from './selectLiveMotionSource';

export type PipelineMotionSource = 'idle' | 'vrma' | 'emage' | 'motion';
export type { MotionTraits, MotionSource, MotionConstraint, PlayHandle } from './types';
export { selectLiveMotionSource, writerToPipelineSource } from './selectLiveMotionSource';
export type { LiveMotionWriter, LiveMotionFlags } from './selectLiveMotionSource';

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
  public readonly lowerPose = new PoseBuffer();          // 分层下半身姿态缓冲
  public readonly upperPose = new PoseBuffer();          // 分层上半身姿态缓冲
  public readonly finalPose = new PoseBuffer();          // 最终合成姿态
  public readonly draftPose = new PoseBuffer();          // Quintic layered pose for FootIK / Gaze world solve
  public readonly restPose = new PoseBuffer();           // bind-pose rest (pitch clamp reference)

  // ── Plugins (sources + constraints). tick() is the unique per-frame driver. ──
  public readonly idle = new NaturalIdleSystem();
  public readonly vrma = new VRMAMotionPlayer();
  public readonly universalMotion = new UniversalMotionController();
  public readonly emage = new EmagePlayer();
  public readonly footIK = new FootIKSolver();
  public readonly bodyTurn = new BodyTurnSystem();
  public readonly gaze = new GazeController();
  public readonly transition = new MotionTransitionManager();

  /** Registered sources for later tick-driven playback. Not sampled yet. */
  public readonly sources: MotionSource[] = [];
  /** Registered constraints. Not applied yet. */
  public readonly constraints: MotionConstraint[] = [];

  constructor() {
    this.emage.footIK = this.footIK;
    this.emage.getLookAtOffsets = () => this.gaze.getLookAtOffsets();
  }

  // ── 主动作平滑 Crossfader ──
  private activeSource: PipelineMotionSource = 'idle';
  public previousSource: PipelineMotionSource = 'idle';
  private activeMask: MotionBoneMask = 'all';

  private crossfadeElapsed = 0;
  private crossfadeDuration = SOURCE_FADE_DURATION;
  private isCrossfading = false;
  private currentTransitionT = 1.0;
  /** Freeze Quintic at t=0 until the new Layer-1 source actually sampled into actionPose. */
  private waitingForActionSample = false;

  private sampledThisFrame = false;
  private bodyTurnIsStepping = false;
  private footIkMix = 0;
  private locomotionWeight = 0; // 下半身步态连续混合权重 [0: 动作源下半身, 1: 步态踱步]
  private boundVrm: VRM | null = null;
  private _btPos = new THREE.Vector3();



  bind(vrm: VRM): void {
    const same = this.boundVrm === vrm;
    this.universalMotion.bind(vrm);
    this.vrma.bind(vrm);
    if (!same) {
      this.restPose.sampleFromVRM(vrm);
      this.emage.bind(vrm);
      this.idle.bind(vrm);
    }
    this.footIK.bind(vrm);
    this.bodyTurn.bind(vrm);
    this.boundVrm = vrm;

    this.finalPose.sampleFromVRM(vrm);
    this.draftPose.sampleFromVRM(vrm);
    this.basePose.sampleFromVRM(vrm);
    this.actionPose.sampleFromVRM(vrm);
    this.transitionFromPose.sampleFromVRM(vrm);
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

    const fadeDur = Math.max(0.26, options.fadeDuration ?? SOURCE_FADE_DURATION);
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
    fadeDuration = SOURCE_FADE_DURATION,
    lookAtOffsets?: { neck?: THREE.Quaternion; head?: THREE.Quaternion },
  ): void {
    if (this.activeSource !== 'idle') {
      this.setMotionSource('idle', fadeDuration, lookAtOffsets);
      this.universalMotion.stop(fadeDuration);
    }
  }

  /** Play thinking VRMA as the live pipeline source (thinkSway trait, no director flag). */
  playThinkingClip(clip: THREE.AnimationClip, vrm: VRM, fadeDuration = SOURCE_FADE_DURATION): void {
    this.idle.traits.thinkSway = false;
    this.vrma.traits = { allowLocomotion: true, thinkSway: true };
    this.vrma.playLoop(clip, vrm, fadeDuration);
    this.setMotionSource('vrma', fadeDuration, this.gaze.getLookAtOffsets(), 'upperBody');
  }

  /** Gaze-only think sway when the thinking clip is missing. Idle remains the writer. */
  setIdleThinkSway(on: boolean): void {
    this.idle.traits.thinkSway = on;
  }

  /** Switch Layer-1 to EMAGE speech (planted stance, no think sway). */
  beginEmageSpeech(): void {
    this.idle.traits.thinkSway = false;
    this.vrma.traits = { ...DEFAULT_MOTION_TRAITS };
    this.actionPose.copyFrom(this.finalPose);
    this.emage.traits = { allowLocomotion: true, thinkSway: false, glanceChance: 0.40 };
    this.setMotionSource('emage', SOURCE_FADE_DURATION, this.gaze.getLookAtOffsets(), 'all');
  }

  /** End chat motion sources; tick will return to idle when nothing is playing. */
  resetChatMotion(): void {
    this.idle.traits = { ...DEFAULT_MOTION_TRAITS };
    this.vrma.traits = { ...DEFAULT_MOTION_TRAITS };
    this.emage.traits = { allowLocomotion: true, thinkSway: false, glanceChance: 0.40 };
  }

  traitsForWriter(writer: LiveMotionWriter): MotionTraits {
    if (writer === 'emage') return this.emage.traits;
    if (writer === 'vrma') return this.vrma.traits;
    if (writer === 'clip') return this.universalMotion.traits;
    return this.idle.traits;
  }

  /**
   * 设置当前目标主动作源，自动启动连续平滑融合
   */
  setMotionSource(
    source: PipelineMotionSource,
    duration = SOURCE_FADE_DURATION,
    lookAtOffsets?: { neck?: THREE.Quaternion; head?: THREE.Quaternion },
    mask: MotionBoneMask = 'all',
  ): void {
    if (source === this.activeSource && mask === this.activeMask && !this.isCrossfading) return;

    copyTransitionSnapshot(this.transitionFromPose, this.finalPose, lookAtOffsets, true);

    // 动作源切换瞬间无缝捕获当前脚部真实物理位置，保证小腿与两足连续平滑过渡，绝不单帧瞬移拉扯
    this.footIK.anchorToCurrentFeet();

    this.previousSource = this.activeSource;
    this.activeSource = source;
    this.activeMask = mask;
    this.crossfadeDuration = Math.max(0.26, duration);
    this.crossfadeElapsed = 0;
    this.isCrossfading = true;
    this.waitingForActionSample = source !== 'idle';
  }

  getActiveSource(): PipelineMotionSource {
    return this.activeSource;
  }

  getLiveWriter(): LiveMotionWriter {
    return selectLiveMotionSource({
      clip: this.universalMotion.isPlaying(),
      emage: this.emage.isPlaying(),
      vrma: this.vrma.isPlaying(),
    });
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
    mask?: readonly VRMHumanBoneName[],
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

  getCurrentTransitionT(): number {
    return this.currentTransitionT;
  }

  /**
   * Per-frame motion: sample sources → Quintic blend → commit once →
   * BodyTurn / FootIK / Gaze. Engine loop should not write bones.
   */
  tick(
    vrm: VRM,
    ctx: {
      camera: THREE.Camera;
      delta: number;
      time: number;
      enableBodyTurn: boolean;
      isSpeaking: boolean;
      manualExpression: string | null;
    },
  ): void {
    const { delta, time, camera } = ctx;
    const lookAtOffsets = this.gaze.getLookAtOffsets();
    this.sampledThisFrame = false;

    // 1. 动态选择上层活跃动作源
    const writer = selectLiveMotionSource({
      clip: this.universalMotion.isPlaying(),
      emage: this.emage.isPlaying(),
      vrma: this.vrma.isPlaying(),
    });
    const target = writerToPipelineSource(writer);
    const traits = this.traitsForWriter(writer);
    const targetDuration = writer === 'clip'
      ? (this.universalMotion.getCurrentOptions().fadeDuration ?? WRITER_FADE_DURATION.clip)
      : WRITER_FADE_DURATION[writer];

    const targetMask: MotionBoneMask = target === 'vrma'
      ? 'upperBody'
      : (writer === 'clip' ? (this.universalMotion.getCurrentOptions().mask ?? 'all') : 'all');

    if (target !== this.activeSource || targetMask !== this.activeMask) {
      const holdEmage = this.activeSource === 'emage'
        && (this.isCrossfading || this.waitingForActionSample)
        && (target === 'idle' || target === 'vrma');
      if (!holdEmage) {
        this.setMotionSource(target, targetDuration, lookAtOffsets, targetMask);
      }
    }

    // 2. 物理转向与下半身步态求值 (BodyTurn update)
    if (ctx.enableBodyTurn) {
      // 使用角色世界坐标基准（vrm.scene.position），避免采样随 Gaze 偏转的 headNode 引起步态与头部的交叉耦合震荡
      this._btPos.copy(vrm.scene.position);
      const dx = camera.position.x - this._btPos.x;
      const dz = camera.position.z - this._btPos.z;
      const isVrm0 = vrm.meta?.metaVersion === '0';
      const baseYaw = isVrm0 ? Math.PI : 0;
      const currentFacingYaw = vrm.scene.rotation.y - baseYaw;
      const targetYaw = Math.atan2(dx, dz) - currentFacingYaw;
      const normYaw = Math.atan2(Math.sin(targetYaw), Math.cos(targetYaw));
      vrm.scene.rotation.y += this.bodyTurn.update(delta, normYaw, true);
      this.bodyTurn.copyToLowerBodyBuffer(this.locomotionPose);
    }

    const isStepping = ctx.enableBodyTurn && this.bodyTurn.isStepping();

    // 步态层连续解剖学混合权重计算：
    // 进入踱步响应迅速 (~0.18s)，避免启动迟滞；
    // 退出踱步平滑释放 (~0.85s)，从落脚平稳从容地融入 EMAGE / 待机动作，抹平单帧顿挫与身体折回感
    const targetLocomotionWeight = isStepping ? 1.0 : 0.0;
    const blendRate = isStepping ? 10.0 : 6.0;
    this.locomotionWeight = THREE.MathUtils.damp(this.locomotionWeight, targetLocomotionWeight, blendRate, delta);
    if (Math.abs(this.locomotionWeight - targetLocomotionWeight) < 0.0005) {
      this.locomotionWeight = targetLocomotionWeight;
    }

    // 3. Idle into PoseBuffer only (never a VRM writer while another source is live)
    this.idle.sampleInto(this.basePose, time, 1.0, isStepping ? 1.0 : this.locomotionWeight);
    this.basePose.sceneY = vrm.scene.position.y;

    // 4. Layer-1 action
    if (writer === 'clip') {
      const { isFadingOut, justEnded } = this.universalMotion.update(delta);
      this.actionPose.sampleFromVRM(vrm);
      this.waitingForActionSample = false;
      this.sampledThisFrame = true;
      if (isFadingOut && !this.isCrossfading) {
        this.setMotionSource('idle', this.crossfadeDuration, lookAtOffsets);
      } else if (justEnded && this.activeSource === 'motion') {
        this.setMotionSource('idle', SOURCE_FADE_DURATION, lookAtOffsets);
      }
    } else {
      if (this.universalMotion.isActive()) this.universalMotion.update(delta);
      if (writer === 'emage') {
        const wrote = this.emage.update(delta);
        if (wrote) {
          this.emage.copyToPoseBuffer(this.actionPose, 'all');
          this.waitingForActionSample = false;
          if (this.vrma.isPlaying()) this.vrma.stop();
        } else if (this.activeSource === 'idle') {
          this.actionPose.copyFrom(this.basePose);
        }
        this.sampledThisFrame = true;
      } else if (writer === 'vrma') {
        this.vrma.update(delta);
        this.actionPose.sampleFromVRM(vrm);
        this.waitingForActionSample = false;
        this.sampledThisFrame = true;
      } else {
        if (this.activeSource === 'idle') {
          this.actionPose.copyFrom(this.basePose);
        }
        this.sampledThisFrame = true;
      }
    }

    this.blendConstraintsAndCommit(vrm, delta, writer, {
      time,
      camera,
      traits,
      isSpeaking: ctx.isSpeaking,
      manualExpression: ctx.manualExpression,
      isStepping,
    });
  }

  /**
   * Quintic layers → draft commit → FootIK + Gaze → composeLayeredSmooth → commit.
   */
  private blendConstraintsAndCommit(
    vrm: VRM,
    delta: number,
    writer: LiveMotionWriter,
    ctx: {
      time: number;
      camera: THREE.Camera;
      traits: MotionTraits;
      isSpeaking: boolean;
      manualExpression: string | null;
      isStepping: boolean;
    },
  ): void {
    if (!this.sampledThisFrame) return;

    let t = 1.0;
    if (this.isCrossfading) {
      if (this.waitingForActionSample) {
        t = 0;
      } else {
        this.crossfadeElapsed += delta;
        const alpha = Math.min(1.0, this.crossfadeElapsed / this.crossfadeDuration);
        t = alpha * alpha * alpha * (alpha * (alpha * 6 - 15) + 10);
        if (alpha >= 1.0) {
          this.isCrossfading = false;
        }
      }
    }
    this.currentTransitionT = t;

    this.basePose.clampTorsoPitch(this.restPose);
    this.actionPose.clampTorsoPitch(this.restPose);

    const targetUpper = (this.activeSource === 'idle') ? this.basePose : this.actionPose;
    const targetLowerBase = (this.activeSource === 'idle' || this.activeMask === 'upperBody')
      ? this.basePose
      : this.actionPose;

    if (this.isCrossfading) {
      this.upperPose.copyFrom(this.transitionFromPose).slerp(targetUpper, t);
      this.lowerPose.copyFrom(this.transitionFromPose).slerp(targetLowerBase, t);
    } else {
      this.upperPose.copyFrom(targetUpper);
      this.lowerPose.copyFrom(targetLowerBase);
    }

    if (this.locomotionWeight > 0.0001) {
      const w = this.locomotionWeight;
      const smoothW = w * w * w * (w * (w * 6 - 15) + 10);
      this.lowerPose.blendMasked(this.locomotionPose, smoothW, LEGS_MASK);
      this.lowerPose.hipsPosition.lerp(this.locomotionPose.hipsPosition, smoothW);
    }

    this.draftPose.composeLayered(this.lowerPose, this.upperPose);
    this.draftPose.sceneY = vrm.scene.position.y;
    this.draftPose.commitToVRM(vrm);

    const grounding = this.bodyTurn.getFootGroundedAlpha();
    const wantFootIk = this.footIK.enabled && writer === 'emage' && this.emage.enableFootIK;
    this.footIkMix = THREE.MathUtils.damp(this.footIkMix, wantFootIk ? 1 : 0, 6, delta);
    if (this.footIkMix < 0.002) this.footIkMix = 0;
    this.footIK.weight = this.footIkMix;
    if (this.footIkMix > 0) {
      this.footIK.solve(delta, grounding.left, grounding.right, 1.0);
      this.footIK.levelFeet(
        vrm,
        ctx.isStepping || this.locomotionWeight > 0.05,
        grounding.left,
        grounding.right,
      );
      if (this.bodyTurnIsStepping && !ctx.isStepping) {
        this.footIK.anchorToCurrentFeet();
      }
    }
    this.bodyTurnIsStepping = ctx.isStepping;

    this.gaze.update(
      vrm,
      delta,
      ctx.time,
      ctx.camera,
      ctx.traits,
      ctx.isSpeaking,
      ctx.manualExpression,
    );

    this.lowerPose.sampleFromVRM(vrm);
    this.upperPose.sampleFromVRM(vrm);

    this.finalPose.composeLayeredSmooth(this.lowerPose, this.upperPose, delta);
    this.finalPose.sceneY = vrm.scene.position.y;
    this.finalPose.commitToVRM(vrm);
  }
}
