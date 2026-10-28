import * as THREE from 'three';
import type { VRM, VRMHumanBoneName } from '@pixiv/three-vrm';
import {
  PoseBuffer,
  PIPELINE_BONES,
  LOWER_BODY_MASK,
  FINGER_BONES,
  BONE_INDEX_MAP,
  copyTransitionSnapshot,
  type MotionBoneMask,
} from './poseBuffer';
import {
  UniversalMotionController,
  type PlayMotionOptions,
  type UniversalMotionHandle,
} from '../sources/clip';
import { NaturalIdleSystem } from '../sources/idle';
import { ListeningMotionSystem } from '../sources/listening';
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
import { computeAdaptiveFadeDuration } from './adaptiveFade';
import { APP_CONFIG } from '../../config';
import { motionAssetManager } from './motionAssetManager';
import { MOTION_CATALOG, selectMotionFromGroup } from '../catalog';
import { makeClipSeamless } from '../vrmaRetarget';
import type { TurnState } from '../../director/chatDirector';

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
  public readonly listening = new ListeningMotionSystem();
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
  public crossfadeScale = 1.0;
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
  private footIkMix = 0;
  private footIkWanted = false;
  private locomotionWeight = 0; // 下半身步态连续混合权重 [0: 动作源下半身, 1: 步态踱步]
  private locomotionTransitionElapsed = 0;
  private locomotionTransitionDuration = 0.5;
  private locomotionTransitionFromWeight = 0;
  private locomotionTransitionTargetWeight = 0;
  private wasStepping = false;

  public targetYawOffset = 0.0;
  private boundVrm: VRM | null = null;
  public get boundVRM(): VRM | null {
    return this.boundVrm;
  }
  private _btPos = new THREE.Vector3();



  bind(vrm: VRM): void {
    if (this.boundVrm === vrm) {
      return;
    }
    this.universalMotion.bind(vrm);
    this.vrma.bind(vrm);
    motionAssetManager.invalidateBoundClips();
    this.restPose.sampleFromVRM(vrm);
    this.emage.bind(vrm);
    this.idle.bind(vrm);
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
    const reqId = this.universalMotion.nextRequestId();
    const clip = await this.universalMotion.parseToClip(input, vrm, options);
    if (reqId !== this.universalMotion.getCurrentRequestId()) {
      return {
        name: clip.name || 'UniversalMotion',
        duration: clip.duration,
        stop: () => {},
        pause: () => {},
        resume: () => {},
        setTimeScale: () => {},
        isPlaying: () => false,
        isPaused: () => false,
      };
    }

    const fadeDur = Math.max(0.26, options.fadeDuration ?? SOURCE_FADE_DURATION);
    const mask = options.mask ?? 'all';

    // 启动管线平滑流转到通用动作源 (forceTransition=true 保证连续播放动作时必触发 Quintic 补帧)
    this.setMotionSource('motion', fadeDur, lookAtOffsets, mask, true);

    // 启动底层动画动作播放
    return this.universalMotion.play(clip, options);
  }

  /**
   * 停止当前通用动作播放，平滑淡出回待机
   */
  stopMotion(
    fadeDuration = SOURCE_FADE_DURATION,
    lookAtOffsets = this.gaze.getLookAtOffsets(),
  ): void {
    if (this.activeSource !== 'idle') {
      this.setMotionSource('idle', fadeDuration, lookAtOffsets);
      this.universalMotion.stop(fadeDuration);
    }
  }

  /**
   * 同步当前角色朝向，使 targetYawOffset 与当前朝向严格一致，
   * 并复位下半身步态系统，避免手动转动角色时触发任何迈步动作。
   */
  public syncFacingYaw(vrm: VRM, camera: THREE.Camera): void {
    this._btPos.copy(vrm.scene.position);
    const dx = camera.position.x - this._btPos.x;
    const dz = camera.position.z - this._btPos.z;
    const isVrm0 = vrm.meta?.metaVersion === '0';
    const baseYaw = isVrm0 ? Math.PI : 0;
    const currentFacingYaw = vrm.scene.rotation.y - baseYaw;
    this.targetYawOffset = currentFacingYaw - Math.atan2(dx, dz);
    this.resetLocomotion();
  }

  /**
   * 将角色朝向设置为背向相机，并同步 targetYawOffset 保持下半身静止，不触发迈步
   */
  public setFacingBackwards(vrm: VRM, camera: THREE.Camera): void {
    this._btPos.copy(vrm.scene.position);
    const dx = camera.position.x - this._btPos.x;
    const dz = camera.position.z - this._btPos.z;
    const isVrm0 = vrm.meta?.metaVersion === '0';
    const baseYaw = isVrm0 ? Math.PI : 0;
    const camAngle = Math.atan2(dx, dz);
    // 身体旋转设置为背向相机 (camAngle + PI)
    vrm.scene.rotation.y = baseYaw + camAngle + Math.PI;
    // 目标偏角设为 PI，使当前差值为 0，保持静止不迈步
    this.targetYawOffset = Math.PI;
    this.resetLocomotion();
  }

  /**
   * 触发角色转身面向镜头 (激活 4-phase stepping FSM 迈步转身)
   */
  public triggerBodyTurnToFront(): void {
    this.targetYawOffset = 0;
  }

  /**
   * 复位下半身步态系统与混合权重，立即平息踏步动作
   */
  public resetLocomotion(): void {
    this.bodyTurn.reset();
    this.locomotionWeight = 0;
    this.locomotionTransitionElapsed = 0;
    this.locomotionTransitionDuration = 0.5;
    this.locomotionTransitionFromWeight = 0;
    this.locomotionTransitionTargetWeight = 0;
    this.wasStepping = false;
  }

  /** Play thinking VRMA as the live pipeline source (deprecated in favor of unified playMotion). */
  playThinkingClip(
    clip: THREE.AnimationClip,
    vrm: VRM,
    fadeDuration = SOURCE_FADE_DURATION,
    mask: 'all' | 'upperBody' = 'all',
  ): void {
    void this.playMotion(vrm, clip, {
      loop: true,
      fadeDuration,
      mask,
      antiClip: true,
    });
  }

  /** Gaze-only think sway when the thinking clip is missing. Idle remains the writer. */
  setIdleThinkSway(on: boolean): void {
    this.idle.traits.thinkSway = on;
  }

  /** Switch Layer-1 to EMAGE speech (planted stance, no think sway). */
  beginEmageSpeech(): void {
    if (this.universalMotion.isPlaying()) {
      this.universalMotion.stop(SOURCE_FADE_DURATION);
    }
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

  /**
   * 对话交互状态机统一动作响应 (SSOT TurnState -> Motion Blending)
   */
  onTurnStateChange(state: TurnState, vrm?: VRM | null): void {
    const targetVrm = vrm ?? this.boundVrm;
    switch (state) {
      case 'thinking': {
        const motionId = selectMotionFromGroup('thinking');
        const catalogItem = MOTION_CATALOG[motionId];
        const thinkingClip = motionAssetManager.getClip(motionId) ?? motionAssetManager.getClip(catalogItem.url);
        if (thinkingClip && targetVrm) {
          const fadeDur = catalogItem.fadeDuration ?? 0.65;
          const mask = (catalogItem.mask as 'all' | 'upperBody') ?? 'all';
          void this.playMotion(targetVrm, thinkingClip, { ...catalogItem, fadeDuration: fadeDur, mask });
        } else if (targetVrm) {
          this.setIdleThinkSway(true);
          void this.universalMotion.parseToClip(catalogItem.url, targetVrm, catalogItem).then((clip) => {
            makeClipSeamless(clip, catalogItem.fadeDuration);
            motionAssetManager.setClip(motionId, clip);
            motionAssetManager.setClip(catalogItem.url, clip);
            if (this.activeSource === 'idle' && this.idle.traits.thinkSway) {
              const fadeDur = catalogItem.fadeDuration ?? 0.65;
              const mask = (catalogItem.mask as 'all' | 'upperBody') ?? 'all';
              void this.playMotion(targetVrm, clip, { ...catalogItem, fadeDuration: fadeDur, mask });
            }
          }).catch((err) => {
            console.warn('[MotionPipeline] 异步预热思考动作失败:', err);
          });
        } else {
          this.setIdleThinkSway(true);
        }
        break;
      }
      case 'speaking': {
        this.beginEmageSpeech();
        break;
      }
      case 'listening': {
        const motionId = selectMotionFromGroup('listening');
        const catalogItem = MOTION_CATALOG[motionId];
        const listeningClip = motionAssetManager.getClip(motionId) ?? motionAssetManager.getClip(catalogItem.url);
        if (listeningClip && targetVrm) {
          const fadeDur = catalogItem.fadeDuration ?? 0.75;
          const mask = catalogItem.mask ?? 'all';
          void this.playMotion(targetVrm, listeningClip, { ...catalogItem, fadeDuration: fadeDur, mask });
        } else if (targetVrm) {
          void this.universalMotion.parseToClip(catalogItem.url, targetVrm, catalogItem).then((clip) => {
            makeClipSeamless(clip, catalogItem.fadeDuration);
            motionAssetManager.setClip(motionId, clip);
            motionAssetManager.setClip(catalogItem.url, clip);
            void this.playMotion(targetVrm, clip, catalogItem);
          }).catch((err) => {
            console.warn('[MotionPipeline] 异步预热倾听动作失败:', err);
          });
        }
        break;
      }
      case 'idle': {
        if (this.vrma.isPlaying()) {
          this.vrma.stop();
        }
        if (this.universalMotion.isPlaying()) {
          this.universalMotion.stop(SOURCE_FADE_DURATION);
        }
        this.resetChatMotion();
        break;
      }
    }
  }

  traitsForWriter(writer: LiveMotionWriter): MotionTraits {
    if (writer === 'emage') return this.emage.traits;
    if (writer === 'vrma') return this.vrma.traits;
    if (writer === 'clip') {
      const opts = this.universalMotion.getCurrentOptions();
      return {
        ...this.universalMotion.traits,
        ...(opts?.disableGaze !== undefined ? { disableGaze: opts.disableGaze } : {}),
      };
    }
    return this.idle.traits;
  }

  /**
   * 设置当前目标主动作源，自动启动连续平滑融合
   */
  setMotionSource(
    source: PipelineMotionSource,
    duration = SOURCE_FADE_DURATION,
    lookAtOffsets = this.gaze.getLookAtOffsets(),
    mask: MotionBoneMask = 'all',
    forceTransition = false,
  ): void {
    if (!forceTransition && source === this.activeSource && mask === this.activeMask && !this.isCrossfading) return;

    const gazeOffsets = lookAtOffsets ?? this.gaze.getLookAtOffsets();
    copyTransitionSnapshot(this.transitionFromPose, this.finalPose, gazeOffsets, true);

    // 切源时把脚锚改成上一动作的脚位（idle/think 等），EMAGE 往这对齐而不是 bind 站姿
    this.footIK.recapturePlantFromCurrent();
    this.footIK.anchorToCurrentFeet();

    this.previousSource = this.activeSource;
    this.activeSource = source;
    this.activeMask = mask;

    // ── 0.75s ± 0.25s [0.50s, 1.00s] 黄金自适应过渡时长计算 ──
    const targetPose = (source === 'idle') ? this.basePose : this.actionPose;
    const diffScore = this.transitionFromPose.distanceTo(targetPose);
    const isActionToIdle = (source === 'idle' && this.previousSource !== 'idle');
    this.crossfadeDuration = computeAdaptiveFadeDuration(diffScore, {
      crossfadeScale: this.crossfadeScale,
      isActionToIdle,
      userRequestedDuration: duration,
    });

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
    return this.activeSource === 'motion' && (this.universalMotion.isActive() || this.isCrossfading);
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
      isListening?: boolean;
      manualExpression: string | null;
    },
  ): void {
    const { delta, time, camera } = ctx;
    const lookAtOffsets = this.gaze.getLookAtOffsets();
    this.sampledThisFrame = false;

    // 1. 动态选择上层活跃动作源
    const writer = selectLiveMotionSource({
      clip: this.universalMotion.isPlaying(),
      // 宿主暂停时手势让出 (播放头不动), 走同一套切源淡化回待机; 继续时再淡回手势
      emage: this.emage.isPlaying() && !this.emage.isHostHeld(),
      vrma: this.vrma.isPlaying(),
    });
    const target = writerToPipelineSource(writer);
    const traits = this.traitsForWriter(writer);
    const targetDuration = writer === 'clip'
      ? (this.universalMotion.getCurrentOptions().fadeDuration ?? WRITER_FADE_DURATION.clip)
      : WRITER_FADE_DURATION[writer];

    const targetMask: MotionBoneMask = target === 'vrma'
      ? this.activeMask
      : (writer === 'clip' ? (this.universalMotion.getCurrentOptions().mask ?? 'all') : 'all');

    if (target !== this.activeSource || targetMask !== this.activeMask) {
      const holdEmage = this.activeSource === 'emage'
        && (this.isCrossfading || this.waitingForActionSample)
        && (target === 'idle' || target === 'vrma');
      if (!holdEmage) {
        this.setMotionSource(target, targetDuration, lookAtOffsets, targetMask);
      }
    }

    // 2. 物理转向与下半身步态求值 (BodyTurn update & Locomotion)
    // 下半身始终由 BodyTurn 系统统辖，保持标准敏捷 24° 踏步阈值，0 延迟立即响应
    const turnThreshold = APP_CONFIG.bodyTurn.turnStartThreshold;

    if (ctx.enableBodyTurn) {
      // 使用角色世界坐标基准（vrm.scene.position），避免采样随 Gaze 偏转的 headNode 引起步态与头部的交叉耦合震荡
      this._btPos.copy(vrm.scene.position);
      const dx = camera.position.x - this._btPos.x;
      const dz = camera.position.z - this._btPos.z;
      const isVrm0 = vrm.meta?.metaVersion === '0';
      const baseYaw = isVrm0 ? Math.PI : 0;
      const currentFacingYaw = vrm.scene.rotation.y - baseYaw;
      const desiredYaw = Math.atan2(dx, dz) + this.targetYawOffset;
      // 始终走最短角位移路径 ([-π, π])，杜绝多转一整圈 (360°)
      const targetYaw = THREE.MathUtils.euclideanModulo(desiredYaw - currentFacingYaw + Math.PI, Math.PI * 2) - Math.PI;
      // 保持目标方向单调一致，平滑限幅弹簧加速度上限：
      const normYaw = Math.max(-2.5, Math.min(2.5, targetYaw));

      vrm.scene.rotation.y += this.bodyTurn.update(delta, normYaw, true, turnThreshold);
      this.bodyTurn.copyToLowerBodyBuffer(this.locomotionPose);
    }

    const isStepping = ctx.enableBodyTurn && this.bodyTurn.isStepping();

    // 步态层自适应五次平滑过渡 (Adaptive Quintic Locomotion Transition)
    if (isStepping !== this.wasStepping) {
      this.wasStepping = isStepping;
      this.locomotionTransitionFromWeight = this.locomotionWeight;
      this.locomotionTransitionTargetWeight = isStepping ? 1.0 : 0.0;
      this.locomotionTransitionElapsed = 0;

      if (isStepping) {
        this.locomotionTransitionDuration = 0.22;
      } else {
        this.locomotionTransitionDuration = 0.28;
      }
    }

    if (this.locomotionWeight !== this.locomotionTransitionTargetWeight) {
      this.locomotionTransitionElapsed += delta;
      const progress = Math.min(1.0, this.locomotionTransitionElapsed / Math.max(0.001, this.locomotionTransitionDuration));
      // 五次平滑步阶曲线 (Quintic Smootherstep: 6t^5 - 15t^4 + 10t^3)，首尾速度零、加速度严格连续
      const t = progress * progress * progress * (progress * (progress * 6 - 15) + 10);
      this.locomotionWeight = THREE.MathUtils.lerp(
        this.locomotionTransitionFromWeight,
        this.locomotionTransitionTargetWeight,
        t,
      );
      if (progress >= 1.0) {
        this.locomotionWeight = this.locomotionTransitionTargetWeight;
      }
    }

    // 3. Idle into PoseBuffer only (never a VRM writer while another source is live)
    // 关键修正：从动作源平滑回归待机时，允许待机系统释放有机呼吸与肌肉放松曲线，杜绝整个人僵直机械拉拽
    // 宿主暂停: 待机层按"没在说话"跑 (呼吸 / 放松), 和说完一句回待机一样
    const speakingNow = ctx.isSpeaking && !this.emage.isHostHeld();
    const isReturningToIdle = this.activeSource === 'idle' && !speakingNow;
    const isBusyAction = speakingNow || this.activeSource !== 'idle' || (this.isCrossfading && !isReturningToIdle);
    if (this.idle.enabled) {
      const btCtx = ctx.enableBodyTurn ? {
        yawVel: this.bodyTurn.yawVel,
        isStepping,
        stepLeft: this.bodyTurn.stepLeft,
        phase: this.bodyTurn.getPhase(),
        phaseProgress: this.bodyTurn.getPhaseProgress(),
      } : undefined;

      this.idle.sampleInto(
        this.basePose,
        time,
        1.0,
        isStepping ? 1.0 : this.locomotionWeight,
        delta,
        speakingNow,
        isBusyAction,
        btCtx,
      );
      this.listening.sampleInto(
        this.basePose,
        time,
        delta,
        Boolean(ctx.isListening && !speakingNow && this.activeSource === 'idle'),
      );
    } else {
      this.basePose.copyFrom(this.restPose);
    }
    this.basePose.sceneY = vrm.scene.position.y;

    // 4. Layer-1 action
    if (writer === 'clip') {
      const { isFadingOut, justEnded } = this.universalMotion.update(delta);
      this.actionPose.sampleFromVRM(vrm);
      const animatedIndices = this.universalMotion.getAnimatedBoneIndices();
      if (animatedIndices && animatedIndices.size > 0) {
        for (let i = 0; i < PIPELINE_BONES.length; i++) {
          if (!animatedIndices.has(i)) {
            this.actionPose.quaternions[i]!.copy(this.basePose.quaternions[i]!);
          }
        }
        if (!this.universalMotion.hasHipsPositionTrack()) {
          this.actionPose.hipsPosition.copy(this.basePose.hipsPosition);
        }
      }
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
        const animatedIndices = this.vrma.getAnimatedBoneIndices();
        if (animatedIndices && animatedIndices.size > 0) {
          for (let i = 0; i < PIPELINE_BONES.length; i++) {
            if (!animatedIndices.has(i)) {
              this.actionPose.quaternions[i]!.copy(this.basePose.quaternions[i]!);
            }
          }
          if (!this.vrma.hasHipsPositionTrack()) {
            this.actionPose.hipsPosition.copy(this.basePose.hipsPosition);
          }
        }
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
      isSpeaking: speakingNow,
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

    // 通用动作剪辑 (clip)：默认保持动捕资产 100% 原生骨骼自由度，彻底消除骨盆后撅与双足浮空；
    // 仅在显式配置 clampTorsoPitch: true 时（针对粗糙 AI 动作）才执行躯干硬限幅。
    const shouldClampAction = writer !== 'clip' || Boolean(this.universalMotion.getCurrentOptions()?.clampTorsoPitch);
    if (shouldClampAction) {
      this.actionPose.clampTorsoPitch(this.restPose);
    }

    const targetUpper = (this.activeSource === 'idle') ? this.basePose : this.actionPose;
    const targetLowerBase = (this.activeSource === 'idle' || this.activeMask === 'upperBody')
      ? this.basePose
      : this.actionPose;

    if (this.isCrossfading) {
      this.upperPose.copyFrom(this.transitionFromPose).slerp(targetUpper, t);
      this.lowerPose.copyFrom(this.transitionFromPose).slerp(targetLowerBase, t);
      // 结束待机切入动作时，手指立即取目标动作的手势形态，去掉弯曲平滑与滞后过渡
      if (this.previousSource === 'idle' && this.activeSource !== 'idle') {
        for (const fingerName of FINGER_BONES) {
          const idx = BONE_INDEX_MAP.get(fingerName);
          if (idx !== undefined) {
            this.upperPose.quaternions[idx]!.copy(targetUpper.quaternions[idx]!);
          }
        }
      }
    } else {
      this.upperPose.copyFrom(targetUpper);
      this.lowerPose.copyFrom(targetLowerBase);
    }

    // 步态绝对接管：当 BodyTurn 处于迈步状态或步态权重 > 0 时，下半身直接与 locomotionPose 融合
    // 包含 LOWER_BODY_MASK 全部下肢以及 hips 骨盆旋转与位移，消除骨盆残留动作歪斜
    if (this.locomotionWeight > 0.0001) {
      this.lowerPose.blendMasked(this.locomotionPose, this.locomotionWeight, LOWER_BODY_MASK);
    }

    this.draftPose.composeLayered(this.lowerPose, this.upperPose);
    this.draftPose.sceneY = vrm.scene.position.y;
    this.draftPose.commitToVRM(vrm);

    const grounding = this.bodyTurn.getFootGroundedAlpha();
    const locomotionBusy = ctx.isStepping || this.locomotionWeight > 0.08;
    const clipWantsFootIk = writer === 'clip' && Boolean(this.universalMotion.getCurrentOptions()?.enableFootIK);
    const wantFootIk = this.footIK.enabled && (writer === 'emage' ? this.emage.enableFootIK : clipWantsFootIk) && !locomotionBusy;
    if (wantFootIk && !this.footIkWanted) {
      this.footIK.recapturePlantFromCurrent();
      this.footIK.anchorToCurrentFeet();
    }
    this.footIkWanted = wantFootIk;
    this.footIkMix = THREE.MathUtils.damp(this.footIkMix, wantFootIk ? 1 : 0, wantFootIk ? 6 : 14, delta);
    if (this.footIkMix < 0.002) this.footIkMix = 0;
    this.footIK.weight = this.footIkMix;
    if (wantFootIk && this.footIkMix > 0) {
      this.footIK.solve(delta, grounding.left, grounding.right, 1.0);
      this.footIK.levelFeet(vrm, false, grounding.left, grounding.right);
    }

    this.gaze.update(
      vrm,
      delta,
      ctx.time,
      ctx.camera,
      ctx.traits,
      ctx.isSpeaking,
      ctx.manualExpression,
      this.listening.weight,
    );

    this.lowerPose.sampleFromVRM(vrm);
    this.upperPose.sampleFromVRM(vrm);
    if (wantFootIk && this.footIkMix > 0) {
      this.footIK.writeHipsInto(this.lowerPose.hipsPosition, vrm);
    }

    const isActionActive = writer !== 'idle';
    this.finalPose.composeLayeredSmooth(this.lowerPose, this.upperPose, delta, {
      skipFingerSmooth: isActionActive,
    });
    this.finalPose.sceneY = vrm.scene.position.y;
    this.finalPose.commitToVRM(vrm);
  }
}
