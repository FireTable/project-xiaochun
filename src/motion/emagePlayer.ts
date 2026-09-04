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

function resample16k(src: Float32Array, sampleRate: number): Float32Array {
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

  // ─── 动态单腿支柱与丝滑换腿控制 ───
  stancePillar: 'left' | 'right' | 'alternate' | 'auto' = 'auto'; // 默认 auto 智能动态换腿
  currentStanceRatio = 0.0; // 0.0 = 纯左腿支撑, 1.0 = 纯右腿支撑
  private targetStanceRatio = 0.0;
  private weightShiftTimer = 0; // 长句周期换腿计时器

  // ─── Dedicated Web Worker 异步推理调度 ───
  private worker: Worker | null = null;
  private workerRequestId = 0;
  private pendingRequests = new Map<number, {
    resolve: (data?: any) => void;
    reject: (err: any) => void;
    onProgress?: (msg: string) => void;
  }>();
  private loadPromise: Promise<void> | null = null;
  private isGenerating = false;

  private vrm: VRM | null = null;
  private bones: (THREE.Object3D | null)[] = new Array(NUM_JOINTS).fill(null);
  private restQ: (THREE.Quaternion | null)[] = new Array(NUM_JOINTS).fill(null);
  private restWorldQ: (THREE.Quaternion | null)[] = new Array(NUM_JOINTS).fill(null);
  private vrmParentSmplx = new Int8Array(NUM_JOINTS).fill(-1);
  private parentRestWorldQ: (THREE.Quaternion | null)[] = new Array(NUM_JOINTS).fill(null);
  private baseY = 0;

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
  private startQ = Array.from({ length: NUM_JOINTS }, () => new THREE.Quaternion());
  public fadeInDuration = 0.60; // 从前置动作 (例如 thinking.vrma) 平滑切入的时长 (秒)

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
    // ponytail: SSR/非浏览器环境没 Worker 全局,跳过初始化(VRMEngine 在模块顶层 new,
    // TanStack Start SSR 渲染时也会跑构造函数,不能让它崩)。
    if (typeof Worker === 'undefined') return;
    try {
      this.worker = new Worker(new URL('./emageWorker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e: MessageEvent) => {
        const { id, type, message, error, rot6d, trans, frameCount, duration, fps } = e.data;
        const pending = this.pendingRequests.get(id);
        if (type === 'progress') {
          pending?.onProgress?.(message);
        } else if (type === 'ready') {
          this.ready = true;
          pending?.resolve();
          this.pendingRequests.delete(id);
        } else if (type === 'success') {
          pending?.resolve({ rot6d, trans, frameCount, duration, fps });
          this.pendingRequests.delete(id);
        } else if (type === 'error') {
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
   * 重置 Worker 内部的自回归种子 (开启全新非连贯动作时调用)
   */
  resetSeed(): void {
    if (!this.worker) return;
    const id = ++this.workerRequestId;
    this.worker.postMessage({ id, type: 'reset' });
  }

  /**
   * 异步触发后台 Worker 生成全身动作，主线程 3D 渲染彻底不卡顿！
   * @param continueFromPrevious 是否继承上一段尾部的 4 帧潜空间种子，实现跨段连贯自回归
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
        // 使用 Transferable Objects 零拷贝传输 PCM
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
  applyMotionData(data: EmageMotionData, fadeIn = 0.60): void {
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
      for (let i = 0; i < NUM_JOINTS; i++) {
        const b = this.bones[i];
        if (b) {
          this.startQ[i]!.copy(b.quaternion);
          this.currentBoneQ[i]!.copy(b.quaternion);
        } else {
          this.startQ[i]!.identity();
        }
      }
      this.currentBoneInitialized = true;
    }
  }

  play(fadeIn = 0.60): void {
    if (!this.motion || !this.vrm) return;
    this.playhead = 0;
    this.idleWeight = 0.0;
    this.cachedF0 = -1;
    this.cachedF1 = -1;
    this.fadeInDuration = fadeIn;

    for (let i = 0; i < NUM_JOINTS; i++) {
      const b = this.bones[i];
      if (b) {
        this.startQ[i]!.copy(b.quaternion);
        this.currentBoneQ[i]!.copy(b.quaternion);
      } else {
        this.startQ[i]!.identity();
      }
    }
    this.currentBoneInitialized = true;

    // 每次开始播放新动作/语音时，智能交替主承重支柱腿 (实现交谈时自然换腿)
    if (this.stancePillar === 'auto' || this.stancePillar === 'alternate') {
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
   * 动态切段 (Switch Segment)：完全不依赖时间倒计时判断，
   * 保持当前骨骼姿态，由生理角速度约束 (Max Angular Speed) 与临界阻尼在物理空间平滑自收敛
   */
  switchSegment(data: EmageMotionData): void {
    this.speakIdle.exit();
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

      // 真·四元数球形线性插值 (Slerp)
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

    // 关键修正：站立交流说话时，角色的世界地面基准高度必须绝对锁定在 baseY，绝不随动捕数据在空中上下抽动悬空！
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
            // FootIK 关闭时，使用原生 EMAGE 双腿跟随动作
            if (rest && this.legIntensity < 0.999) {
              qGoal.slerp(rest, 1.0 - this.legIntensity);
            }
          } else {
            // FootIK 开启时，执行单腿支柱与重心分配
            const lSupport = 1.0 - this.currentStanceRatio;
            const rSupport = this.currentStanceRatio;
            const legSupport = LEFT_LEG_INDICES.has(i) ? lSupport : (RIGHT_LEG_INDICES.has(i) ? rSupport : 0.5);

            if (rest) {
              // 当某腿为主支撑腿 (legSupport -> 1.0) 时，100% 保持在端正站姿 (restQ)
              // 当为主从放松腿 (legSupport -> 0.0) 时，允许极微弱的生理随动 (不超过 legIntensity * 0.35)
              const restLockFactor = THREE.MathUtils.lerp(1.0 - (this.legIntensity * 0.35), 1.0, legSupport);
              qGoal.slerp(rest, restLockFactor);
            }
          }
        }
      }

      // 生理角速度上限与惯性阻尼弹簧融合 (完全不依赖时间判断，纯物理几何与生理转动约束驱动)
      const dot = Math.abs(this.currentBoneQ[i]!.dot(qGoal));
      const clamped = Math.min(1.0, Math.max(0.0, dot));
      const angleDist = 2 * Math.acos(clamped);

      // 根据各部位生理特性约束最大自然转动角速度 (弧度/秒): 手臂手部 1.5 rad/s (~86°/s), 躯干 1.0 rad/s (~57°/s), 颈头 1.3 rad/s (~74°/s)
      let maxSpeed = 1.4;
      if (ARM_INDICES.has(i) || FINGER_INDICES.has(i)) {
        maxSpeed = 1.5;
      } else if (i === SPINE_INDEX || i === HIPS_INDEX || TORSO_INDICES.has(i)) {
        maxSpeed = 1.0;
      } else if (HEAD_INDICES.has(i)) {
        maxSpeed = 1.3;
      }

      // 单帧允许跨越的最大弧度步长
      const maxDeltaAngle = maxSpeed * Math.min(delta, 0.1);
      const velFactor = angleDist > 0.001 ? Math.min(1.0, maxDeltaAngle / angleDist) : 1.0;
      const blendFactor = this.currentBoneInitialized
        ? Math.min(followFactor, velFactor)
        : 1.0;

      this.currentBoneQ[i]!.slerp(qGoal, blendFactor);
      let finalQ = this.currentBoneQ[i]!;

      // 动作结束平滑淡出到 Idle: 仅对下半身与骨盆（LOWER_BODY_INDICES）在淡出时平滑 Slerp 回 restQ 端正立姿；
      // 双臂、手指与头部完全保持原有逻辑，绝不强拉回 T-Pose
      if (idleWeight > 0.0001 && LOWER_BODY_INDICES.has(i) && rest) {
        finalQ = this._q2.copy(finalQ).slerp(rest, idleWeight);
      }

      bone.quaternion.copy(finalQ);
    }
  }

  update(delta: number, _lookAtEnabled = false): void {
    if (!this.playing && !this.fadingOut && !this.speakIdle.isActive()) return;
    if (!this.motion || this.frameCount <= 0) return;

    // ─── 言谈间歇待机微律动 (由独立 SpeakIdleSystem 接管) ───
    if (this.speakIdle.isActive()) {
      this.speakIdle.update(delta, this.bones, this.currentBoneQ);
      if (this.enableFootIK) this.footIK.solve(delta);
      return;
    }

    // 动态换腿与生理微动节奏 (长篇连续说话时，每 8.5 秒平滑完成一次换脚)
    if (this.stancePillar === 'auto') {
      this.weightShiftTimer += delta;
      if (this.weightShiftTimer > 8.5) {
        this.weightShiftTimer = 0;
        this.targetStanceRatio = (this.targetStanceRatio >= 0.5) ? 0.0 : 1.0;
      }
    }
    // 换脚阻尼平滑，约 1.5~2.0 秒无感丝滑过渡
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
      if (t >= 0 && this.duration > 0) {
        this.playhead = Math.min(this.frameCount - 1, (t / this.duration) * this.frameCount);
        this.idleWeight = 0.0;
        this.applyFrame(this.playhead, 0.0, delta);
        if (this.enableFootIK) this.footIK.solve(delta);
        return;
      }
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
    // 如果传入大于 1，则按秒数换算比例
    const ratio = progressOrTime > 1.0 && this.duration > 0 ? progressOrTime / this.duration : progressOrTime;
    this.playhead = Math.max(0, Math.min(ratio, 1)) * (this.frameCount - 1);
    this.applyFrame(this.playhead);
  }

  stop(): void {
    this.playing = false;
    this.fadingOut = false;
    this.speakIdle.exit();
    this.clearExternalClock();
    this.resetSeed();
    if (this.audio) { this.audio.pause(); this.audio.currentTime = 0; }
    this.footIK.reset();
    this.idleWeight = 0.0;
    this.currentBoneInitialized = false;
    // 关键修正：绝不强拉或瞬移任何骨骼（包括下半身），完整保留瞬时生理姿态，
    // 交由全局 MotionTransitionManager 毫秒级捕获并在随后时间窗内平滑 Slerp 回待机
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
}
