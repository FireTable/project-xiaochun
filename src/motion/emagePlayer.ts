import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';
import type { VRMHumanBoneName } from '@pixiv/three-vrm';
import { FootIKSolver } from './footIK';
import { SpeakIdleSystem } from './speakIdle';
import { APP_CONFIG } from '@/config';

const FPS = 30;
const SR = 16000;
const NUM_JOINTS = 55;
const DIMS_PER_JOINT = 6;
const FRAME_STRIDE = NUM_JOINTS * DIMS_PER_JOINT;

const SMPLX_PARENT = [-1, 0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 9, 9, 12, 13, 14, 16, 17, 18, 19, 15, 15, 15, 20, 25, 26, 20, 28, 29, 20, 31, 32, 20, 34, 35, 20, 37, 38, 21, 40, 41, 21, 43, 44, 21, 46, 47, 21, 49, 50, 21, 52, 53];

const SMPLX_TO_VRM: (VRMHumanBoneName | null)[] = [
  'hips', 'leftUpperLeg', 'rightUpperLeg', 'spine', 'leftLowerLeg', 'rightLowerLeg', 'chest', 'leftFoot', 'rightFoot', 'upperChest', 'leftToes', 'rightToes', 'neck', 'leftShoulder', 'rightShoulder', 'head', 'leftUpperArm', 'rightUpperArm', 'leftLowerArm', 'rightLowerArm', 'leftHand', 'rightHand', 'jaw', null, null, 'leftIndexProximal', 'leftIndexIntermediate', 'leftIndexDistal', 'leftMiddleProximal', 'leftMiddleIntermediate', 'leftMiddleDistal', 'leftLittleProximal', 'leftLittleIntermediate', 'leftLittleDistal', 'leftRingProximal', 'leftRingIntermediate', 'leftRingDistal', 'leftThumbMetacarpal', 'leftThumbProximal', 'leftThumbDistal', 'rightIndexProximal', 'rightIndexIntermediate', 'rightIndexDistal', 'rightMiddleProximal', 'rightMiddleIntermediate', 'rightMiddleDistal', 'rightLittleProximal', 'rightLittleIntermediate', 'rightLittleDistal', 'rightRingProximal', 'rightRingIntermediate', 'rightRingDistal', 'rightThumbMetacarpal', 'rightThumbProximal', 'rightThumbDistal',
];

// 下半身、骨盆与腰椎关节 (SMPL-X 索引: 0=hips, 1/2=大腿, 3=spine下腰椎, 4/5=小腿, 7/8=脚, 10/11=脚趾)
const HIPS_INDEX = 0;
const SPINE_INDEX = 3;
const LEFT_LEG_INDICES = new Set([1, 4, 7, 10]);
const RIGHT_LEG_INDICES = new Set([2, 5, 8, 11]);
const LEG_INDICES = new Set([1, 2, 4, 5, 7, 8, 10, 11]);
const LOWER_BODY_INDICES = new Set([0, 1, 2, 3, 4, 5, 7, 8, 10, 11]);

// 上半身手臂关节 (SMPL-X 索引: 13/14=肩膀, 16/17=大臂, 18/19=小臂, 20/21=手腕)
const ARM_INDICES = new Set([13, 14, 16, 17, 18, 19, 20, 21]);

// 十指指关节 (SMPL-X 索引: 25~54 为左右手各15个指节)
const FINGER_INDICES = new Set(Array.from({ length: 30 }, (_, i) => 25 + i));

// 胸腔上躯干关节 (SMPL-X 索引: 6=chest, 9=upperChest)
const TORSO_INDICES = new Set([6, 9]);

// 头部/颈部关节 (SMPL-X 索引: 12=neck, 15=head)
const HEAD_INDICES = new Set([12, 15]);

export function resample16k(src: Float32Array, sampleRate: number): Float32Array {
  if (sampleRate === SR) return src;
  const ratio = sampleRate / SR;
  const n = Math.max(1, Math.floor(src.length / ratio));
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = src[Math.min(src.length - 1, Math.floor(i * ratio))]!;
  return out;
}

export async function decodeAudioToPcm(buf: ArrayBuffer): Promise<Float32Array> {
  const actx = new AudioContext({ sampleRate: SR });
  const decoded = await actx.decodeAudioData(buf.slice(0));
  const pcm = resample16k(decoded.getChannelData(0), decoded.sampleRate);
  await actx.close();
  return pcm;
}

export function pcmFromAudioBuffer(buf: AudioBuffer): Float32Array {
  return resample16k(buf.getChannelData(0), buf.sampleRate);
}

export interface EmageMotionData {
  rot6d: Float32Array;
  trans: Float32Array;
  frameCount: number;
  duration: number;
  fps: number;
}

/** Worker-reported ORT/WASM env (posted once after ensureLoaded). */
export interface EmageWasmEnv {
  numThreads: number;
  hardwareConcurrency: number;
  crossOriginIsolated: boolean;
  sharedArrayBuffer: boolean;
  simd?: boolean;
}

/** One stage_profile sample from the worker. */
export interface EmageStageProfileSample {
  stage: string;
  elapsedMs: number;
  frames?: number;
  at: number;
}

/** Screenshot-friendly perf snapshot for DevDrawer P0b. */
export interface EmagePerfSnapshot {
  wasmEnv: EmageWasmEnv | null;
  lastByStage: Record<string, number>;
  lastStageProfiles: EmageStageProfileSample[];
  ready: boolean;
  streamingMotionActive: boolean;
  awaitingAudioStart: boolean;
  preferProfileStages: boolean;
  /** Live main-thread `globalThis.crossOriginIsolated` (may differ from worker). */
  liveCrossOriginIsolated: boolean;
}

export class EmagePlayer {
  ready = false;
  loop = false;
  playAudio = false;
  holdLastFrame = false;
  lockLowerBody = false; // 默认不强制锁定下半身，释放骨盆与腰椎生理律动；由生理权重与 PitchClamping 保证挺拔立姿
  fadeDuration = 0.6; // 平滑淡出到 Idle 的过渡时长 (秒)
  public enableFootIK = true; // FootIK 功能临时开关：设为 false 完全旁路 FootIK 查看原生 EMAGE；设为 true 开启物理地锚与重心解算
  public footIK = new FootIKSolver();
  public fadingOut = false;
  private fadeElapsed = 0;

  // ─── 动作速度与频率优化控制 (权威引用自 APP_CONFIG.emage.motion) ───
  gestureIntensity = APP_CONFIG.emage.motion.gestureIntensity;
  fingerIntensity = APP_CONFIG.emage.motion.fingerIntensity;
  torsoIntensity = APP_CONFIG.emage.motion.torsoIntensity;
  spineIntensity = APP_CONFIG.emage.motion.spineIntensity;
  hipIntensity = APP_CONFIG.emage.motion.hipIntensity;
  legIntensity = APP_CONFIG.emage.motion.legIntensity;
  headIntensity = APP_CONFIG.emage.motion.headIntensity;
  dampingStiffness = APP_CONFIG.emage.motion.dampingStiffness;
  temporalSmoothRadius = APP_CONFIG.emage.motion.temporalSmoothRadius;

  // ─── 双腿支柱与重心控制 ───
  stancePillar: 'left' | 'right' | 'alternate' | 'auto' | 'balanced' = 'balanced'; // 默认 balanced 双腿对称均衡立姿，杜绝单腿左右滑移与单膝微屈
  currentStanceRatio = 0.5; // 0.5 = 双腿均衡承重
  private targetStanceRatio = 0.5;
  private weightShiftTimer = 0; // 长句周期换腿计时器

  // ─── Dedicated Web Worker 异步推理调度 ───
  private worker: Worker | null = null;
  private workerRequestId = 0;
  // ponytail: 流式会话绑定唯一 ID。从 start 到 end 严格复用，解决 Worker success 回传时找不到 pending Promise 的死锁！
  private currentStreamId: number | null = null;
  private pendingRequests = new Map<number, {
    resolve: (data?: any) => void;
    reject: (err: any) => void;
    onProgress?: (msg: string) => void;
  }>();
  private loadPromise: Promise<void> | null = null;
  private isGenerating = false;

  /** P0a: Worker 每窗 motion_chunk 追加播；为 true 时 Director 勿再 applyMotionData/switchSegment */
  streamingMotionActive = false;
  /** P0a-AV: 已缓冲 motion_chunk，但尚未随 TTS AudioContext.start 释放可见动作 */
  awaitingAudioStart = false;
  /**
   * DevDrawer: when startAudioStream opts.profileStages is omitted, use this.
   * Default false so production paths that omit the flag stay off; chatDirector
   * still passes profileStages:true explicitly on its speak path.
   */
  preferProfileStages = false;
  /** Last wasm_env from worker (null until ensureLoaded posts it). */
  lastWasmEnv: EmageWasmEnv | null = null;
  private lastStageProfiles: EmageStageProfileSample[] = [];
  private lastByStage: Record<string, number> = {};
  private static readonly STAGE_PROFILE_CAP = 12;
  /**
   * P0c: streaming playhead 追赶倍率上限（相对实时）。
   * 音频已跑、motion_chunk 晚到时，禁止一帧跳过多秒造成 yank；>1 允许轻微追赶以维持 A/V 收敛。
   */
  streamingCatchUpRate = APP_CONFIG.emage.motion.streamingCatchUpRate;
  /** P0c/P0c.1: rot6d 接缝几何缝合最大帧数（再加约 30% 帧，接缝更柔） */
  chunkSeamMaxFrames = APP_CONFIG.emage.motion.chunkSeamMaxFrames;
  /** 传给 Worker feed_audio_start；默认 true */
  emitPerWindow = true;
  /** E2: hop frames; undefined → worker EFF */
  advanceFrames: number | undefined = APP_CONFIG.emage.motion.advanceFrames;
  fadeInDuration = APP_CONFIG.emage.motion.fadeInDuration;
  switchSegmentCrossFade = APP_CONFIG.emage.motion.switchSegmentCrossFade;
  poseMicroFadeJumpDiv = APP_CONFIG.emage.motion.poseMicroFadeJumpDiv;
  poseMicroFadeMinSec = APP_CONFIG.emage.motion.poseMicroFadeMinSec;
  poseMicroFadeMaxSec = APP_CONFIG.emage.motion.poseMicroFadeMaxSec;
  poseMicroFadeJumpMin = APP_CONFIG.emage.motion.poseMicroFadeJumpMin;
  seamJumpThreshold = APP_CONFIG.emage.motion.seamJumpThreshold;
  seamJumpFramesScale = APP_CONFIG.emage.motion.seamJumpFramesScale;
  /** 首块/后续块回调（Director 用于早于 EOF 的 status('emage')） */
  onMotionChunk: ((data: EmageMotionData, isFirst: boolean) => void) | null = null;

  private vrm: VRM | null = null;
  private bones: (THREE.Object3D | null)[] = new Array(NUM_JOINTS).fill(null);
  private restQ: (THREE.Quaternion | null)[] = new Array(NUM_JOINTS).fill(null);
  private restWorldQ: (THREE.Quaternion | null)[] = new Array(NUM_JOINTS).fill(null);
  private vrmParentSmplx = new Int8Array(NUM_JOINTS).fill(-1);
  private parentRestWorldQ: (THREE.Quaternion | null)[] = new Array(NUM_JOINTS).fill(null);
  public baseY = 0;

  private motion: Float32Array | null = null;
  private frameCount = 0;
  private duration = 0; // 真实音频/动作秒数
  private fps = FPS;
  private playhead = 0;
  private playing = false;
  private idleWeight = 0.0;
  private externalClock: (() => number) | null = null;
  private audio: HTMLAudioElement | null = null;
  private audioUrl: string | null = null;
  private cachedF0 = -1;
  private cachedF1 = -1;
  private f0Q = Array.from({ length: NUM_JOINTS }, () => new THREE.Quaternion());
  private f1Q = Array.from({ length: NUM_JOINTS }, () => new THREE.Quaternion());
  private currentBoneQ = Array.from({ length: NUM_JOINTS }, () => new THREE.Quaternion());
  private currentBoneInitialized = false;

  // ─── 段落接缝平滑过渡混合器 (Cross-Segment Smooth Blending) ───
  private segmentTransitionStartQ = Array.from({ length: NUM_JOINTS }, () => new THREE.Quaternion());
  private segmentTransitionDuration = 0.0;
  private segmentTransitionElapsed = 0.0;
  private isCrossFadingSegment = false;

  // ─── 言谈间歇待机微律动模块 (SpeakIdleSystem) ───
  public speakIdle = new SpeakIdleSystem();

  /**
   * 进入言谈间歇待机 (SpeakIdle)：
   * 委托 SpeakIdleSystem 锁定当前交谈手势姿态作为基准，叠加生理级多谐波呼吸、双臂与手指微浮沉、头部灵动微视线
   */
  enterSpeakIdle(): void {
    this.speakIdle.enter(this.currentBoneQ);
  }

  exitSpeakIdle(): void {
    this.speakIdle.exit();
  }

  isSpeakIdle(): boolean {
    return this.speakIdle.isActive();
  }

  private smplxLocal = Array.from({ length: NUM_JOINTS }, () => new THREE.Quaternion());
  private smplxWorld = Array.from({ length: NUM_JOINTS }, () => new THREE.Quaternion());
  private targetQ = Array.from({ length: NUM_JOINTS }, () => new THREE.Quaternion());
  private _m4 = new THREE.Matrix4();
  private _q1 = new THREE.Quaternion();
  private _q2 = new THREE.Quaternion();
  private _deltaQ = new THREE.Quaternion();
  private _euler = new THREE.Euler(0, 0, 0, 'YXZ');
  private _invLookAt = new THREE.Quaternion();
  private startQ = Array.from({ length: NUM_JOINTS }, () => new THREE.Quaternion());

  public getLookAtOffsets: (() => { neck?: THREE.Quaternion; head?: THREE.Quaternion } | undefined) | null = null;

  /**
   * 限制关节相对 restQ 的俯仰角 (Pitch)，彻底杜绝骨盆过度前顶与腰椎过度后仰塌腰 (Hyper-lordosis)
   */
  private clampBonePitch(qGoal: THREE.Quaternion, rest: THREE.Quaternion, minPitch: number, maxPitch: number): void {
    this._deltaQ.copy(rest).invert().multiply(qGoal);
    this._euler.setFromQuaternion(this._deltaQ, 'YXZ');
    this._euler.x = THREE.MathUtils.clamp(this._euler.x, minPitch, maxPitch);
    this._deltaQ.setFromEuler(this._euler);
    qGoal.copy(rest).multiply(this._deltaQ);
  }

  constructor() {
    this.initWorker();
  }

  /**
   * 初始化 Dedicated Web Worker 并在后台静默预热，实现零等待冷启动
   */
  private initWorker(): void {
    if (this.worker) return;
    // ponytail: SSR/非浏览器环境没 Worker 全局,跳过初始化
    if (typeof Worker === 'undefined') return;
    try {
      this.worker = new Worker(new URL('./emageWorker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e: MessageEvent) => {
        const { id, type, message, error, rot6d, trans, frameCount, duration, fps, windowsProcessed, totalBufferedFrames, stage, elapsedMs, frames } = e.data;
        const pending = this.pendingRequests.get(id);
        if (type === 'progress') {
          pending?.onProgress?.(message);
        } else if (type === 'wasm_env') {
          // P0b diagnostics — no UX change; FINAL_TEST checks threads>1 when isolated.
          const env: EmageWasmEnv = {
            numThreads: Number((e.data as any).numThreads) || 1,
            hardwareConcurrency: Number((e.data as any).hardwareConcurrency) || 1,
            crossOriginIsolated: !!(e.data as any).crossOriginIsolated,
            sharedArrayBuffer: !!(e.data as any).sharedArrayBuffer,
            simd: (e.data as any).simd == null ? undefined : !!(e.data as any).simd,
          };
          this.lastWasmEnv = env;
          console.info('[EMAGE P0b wasm_env]', env);
        } else if (type === 'stage_profile') {
          const sample: EmageStageProfileSample = {
            stage: String(stage ?? ''),
            elapsedMs: Number(elapsedMs) || 0,
            frames: frames == null ? undefined : Number(frames),
            at: Date.now(),
          };
          this.lastStageProfiles.push(sample);
          if (this.lastStageProfiles.length > EmagePlayer.STAGE_PROFILE_CAP) {
            this.lastStageProfiles.splice(0, this.lastStageProfiles.length - EmagePlayer.STAGE_PROFILE_CAP);
          }
          if (sample.stage) this.lastByStage[sample.stage] = sample.elapsedMs;
          console.debug('[EMAGE profile]', stage, `${elapsedMs}ms`, frames == null ? '' : `${frames} frames`);
          pending?.onProgress?.(`[profile] ${stage}: ${elapsedMs}ms`);
        } else if (type === 'ready') {
          this.ready = true;
          pending?.resolve();
          this.pendingRequests.delete(id);
        } else if (type === 'stream_ready') {
          // ponytail: 流式会话建立完毕，唤醒 startAudioStream 调用方开始灌数据
          pending?.resolve();
          this.pendingRequests.delete(id);
        } else if (type === 'stream_progress') {
          pending?.onProgress?.(`已处理 ${windowsProcessed} 个窗口,缓冲 ${totalBufferedFrames} 帧`);
        } else if (type === 'motion_chunk') {
          // P0a: 窗级动作块 — 不走 pending Promise，直接追加播
          this.appendMotionChunk({ rot6d, trans, frameCount, duration, fps });
        } else if (type === 'checkpoint_success') {
          // 增量结算成功：当前会话继续保持 (currentStreamId 不清空，支持后续段落持续无缝自回归推演)[cite: 11]
          pending?.resolve({ rot6d, trans, frameCount, duration, fps });
          this.pendingRequests.delete(id);
        } else if (type === 'success') {
          // 关键闭环：收到最终推理结果，resolve 动作数据并清理当前流[cite: 11]
          this.currentStreamId = null;
          pending?.resolve({ rot6d, trans, frameCount, duration, fps });
          this.pendingRequests.delete(id);
        } else if (type === 'success_empty') {
          this.currentStreamId = null;
          pending?.resolve(null);
          this.pendingRequests.delete(id);
        } else if (type === 'error') {
          this.currentStreamId = null;
          pending?.reject(new Error(error || 'Worker error'));
          this.pendingRequests.delete(id);
        }
      };

      // 启动时后台静默预热模型
      this.ensureLoaded().catch((err) => console.warn('[EMAGE] Background preload notice:', err));
    } catch (err) {
      console.error('[EMAGE] Failed to initialize Web Worker:', err);
    }
  }

  setExternalClock(getter: (() => number) | null): void {
    this.externalClock = getter;
  }

  clearExternalClock(): void {
    this.externalClock = null;
  }

  getIdleWeight(): number {
    if (this.fadingOut) return this.idleWeight;
    if (!this.playing) return 1.0;
    return this.idleWeight;
  }

  isPlaying(): boolean {
    return (this.playing || this.fadingOut || this.speakIdle.isActive()) && this.motion !== null;
  }

  bind(vrm: VRM): void {
    this.vrm = vrm;
    this.bones.fill(null);
    this.restQ.fill(null);
    this.restWorldQ.fill(null);
    this.parentRestWorldQ.fill(null);
    this.vrmParentSmplx.fill(-1);
    this.baseY = vrm.scene.position.y;
    vrm.scene.updateMatrixWorld(true);
    this.footIK.bind(vrm);

    for (let i = 0; i < NUM_JOINTS; i++) {
      const name = SMPLX_TO_VRM[i];
      if (!name) continue;
      const node = vrm.humanoid.getNormalizedBoneNode(name) ?? vrm.humanoid.getRawBoneNode(name);
      if (!node) continue;
      this.bones[i] = node;
      this.restQ[i] = node.quaternion.clone();
      const restWorld = new THREE.Quaternion();
      node.getWorldQuaternion(restWorld);
      this.restWorldQ[i] = restWorld;
    }

    for (let i = 0; i < NUM_JOINTS; i++) {
      const bone = this.bones[i];
      if (!bone) continue;
      let p: THREE.Object3D | null = bone.parent;
      while (p) {
        const idx = this.bones.indexOf(p);
        if (idx >= 0) { this.vrmParentSmplx[i] = idx; break; }
        p = p.parent;
      }
      if (bone.parent) {
        const parentRest = new THREE.Quaternion();
        bone.parent.getWorldQuaternion(parentRest);
        this.parentRestWorldQ[i] = parentRest;
      }
    }
  }

  async ensureLoaded(onStatus?: (msg: string) => void): Promise<void> {
    if (this.ready) return;
    if (this.loadPromise) return this.loadPromise;
    this.initWorker();

    const id = ++this.workerRequestId;
    this.loadPromise = new Promise<void>((resolve, reject) => {
      this.pendingRequests.set(id, {
        resolve: () => {
          this.ready = true;
          resolve();
        },
        reject,
        onProgress: onStatus,
      });
      this.worker?.postMessage({ id, type: 'init' });
    }).finally(() => {
      this.loadPromise = null;
    });

    return this.loadPromise;
  }

  setAudioUrl(url: string | null): void {
    if (this.audioUrl && this.audioUrl.startsWith('blob:')) URL.revokeObjectURL(this.audioUrl);
    this.audioUrl = url;
  }

  /**
   * ponytail: 开启流式音频 → EMAGE 会话。
   * 关键修复：统一生成 currentStreamId 并固化在整个流式生命周期内。
   */
  startAudioStream(opts: {
    temporalSmoothRadius?: number;
    continueFromPrevious?: boolean;
    profileStages?: boolean;
    emitPerWindow?: boolean;
    /** E2: PCM hop frames per step (EFF..WINDOW); default EFF */
    advanceFrames?: number;
  } = {}): Promise<void> {
    return this.ensureLoaded().then(() => new Promise<void>((resolve, reject) => {
      const id = ++this.workerRequestId;
      this.currentStreamId = id;
      this.streamingMotionActive = false;
      this.awaitingAudioStart = false;
      this.emitPerWindow = opts.emitPerWindow !== false;
      if (opts.advanceFrames != null) this.advanceFrames = opts.advanceFrames;
      this.pendingRequests.set(id, { resolve, reject, onProgress: undefined });
      this.worker!.postMessage({
        id,
        type: 'feed_audio_start',
        temporalSmoothRadius: opts.temporalSmoothRadius ?? this.temporalSmoothRadius,
        continueFromPrevious: opts.continueFromPrevious,
        profileStages: opts.profileStages ?? this.preferProfileStages,
        emitPerWindow: this.emitPerWindow,
        advanceFrames: this.advanceFrames,
      });
    }));
  }

  /**
   * ponytail: 推一个 pcm 块 (Float32Array, 16kHz mono) 给 worker。
   * 用 Transferable 传 ArrayBuffer 零拷贝。必须使用 currentStreamId 确保 Worker 识别同一条会话。
   */
  pushAudioChunk(pcm: Float32Array): void {
    if (!this.worker || !this.currentStreamId) return;
    this.worker.postMessage(
      { id: this.currentStreamId, type: 'feed_audio_chunk', pcm },
      [pcm.buffer]
    );
  }

  /**
   * 增量结算当前段落切片动作：在不关闭长流、不清空特征栈的前提下局部解码[cite: 11]
   */
  async checkpointAudioStream(): Promise<EmageMotionData> {
    return new Promise((resolve, reject) => {
      if (!this.worker || !this.currentStreamId) {
        reject(new Error('No active audio stream session'));
        return;
      }
      const reqId = ++this.workerRequestId;
      this.pendingRequests.set(reqId, {
        resolve: (data: EmageMotionData) => resolve(data),
        reject: (err: any) => reject(err),
        onProgress: undefined,
      });
      this.worker.postMessage({
        id: reqId,
        type: 'feed_audio_checkpoint',
        temporalSmoothRadius: this.temporalSmoothRadius,
      });
    });
  }

  /**
   * ponytail: 标记流结束 — worker 处理尾部 + decode + 平滑 + 返回最终动作。
   * 关键修复：直接复用 currentStreamId 注册监听，解决前后 ID 脱节导致的 Promise 永远挂起！
   */
  async endAudioStream(): Promise<EmageMotionData | null> {
    return new Promise((resolve, reject) => {
      if (!this.worker || !this.currentStreamId) {
        resolve(null);
        return;
      }
      const id = this.currentStreamId;
      this.pendingRequests.set(id, {
        resolve: (data: EmageMotionData | null) => {
          this.currentStreamId = null;
          resolve(data);
        },
        reject: (err: any) => {
          this.currentStreamId = null;
          reject(err);
        },
        onProgress: undefined,
      });
      this.worker.postMessage({ id, type: 'feed_audio_end', temporalSmoothRadius: this.temporalSmoothRadius });
    });
  }

  /**
   * ponytail: 强制中断当前流式会话
   */
  abortAudioStream(): void {
    if (this.currentStreamId) {
      this.pendingRequests.delete(this.currentStreamId);
      this.currentStreamId = null;
    }
    this.streamingMotionActive = false;
    this.awaitingAudioStart = false;
    this.worker?.postMessage({ id: ++this.workerRequestId, type: 'reset' });
  }

  /**
   * 重置 Worker 内部的自回归种子 (开启全新非连贯动作时调用)
   */
  resetSeed(): void {
    if (!this.worker) return;
    const id = ++this.workerRequestId;
    this.worker.postMessage({ id, type: 'reset' });
  }

  /**
   * 异步触发后台 Worker 生成全身动作 (全量降级/直接推理调用)
   */
  async generate(
    pcm: Float32Array,
    onProgress?: (msg: string) => void,
    autoplay = true,
    continueFromPrevious = false,
  ): Promise<EmageMotionData> {
    if (this.isGenerating) {
      console.warn('[EMAGE] 模型推理正在进行中，跳过重入调用');
      throw new Error('EMAGE is currently generating');
    }
    this.isGenerating = true;
    try {
      await this.ensureLoaded(onProgress);
      this.initWorker();

      const id = ++this.workerRequestId;
      const res = await new Promise<EmageMotionData>((resolve, reject) => {
        this.pendingRequests.set(id, { resolve, reject, onProgress });
        this.worker?.postMessage(
          {
            id,
            type: 'generate',
            pcm,
            temporalSmoothRadius: this.temporalSmoothRadius,
            continueFromPrevious,
          },
          [pcm.buffer]
        );
      });

      if (autoplay) {
        this.applyMotionData(res, this.fadeInDuration);
        this.play(this.fadeInDuration);
      }
      return res;
    } finally {
      this.isGenerating = false;
    }
  }

  /**
   * 应用指定的动作切片数据，瞬时锁定当前姿态作为 Slerp 淡入起点
   */
  applyMotionData(data: EmageMotionData, fadeIn = this.fadeInDuration): void {
    this.frameCount = data.frameCount;
    this.duration = data.duration;
    this.fps = data.fps;
    this.motion = data.rot6d;
    this.playhead = 0;
    this.idleWeight = 0.0;
    this.cachedF0 = -1;
    this.cachedF1 = -1;
    this.fadeInDuration = fadeIn;

    if (this.vrm) {
      const lookAtOffsets = this.getLookAtOffsets?.();
      for (let i = 0; i < NUM_JOINTS; i++) {
        const b = this.bones[i];
        if (b) {
          this.startQ[i]!.copy(b.quaternion);
          this.currentBoneQ[i]!.copy(b.quaternion);
          if (lookAtOffsets) {
            if (i === 12 && lookAtOffsets.neck) {
              this._invLookAt.copy(lookAtOffsets.neck).invert();
              this.startQ[i]!.multiply(this._invLookAt);
              this.currentBoneQ[i]!.multiply(this._invLookAt);
            } else if (i === 15 && lookAtOffsets.head) {
              this._invLookAt.copy(lookAtOffsets.head).invert();
              this.startQ[i]!.multiply(this._invLookAt);
              this.currentBoneQ[i]!.multiply(this._invLookAt);
            }
          }
        } else {
          this.startQ[i]!.identity();
        }
      }
      this.currentBoneInitialized = true;
      if (this.enableFootIK) {
        this.footIK.snapAnchors();
      }
    }
  }

  /**
   * P0a: 追加窗级动作块。首块只缓冲 applyMotionData（不 play）；
   * 可见动作须等 Director TTS AudioContext.start → releaseMotionForAudio。
   * 后续 concat rot6d 且不重置 playhead。禁止对每窗调用 switchSegment。
   */
  appendMotionChunk(data: EmageMotionData): void {
    if (!data || data.frameCount <= 0 || !data.rot6d || data.rot6d.length === 0) return;

    const isFirst = !this.streamingMotionActive || !this.motion || this.frameCount <= 0;
    if (isFirst) {
      this.streamingMotionActive = true;
      this.awaitingAudioStart = true;
      this.applyMotionData(data, this.fadeInDuration);
      // 关键：不在此处 play() — 否则会在 TTS 可听之前自由推进 playhead
      console.log('[P0a-AV] motion_chunk buffered (awaiting audio)', {
        frameCount: data.frameCount,
        duration: data.duration,
        fps: data.fps,
      });
      this.onMotionChunk?.(data, true);
      return;
    }

    const prevFrames = this.frameCount;
    const prevRot = this.motion!;
    const merged = new Float32Array(prevRot.length + data.rot6d.length);
    merged.set(prevRot, 0);
    merged.set(data.rot6d, prevRot.length);
    this.motion = merged;
    this.frameCount += data.frameCount;
    this.duration += data.duration;
    this.fps = data.fps;
    this.cachedF0 = -1;
    this.cachedF1 = -1;
    // P0c: 几何接缝缝合（帧数由姿态跳变决定）+ 必要时从当前骨姿微 crossfade
    this.stitchMotionChunkSeam(prevFrames, data.frameCount);
    // playhead 保持不变 — 由 audio clock 驱动（update 内限速追赶）；音频未起时 playing=false
    this.onMotionChunk?.(data, false);
  }

  /**
   * P0c: 在已交付尾帧与新 chunk 首帧之间做 rot6d 几何缝合。
   * 缝合长度由接缝 L2 跳变自适应，不用固定 0.18s/0.75s 墙钟参数。
   */
  private stitchMotionChunkSeam(prevFrames: number, newFrames: number): void {
    if (!this.motion || prevFrames < 1 || newFrames < 1) return;

    const stride = FRAME_STRIDE;
    const prevOff = (prevFrames - 1) * stride;
    const new0 = prevFrames * stride;

    // 用前若干关节维度估计跳变强度（避免扫全 330 维过重）
    let acc = 0;
    const probe = Math.min(stride, 6 * 12); // hips/spine/arms 一带
    for (let d = 0; d < probe; d++) {
      const a = this.motion[prevOff + d]!;
      const b = this.motion[new0 + d]!;
      const diff = a - b;
      acc += diff * diff;
    }
    const jump = Math.sqrt(acc / probe);
    if (jump < this.seamJumpThreshold) {
      // 接缝已连续：若仍在播，仅在骨姿与目标可能脱节时点亮极短 pose crossfade
      this.armPoseSpaceMicroFade(jump);
      return;
    }

    const maxF = Math.max(3, Math.min(this.chunkSeamMaxFrames, newFrames));
    // jump~0.02 → ~3帧；jump≥0.12 → maxF（比 P0c 多约 30% 帧）
    const stitchFrames = Math.max(3, Math.min(maxF, Math.ceil(3 + (jump - this.seamJumpThreshold) / this.seamJumpFramesScale)));

    for (let f = 0; f < stitchFrames; f++) {
      const w = 1 - (f + 1) / (stitchFrames + 1); // 越靠接缝越贴近 prev 尾帧
      const off = (prevFrames + f) * stride;
      for (let d = 0; d < stride; d++) {
        const a = this.motion[prevOff + d]!;
        const b = this.motion[off + d]!;
        this.motion[off + d] = a * w + b * (1 - w);
      }
    }

    this.armPoseSpaceMicroFade(jump);
  }

  /** 用当前已写骨姿作为起点，按跳变幅度自适应微 crossfade（秒数由姿态导出，非业务常量旋钮） */
  private armPoseSpaceMicroFade(jump: number): void {
    if (!this.playing || !this.currentBoneInitialized || jump < this.poseMicroFadeJumpMin) return;
    for (let i = 0; i < NUM_JOINTS; i++) {
      this.segmentTransitionStartQ[i]!.copy(this.currentBoneQ[i]!);
    }
    // 略放慢收敛：duration = clamp(jump/1.15, 0.05, 0.36)（约 +30%）
    this.segmentTransitionDuration = Math.max(this.poseMicroFadeMinSec, Math.min(this.poseMicroFadeMaxSec, jump / this.poseMicroFadeJumpDiv));
    this.segmentTransitionElapsed = 0.0;
    this.isCrossFadingSegment = true;
  }

  /**
   * P0a-AV: TTS / AudioContext 真正 start 时调用。
   * 在 setExternalClock 之后调用，确保首帧与可听语音对齐。
   */
  releaseMotionForAudio(fadeIn = this.fadeInDuration): void {
    if (!this.motion || !this.vrm) return;
    const wasAwaiting = this.awaitingAudioStart;
    this.awaitingAudioStart = false;
    if (!this.playing) {
      this.play(fadeIn);
    }
    console.log('[P0a-AV] motion_release with audio', {
      wasAwaiting,
      frameCount: this.frameCount,
      duration: this.duration,
      playhead: this.playhead,
    });
  }

  play(fadeIn = this.fadeInDuration): void {
    if (!this.motion || !this.vrm) return;
    this.playhead = 0;
    this.idleWeight = 0.0;
    this.cachedF0 = -1;
    this.cachedF1 = -1;
    this.fadeInDuration = fadeIn;

    const lookAtOffsets = this.getLookAtOffsets?.();
    for (let i = 0; i < NUM_JOINTS; i++) {
      const b = this.bones[i];
      if (b) {
        this.startQ[i]!.copy(b.quaternion);
        this.currentBoneQ[i]!.copy(b.quaternion);
        if (lookAtOffsets) {
          if (i === 12 && lookAtOffsets.neck) {
            this._invLookAt.copy(lookAtOffsets.neck).invert();
            this.startQ[i]!.multiply(this._invLookAt);
            this.currentBoneQ[i]!.multiply(this._invLookAt);
          } else if (i === 15 && lookAtOffsets.head) {
            this._invLookAt.copy(lookAtOffsets.head).invert();
            this.startQ[i]!.multiply(this._invLookAt);
            this.currentBoneQ[i]!.multiply(this._invLookAt);
          }
        }
      } else {
        this.startQ[i]!.identity();
      }
    }
    this.currentBoneInitialized = true;
    if (this.enableFootIK) {
      this.footIK.snapAnchors();
    }

    // 支柱腿重心设置：balanced 模式下双腿对称 0.5 承重，杜绝每次起播换腿跳跃
    if (this.stancePillar === 'balanced') {
      this.targetStanceRatio = 0.5;
    } else if (this.stancePillar === 'auto' || this.stancePillar === 'alternate') {
      this.targetStanceRatio = (this.targetStanceRatio >= 0.5) ? 0.0 : 1.0;
    } else {
      this.targetStanceRatio = (this.stancePillar === 'right') ? 1.0 : 0.0;
    }
    this.weightShiftTimer = 0;

    this.playing = true;
    this.fadingOut = false;
    this.startAudio();
  }

  /**
   * 动态切段 (Switch Segment)：
   * 修复关键断层：在切段瞬间锁定当前骨骼真实停留的姿态，执行轻量级的 0.18s Slerp 阻尼混出，
   * 彻底消除动画帧离散采样与音频时钟微差导致的瞬间跳动[cite: 11]！
   */
  switchSegment(data: EmageMotionData, crossFade = this.switchSegmentCrossFade): void {
    this.speakIdle.exit();

    // 锁定切入瞬间的瞬时姿态
    for (let i = 0; i < NUM_JOINTS; i++) {
      this.segmentTransitionStartQ[i]!.copy(this.currentBoneQ[i]!);
    }
    this.segmentTransitionDuration = Math.max(0.01, crossFade);
    this.segmentTransitionElapsed = 0.0;
    this.isCrossFadingSegment = true;

    this.frameCount = data.frameCount;
    this.duration = data.duration;
    this.fps = data.fps;
    this.motion = data.rot6d;
    this.playhead = 0;
    this.idleWeight = 0.0;
    this.cachedF0 = -1;
    this.cachedF1 = -1;

    this.playing = true;
    this.fadingOut = false;
  }

  private startAudio(): void {
    if (this.audio) { this.audio.pause(); this.audio = null; }
    if (!this.audioUrl || !this.playAudio) return;
    this.audio = new Audio(this.audioUrl);
    this.audio.loop = this.loop;
    void this.audio.play().catch(() => { });
  }

  private rot6dToQuat(off: number, out: THREE.Quaternion): void {
    const d = this.motion!;
    const a1x = d[off]!, a1y = d[off + 1]!, a1z = d[off + 2]!;
    const a2x = d[off + 3]!, a2y = d[off + 4]!, a2z = d[off + 5]!;
    let len = Math.sqrt(a1x * a1x + a1y * a1y + a1z * a1z) || 1e-8;
    const b1x = a1x / len, b1y = a1y / len, b1z = a1z / len;
    const dot = b1x * a2x + b1y * a2y + b1z * a2z;
    let c2x = a2x - dot * b1x, c2y = a2y - dot * b1y, c2z = a2z - dot * b1z;
    len = Math.sqrt(c2x * c2x + c2y * c2y + c2z * c2z) || 1e-8;
    const b2x = c2x / len, b2y = c2y / len, b2z = c2z / len;
    const b3x = b1y * b2z - b1z * b2y, b3y = b1z * b2x - b1x * b2z, b3z = b1x * b2y - b1y * b2x;
    const me = this._m4.elements;
    me[0] = b1x; me[1] = b2x; me[2] = b3x; me[3] = 0;
    me[4] = b1y; me[5] = b2y; me[6] = b3y; me[7] = 0;
    me[8] = b1z; me[9] = b2z; me[10] = b3z; me[11] = 0;
    me[12] = 0; me[13] = 0; me[14] = 0; me[15] = 1;
    out.setFromRotationMatrix(this._m4);
  }

  private computeTargetQuats(frameOff: number, out: THREE.Quaternion[]): void {
    for (let i = 0; i < NUM_JOINTS; i++) {
      this.rot6dToQuat(frameOff + i * DIMS_PER_JOINT, this.smplxLocal[i]!);
      const pi = SMPLX_PARENT[i]!;
      if (pi >= 0) this.smplxWorld[i]!.copy(this.smplxWorld[pi]!).multiply(this.smplxLocal[i]!);
      else this.smplxWorld[i]!.copy(this.smplxLocal[i]!);
    }
    for (let i = 0; i < NUM_JOINTS; i++) {
      if (!this.bones[i] || !this.restWorldQ[i]) {
        out[i]!.copy(this.restQ[i] ?? this._q1.identity());
        continue;
      }
      this._q1.copy(this.smplxWorld[i]!).multiply(this.restWorldQ[i]!);
      const j = this.vrmParentSmplx[i]!;
      const pRest = this.parentRestWorldQ[i];
      if (pRest && j >= 0) this._q2.copy(this.smplxWorld[j]!).multiply(pRest);
      else if (pRest) this._q2.copy(pRest);
      else this._q2.identity();
      this._q2.invert().multiply(this._q1);
      out[i]!.copy(this._q2);
    }
  }

  private applyFrame(t: number, idleWeight = 0, delta = 0.016): void {
    if (!this.motion || !this.vrm) return;
    const f0 = Math.max(0, Math.min(Math.floor(t), this.frameCount - 1));
    const f1 = Math.min(f0 + 1, this.frameCount - 1);
    const alpha = t - f0;

    if (f0 !== f1 && alpha > 0.0001) {
      if (f0 === this.cachedF1) {
        const tmp = this.f0Q;
        this.f0Q = this.f1Q;
        this.f1Q = tmp;
        this.computeTargetQuats(f1 * FRAME_STRIDE, this.f1Q);
        this.cachedF0 = f0;
        this.cachedF1 = f1;
      } else if (f0 === this.cachedF0 && f1 === this.cachedF1) {
        // 缓存复用
      } else {
        this.computeTargetQuats(f0 * FRAME_STRIDE, this.f0Q);
        this.computeTargetQuats(f1 * FRAME_STRIDE, this.f1Q);
        this.cachedF0 = f0;
        this.cachedF1 = f1;
      }

      // 四元数球形线性插值 (Slerp)
      for (let i = 0; i < NUM_JOINTS; i++) {
        this.targetQ[i]!.copy(this.f0Q[i]!).slerp(this.f1Q[i]!, alpha);
      }
    } else {
      if (f0 !== this.cachedF0) {
        this.computeTargetQuats(f0 * FRAME_STRIDE, this.f0Q);
        this.cachedF0 = f0;
        this.cachedF1 = -1;
      }
      for (let i = 0; i < NUM_JOINTS; i++) {
        this.targetQ[i]!.copy(this.f0Q[i]!);
      }
    }

    // 处理跨切片姿态接续平滑插值 (Segment Cross-Fade)
    let crossFadeWeight = 0.0;
    if (this.isCrossFadingSegment) {
      this.segmentTransitionElapsed += delta;
      const progress = Math.min(1.0, this.segmentTransitionElapsed / this.segmentTransitionDuration);
      crossFadeWeight = 1.0 - (progress * progress * (3 - 2 * progress));
      if (progress >= 1.0) {
        this.isCrossFadingSegment = false;
      }
    }

    // 关键修正：站立交流说话时，角色的世界地面基准高度绝对锁定在 baseY
    if (this.vrm) {
      this.vrm.scene.position.y = this.baseY;
    }

    const followFactor = this.currentBoneInitialized
      ? 1.0 - Math.exp(-this.dampingStiffness * Math.min(delta, 0.1))
      : 1.0;

    for (let i = 0; i < NUM_JOINTS; i++) {
      const bone = this.bones[i];
      if (!bone) continue;
      if (this.lockLowerBody && LOWER_BODY_INDICES.has(i)) {
        if (this.restQ[i]) {
          this.currentBoneQ[i]!.copy(this.restQ[i]!);
          bone.quaternion.copy(this.restQ[i]!);
        }
        continue;
      }

      const qGoal = this._q1.copy(this.targetQ[i]!);

      // 如果正在经历切片切换，与上一段末尾姿态执行丝滑平滑收敛
      if (crossFadeWeight > 0.0001) {
        qGoal.copy(this.segmentTransitionStartQ[i]!).slerp(this.targetQ[i]!, 1.0 - crossFadeWeight);
      }

      const rest = this.restQ[i];
      if (rest) {
        if (ARM_INDICES.has(i) && this.gestureIntensity < 0.999) {
          qGoal.slerp(rest, 1.0 - this.gestureIntensity);
        } else if (FINGER_INDICES.has(i) && this.fingerIntensity < 0.999) {
          qGoal.slerp(rest, 1.0 - this.fingerIntensity);
        } else if (TORSO_INDICES.has(i) && this.torsoIntensity < 0.999) {
          qGoal.slerp(rest, 1.0 - this.torsoIntensity);
        } else if (HEAD_INDICES.has(i) && this.headIntensity < 0.999) {
          qGoal.slerp(rest, 1.0 - this.headIntensity);
        } else if (i === HIPS_INDEX) {
          qGoal.slerp(rest, 1.0 - this.hipIntensity);
          this.clampBonePitch(qGoal, rest, -0.04, 0.15);
        } else if (i === SPINE_INDEX) {
          qGoal.slerp(rest, 1.0 - this.spineIntensity);
          this.clampBonePitch(qGoal, rest, -0.05, 0.18);
        } else if (LEG_INDICES.has(i)) {
          if (!this.enableFootIK) {
            if (rest && this.legIntensity < 0.999) {
              qGoal.slerp(rest, 1.0 - this.legIntensity);
            }
          } else {
            const lSupport = 1.0 - this.currentStanceRatio;
            const rSupport = this.currentStanceRatio;
            const legSupport = LEFT_LEG_INDICES.has(i) ? lSupport : (RIGHT_LEG_INDICES.has(i) ? rSupport : 0.5);

            if (rest) {
              const restLockFactor = THREE.MathUtils.lerp(1.0 - (this.legIntensity * 0.35), 1.0, legSupport);
              qGoal.slerp(rest, restLockFactor);
            }
          }
        }
      }

      const dot = Math.abs(this.currentBoneQ[i]!.dot(qGoal));
      const clamped = Math.min(1.0, Math.max(0.0, dot));
      const angleDist = 2 * Math.acos(clamped);

      let maxSpeed = 1.4;
      if (ARM_INDICES.has(i) || FINGER_INDICES.has(i)) {
        maxSpeed = 1.5;
      } else if (i === SPINE_INDEX || i === HIPS_INDEX || TORSO_INDICES.has(i)) {
        maxSpeed = 1.0;
      } else if (HEAD_INDICES.has(i)) {
        maxSpeed = 1.3;
      }

      const maxDeltaAngle = maxSpeed * Math.min(delta, 0.1);
      const velFactor = angleDist > 0.001 ? Math.min(1.0, maxDeltaAngle / angleDist) : 1.0;
      const blendFactor = this.currentBoneInitialized
        ? Math.min(followFactor, velFactor)
        : 1.0;

      this.currentBoneQ[i]!.slerp(qGoal, blendFactor);
      let finalQ = this.currentBoneQ[i]!;

      if (idleWeight > 0.0001 && LOWER_BODY_INDICES.has(i) && rest) {
        finalQ = this._q2.copy(finalQ).slerp(rest, idleWeight);
      }

      bone.quaternion.copy(finalQ);
    }
  }

  update(delta: number, _lookAtEnabled = false): void {
    if (!this.playing && !this.fadingOut && !this.speakIdle.isActive()) return;
    if (!this.motion || this.frameCount <= 0) return;

    if (this.speakIdle.isActive()) {
      this.speakIdle.update(delta, this.bones, this.currentBoneQ);
      if (this.enableFootIK) this.footIK.solve(delta);
      return;
    }

    if (this.stancePillar === 'auto') {
      this.weightShiftTimer += delta;
      if (this.weightShiftTimer > 8.5) {
        this.weightShiftTimer = 0;
        this.targetStanceRatio = (this.targetStanceRatio >= 0.5) ? 0.0 : 1.0;
      }
    } else if (this.stancePillar === 'balanced') {
      this.targetStanceRatio = 0.5;
    }
    const shiftFilter = 1.0 - Math.exp(-2.5 * Math.max(0.001, delta));
    this.currentStanceRatio += (this.targetStanceRatio - this.currentStanceRatio) * shiftFilter;
    this.footIK.stanceRatio = this.currentStanceRatio;

    if (this.fadingOut) {
      this.fadeElapsed += delta;
      const p = Math.min(1.0, this.fadeElapsed / Math.max(0.1, this.fadeDuration));
      this.idleWeight = p * p * (3 - 2 * p);
      this.applyFrame(this.playhead, this.idleWeight, delta);
      if (this.enableFootIK) this.footIK.solve(delta);
      if (p >= 1.0) {
        this.fadingOut = false;
        this.playing = false;
        this.resetPose();
      }
      return;
    }

    if (this.externalClock) {
      const t = this.externalClock();
      if (t >= 0 && this.frameCount > 0) {
        // 绝对音频时钟 → 帧：streaming 下 duration 会随 chunk 增长，用 t*fps 更稳
        const fps = this.fps > 0 ? this.fps : FPS;
        const target = Math.min(this.frameCount - 1, Math.max(0, t * fps));
        if (this.streamingMotionActive) {
          // P0c: 禁止 underrun 解除后一帧跳过多秒（step≈0.7s+ 晚到 chunk 的典型 yank）
          const maxAdvance = Math.max(fps * Math.min(delta, 0.1) * this.streamingCatchUpRate, 0.5);
          if (target > this.playhead + maxAdvance) {
            this.playhead += maxAdvance;
          } else if (target < this.playhead - maxAdvance) {
            // 时钟回跳极少见；同样限速，避免反向抽动
            this.playhead -= maxAdvance;
          } else {
            this.playhead = target;
          }
        } else {
          this.playhead = target;
        }
        this.idleWeight = 0.0;
        this.applyFrame(this.playhead, 0.0, delta);
        if (this.enableFootIK) this.footIK.solve(delta);
        return;
      }
    }

    // P0a-AV: 流式动作在缺少 audio clock 时禁止自由跑表（避免早于 TTS）
    if (this.streamingMotionActive) {
      return;
    }

    const nextPlayhead = this.playhead + delta * this.fps;

    if (nextPlayhead >= this.frameCount) {
      if (this.loop) {
        this.playhead = nextPlayhead % this.frameCount;
        this.idleWeight = 0.0;
        this.applyFrame(this.playhead, 0.0, delta);
      } else {
        this.fadeOutToIdle(this.fadeDuration);
        return;
      }
    } else {
      this.playhead = nextPlayhead;
      this.idleWeight = 0.0;
      this.applyFrame(this.playhead, 0.0, delta);
    }

    if (this.enableFootIK) this.footIK.solve(delta);
  }

  fadeOutToIdle(duration = 0.8): void {
    this.clearExternalClock();
    if (this.audio) { this.audio.pause(); }
    this.speakIdle.exit();
    if (!this.playing && this.idleWeight >= 0.99) return;
    this.fadeDuration = Math.max(0.1, duration);
    this.fadingOut = true;
    this.fadeElapsed = 0;
  }

  freeze(): void {
    this.fadeOutToIdle(0.6);
  }

  setPaused(paused: boolean): void {
    if (paused) this.pause();
    else this.resume();
  }

  getPlayback(): { time: number; duration: number; paused: boolean } | null {
    if (!this.motion || this.frameCount <= 0) return null;
    return {
      time: this.getCurrentTime(),
      duration: this.duration > 0 ? this.duration : this.frameCount / this.fps,
      paused: !this.playing,
    };
  }

  seek(progressOrTime: number): void {
    if (!this.motion || this.frameCount <= 0) return;
    const ratio = progressOrTime > 1.0 && this.duration > 0 ? progressOrTime / this.duration : progressOrTime;
    this.playhead = Math.max(0, Math.min(ratio, 1)) * (this.frameCount - 1);
    this.applyFrame(this.playhead);
  }

  stop(): void {
    this.playing = false;
    this.fadingOut = false;
    this.isCrossFadingSegment = false;
    this.speakIdle.exit();
    this.clearExternalClock();
    this.abortAudioStream();
    // ponytail: abortAudioStream 已发 reset 消息清空 Worker 状态,无需再调 resetSeed。
    if (this.audio) { this.audio.pause(); this.audio.currentTime = 0; }
    this.footIK.softReset();
    this.idleWeight = 0.0;
    this.currentBoneInitialized = false;
  }

  pause(): void {
    this.playing = false;
    if (this.audio) this.audio.pause();
  }

  resume(): void {
    if (!this.motion) return;
    this.playing = true;
    if (this.audio) void this.audio.play().catch(() => { });
  }

  resetPose(): void {
    this.idleWeight = 0.0;
    this.footIK.reset();
    this.fadingOut = false;
    this.isCrossFadingSegment = false;
    this.currentBoneInitialized = false;
  }

  getProgress(): number {
    if (this.frameCount <= 0) return 0;
    return this.playhead / (this.frameCount - 1);
  }

  getCurrentTime(): number {
    return this.playhead / this.fps;
  }

  getDuration(): number {
    return this.duration;
  }

  getPerfSnapshot(): EmagePerfSnapshot {
    return {
      wasmEnv: this.lastWasmEnv,
      lastByStage: { ...this.lastByStage },
      lastStageProfiles: this.lastStageProfiles.slice(),
      ready: this.ready,
      streamingMotionActive: this.streamingMotionActive,
      awaitingAudioStart: this.awaitingAudioStart,
      preferProfileStages: this.preferProfileStages,
      liveCrossOriginIsolated:
        typeof globalThis !== 'undefined' && !!(globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated,
    };
  }

  clearPerfProfiles(): void {
    this.lastStageProfiles = [];
    this.lastByStage = {};
  }

  dispose(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.ready = false;
    this.loadPromise = null;
    this.isGenerating = false;
    this.pendingRequests.forEach(({ reject }) => {
      try { reject(new Error('EMAGE disposed')); } catch { }
    });
    this.pendingRequests.clear();
    this.stop();
    this.motion = null;
    if (this.audioUrl && this.audioUrl.startsWith('blob:')) {
      URL.revokeObjectURL(this.audioUrl);
      this.audioUrl = null;
    }
  }
}