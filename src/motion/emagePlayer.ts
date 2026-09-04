import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';
import type { VRMHumanBoneName } from '@pixiv/three-vrm';
import { FootIKSolver } from './footIK';

const FPS = 30;
const SR = 16000;
const NUM_JOINTS = 55;
const DIMS_PER_JOINT = 6;
const FRAME_STRIDE = NUM_JOINTS * DIMS_PER_JOINT;

const SMPLX_PARENT = [-1, 0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 9, 9, 12, 13, 14, 16, 17, 18, 19, 15, 15, 15, 20, 25, 26, 20, 28, 29, 20, 31, 32, 20, 34, 35, 20, 37, 38, 21, 40, 41, 21, 43, 44, 21, 46, 47, 21, 49, 50, 21, 52, 53];

const SMPLX_TO_VRM: (VRMHumanBoneName | null)[] = [
  'hips', 'leftUpperLeg', 'rightUpperLeg', 'spine', 'leftLowerLeg', 'rightLowerLeg', 'chest', 'leftFoot', 'rightFoot', 'upperChest', 'leftToes', 'rightToes', 'neck', 'leftShoulder', 'rightShoulder', 'head', 'leftUpperArm', 'rightUpperArm', 'leftLowerArm', 'rightLowerArm', 'leftHand', 'rightHand', 'jaw', null, null, 'leftIndexProximal', 'leftIndexIntermediate', 'leftIndexDistal', 'leftMiddleProximal', 'leftMiddleIntermediate', 'leftMiddleDistal', 'leftLittleProximal', 'leftLittleIntermediate', 'leftLittleDistal', 'leftRingProximal', 'leftRingIntermediate', 'leftRingDistal', 'leftThumbMetacarpal', 'leftThumbProximal', 'leftThumbDistal', 'rightIndexProximal', 'rightIndexIntermediate', 'rightIndexDistal', 'rightMiddleProximal', 'rightMiddleIntermediate', 'rightMiddleDistal', 'rightLittleProximal', 'rightLittleIntermediate', 'rightLittleDistal', 'rightRingProximal', 'rightRingIntermediate', 'rightRingDistal', 'rightThumbMetacarpal', 'rightThumbProximal', 'rightThumbDistal',
];

// 下半身与双腿关节 (SMPL-X 索引: 0=hips, 1/2=大腿, 4/5=小腿, 7/8=脚, 10/11=脚趾)
const LOWER_BODY_INDICES = new Set([0, 1, 2, 4, 5, 7, 8, 10, 11]);

// 上半身手臂关节 (SMPL-X 索引: 13/14=肩膀, 16/17=大臂, 18/19=小臂, 20/21=手腕)
const ARM_INDICES = new Set([13, 14, 16, 17, 18, 19, 20, 21]);

// 十指指关节 (SMPL-X 索引: 25~54 为左右手各15个指节)
const FINGER_INDICES = new Set(Array.from({ length: 30 }, (_, i) => 25 + i));

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

export class EmagePlayer {
  ready = false;
  loop = false;
  playAudio = false;
  holdLastFrame = false;
  lockLowerBody = true; // 默认锁定下半身稳妥立姿，彻底杜绝骨盆与后腰不自然过度后仰
  fadeDuration = 0.6; // 平滑淡出到 Idle 的过渡时长 (秒)
  public footIK = new FootIKSolver();
  public fadingOut = false;
  private fadeElapsed = 0;

  // ─── 动作速度与频率优化控制 ───
  gestureIntensity = 1.0;      // 手臂幅度缩放 (0.1~1.0，默认 1.0 满额手势)
  fingerIntensity = 0.35;      // 指关节活跃度 (0.1~1.0，默认 0.35，保持柔和半卷，消除乱指)
  dampingStiffness = 5.5;      // 惯性阻尼刚度 (默认 5.5，数值越小越柔顺轻盈，消除“动得太快”)
  temporalSmoothRadius = 7;    // 时序高斯平滑半径 (默认 7 帧/约0.5s，消除“切换太频繁”)

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
  private trans: Float32Array | null = null;
  private transRefY = 0;
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

  private smplxLocal = Array.from({ length: NUM_JOINTS }, () => new THREE.Quaternion());
  private smplxWorld = Array.from({ length: NUM_JOINTS }, () => new THREE.Quaternion());
  private targetQ = Array.from({ length: NUM_JOINTS }, () => new THREE.Quaternion());
  private _m4 = new THREE.Matrix4();
  private _q1 = new THREE.Quaternion();
  private _q2 = new THREE.Quaternion();
  private startQ = Array.from({ length: NUM_JOINTS }, () => new THREE.Quaternion());
  public fadeInDuration = 0.60; // 从前置动作 (例如 thinking.vrma) 平滑切入的时长 (秒)

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
    return (this.playing || this.fadingOut) && this.motion !== null;
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
   * 异步触发后台 Worker 生成全身动作，主线程 3D 渲染彻底不卡顿！
   */
  async generate(pcm: Float32Array, onProgress?: (msg: string) => void, autoplay = true): Promise<void> {
    if (this.isGenerating) {
      console.warn('[EMAGE] 模型推理正在进行中，跳过重入调用');
      return;
    }
    this.isGenerating = true;
    try {
      await this.ensureLoaded(onProgress);
      this.initWorker();

      const id = ++this.workerRequestId;
      const res = await new Promise<{
        rot6d: Float32Array;
        trans: Float32Array;
        frameCount: number;
        duration: number;
        fps: number;
      }>((resolve, reject) => {
        this.pendingRequests.set(id, { resolve, reject, onProgress });
        // 使用 Transferable Objects 零拷贝传输 PCM
        this.worker?.postMessage(
          {
            id,
            type: 'generate',
            pcm,
            temporalSmoothRadius: this.temporalSmoothRadius,
          },
          [pcm.buffer]
        );
      });

      this.frameCount = res.frameCount;
      this.duration = res.duration;
      this.fps = res.fps;
      this.motion = res.rot6d;
      this.trans = res.trans;
      this.transRefY = this.trans[1] ?? 0;
      this.playhead = 0;
      this.idleWeight = 0.0;
      this.cachedF0 = -1;
      this.cachedF1 = -1;
      this.currentBoneInitialized = false;
      if (autoplay) this.play();
    } finally {
      this.isGenerating = false;
    }
  }

  play(): void {
    if (!this.motion || !this.vrm) return;
    this.playhead = 0;
    this.idleWeight = 0.0;
    this.cachedF0 = -1;
    this.cachedF1 = -1;

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

    this.playing = true;
    this.startAudio();
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

    if (this.trans && !this.lockLowerBody) {
      const y0 = this.trans[f0 * 3 + 1]!;
      const y1 = this.trans[f1 * 3 + 1]!;
      const rawDeltaY = (y0 + (y1 - y0) * alpha) - this.transRefY;
      const deltaY = THREE.MathUtils.clamp(rawDeltaY * 0.25, -0.03, 0.03);
      const targetY = this.baseY + deltaY;
      this.vrm.scene.position.y = idleWeight > 0.001 ? THREE.MathUtils.lerp(targetY, this.baseY, idleWeight) : targetY;
    } else if (this.vrm) {
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
        }
      }

      this.currentBoneQ[i]!.slerp(qGoal, followFactor);
      let finalQ = this.currentBoneQ[i]!;

      // 动作前置平滑淡入 (Fade-In)
      const curTime = (this.playhead / this.fps);
      if (curTime < this.fadeInDuration) {
        const inAlpha = Math.min(1.0, Math.max(0.0, curTime / this.fadeInDuration));
        const smoothIn = inAlpha * inAlpha * (3 - 2 * inAlpha);
        finalQ = this._q2.copy(this.startQ[i]!).slerp(finalQ, smoothIn);
      }

      // 动作结束平滑淡出到 Idle (Fade-Out)
      if (idleWeight > 0.001) {
        finalQ = this._q2.copy(finalQ).slerp(this.restQ[i] ?? this._q1.identity(), idleWeight);
      }
      bone.quaternion.copy(finalQ);
    }
  }

  update(delta: number, _lookAtEnabled = false): void {
    if (!this.playing && !this.fadingOut) return;
    if (!this.motion || this.frameCount <= 0) return;

    if (this.fadingOut) {
      this.fadeElapsed += delta;
      const p = Math.min(1.0, this.fadeElapsed / Math.max(0.1, this.fadeDuration));
      this.idleWeight = p * p * (3 - 2 * p);
      this.applyFrame(this.playhead, this.idleWeight, delta);
      this.footIK.solve(delta);
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
        this.footIK.solve(delta);
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

    this.footIK.solve(delta);
  }

  fadeOutToIdle(duration = 0.8): void {
    this.clearExternalClock();
    if (this.audio) { this.audio.pause(); }
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
    this.clearExternalClock();
    if (this.audio) { this.audio.pause(); this.audio.currentTime = 0; }
    this.resetPose();
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
    this.idleWeight = 1.0;
    this.footIK.reset();
    for (let i = 0; i < NUM_JOINTS; i++) {
      const bone = this.bones[i];
      if (bone && this.restQ[i]) bone.quaternion.copy(this.restQ[i]!);
    }
    if (this.vrm) {
      this.vrm.scene.position.y = this.baseY;
    }
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
