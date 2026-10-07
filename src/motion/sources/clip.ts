import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMAnimationLoaderPlugin, createVRMAnimationClip } from '@pixiv/three-vrm-animation';
import type { VRM } from '@pixiv/three-vrm';
import { retargetClip } from '../vrmaRetarget';
import { PIPELINE_BONES, type MotionBoneMask } from '../pipeline/poseBuffer';
import { DEFAULT_MOTION_TRAITS, type MotionTraits } from '../pipeline/types';

export interface PlayMotionOptions {
  /** 混合过渡时间（秒），默认约 0.98s（P0c.1 +30%） */
  fadeDuration?: number;
  /** 是否循环播放，默认 false */
  loop?: boolean;
  /** 播放速度，默认 1.0 */
  timeScale?: number;
  /** 身体部位遮罩：'all' 全身，'upperBody' 仅上半身手势，'lowerBody' 仅下半身 */
  mask?: MotionBoneMask;
  /** 动作播放完毕并完成淡出后的回调 */
  onEnd?: () => void;
  /**
   * 跳过 SMPL-H 反穿模限幅。Core27 已经重定向到 VRM 归一化骨的旋转不能再被
   * 那套肩膀 12° 上限压扁。
   */
  preserveRotations?: boolean;
  /**
   * 尾帧未到齐时不要提前淡出到待机。ARDY 续写会在播放中把后续窗接上同一条剪辑。
   */
  holdAtEnd?: boolean;
  /**
   * 剪辑自己带脚和头。管线不要用 FootIK / 踱步改下半身，也不要用视线转动头颈。
   */
  preservePose?: boolean;
}

export interface UniversalMotionHandle {
  readonly name: string;
  readonly duration: number;
  stop: (fadeDuration?: number) => void;
  pause: () => void;
  resume: () => void;
  isPlaying: () => boolean;
}

/**
 * UniversalMotionController — 万能动作加载与播放控制器
 * 
 * 支持无门槛塞入任何动作输入：
 * - VRMA 文件的 URL 路径
 * - ArrayBuffer 二进制数据
 * - 标准 Three.js AnimationClip
 * 
 * 具备自动人体骨骼重定向、Hips 归一化、骨骼状态保护与生命周期回调。
 */
export class UniversalMotionController {
  public traits: MotionTraits = { ...DEFAULT_MOTION_TRAITS };
  private vrm: VRM | null = null;
  private mixer: THREE.AnimationMixer | null = null;
  private currentAction: THREE.AnimationAction | null = null;
  private hipsRest: { x: number; y: number; z: number } | null = null;

  private currentOptions: PlayMotionOptions = {};
  private active = false;
  private isFadingOut = false;
  private fadeDuration = 0.75;
  private clipDuration = 0;
  private onEndTriggered = false;
  /** While set, the tail clamps instead of crossfading back to idle. */
  private holdAtEnd = false;
  /** Authored clip: FootIK, stepping, and gaze must leave the pose alone. */
  private preservePose = false;
  private playbackListener: ((time: number, duration: number) => void) | null = null;
  /** Bumps when a new clip starts or the current one stops, so a stream can tell it lost the mixer. */
  private clipEpoch = 0;
  /** Remember string URL inputs for outfit-swap restore. */
  private lastUrl: string | null = null;
  private lastBuffer: ArrayBuffer | null = null;

  bind(vrm: VRM): void {
    this.vrm = vrm;
    this.mixer = new THREE.AnimationMixer(vrm.scene);
  }

  /**
   * 将任意输入解析为适配合法人形模型的 AnimationClip
   */
  async parseToClip(
    input: string | ArrayBuffer | THREE.AnimationClip,
    vrm: VRM,
    options: PlayMotionOptions = {},
  ): Promise<THREE.AnimationClip> {
    if (input instanceof THREE.AnimationClip) {
      return options.preserveRotations ? input : retargetClip(input, vrm);
    }

    let buffer: ArrayBuffer;
    if (typeof input === 'string') {
      this.lastUrl = input;
      const resp = await fetch(input);
      if (!resp.ok) {
        throw new Error(`[UniversalMotion] 无法加载动作文件: ${input} (HTTP ${resp.status})`);
      }
      buffer = await resp.arrayBuffer();
    } else {
      this.lastUrl = null;
      buffer = input;
    }
    this.lastBuffer = buffer;

    const loader = new GLTFLoader();
    loader.register((p) => new VRMAnimationLoaderPlugin(p));
    const gltf = await loader.parseAsync(buffer, '');
    const vrmAnim = gltf.userData.vrmAnimations?.[0];
    if (!vrmAnim) {
      throw new Error('[UniversalMotion] 传入的二进制流未包含有效的 VRMAnimation 数据');
    }

    let clip = createVRMAnimationClip(vrmAnim, vrm);

    // 纠正 Hips 初始位置偏移，防止角色位置暴冲
    const hips = vrm.humanoid?.getNormalizedBoneNode('hips');
    if (hips) {
      if (!this.hipsRest) {
        this.hipsRest = { x: hips.position.x, y: hips.position.y, z: hips.position.z };
      }
      const { x: restX, y: restY, z: restZ } = this.hipsRest;
      clip.tracks.forEach((t) => {
        if (!t.name.endsWith('.position')) return;
        const offX = t.values[0] - restX;
        const offY = t.values[1] - restY;
        const offZ = t.values[2] - restZ;
        for (let i = 0; i < t.values.length; i += 3) {
          t.values[i]     -= offX;
          t.values[i + 1] -= offY;
          t.values[i + 2] -= offZ;
        }
      });
    }

    return retargetClip(clip, vrm);
  }

  /**
   * 启动播放动作剪辑
   */
  play(clip: THREE.AnimationClip, options: PlayMotionOptions = {}): UniversalMotionHandle {
    if (!this.vrm) {
      throw new Error('[UniversalMotion] 尚未绑定 VRM 实例，请先调用 bind(vrm)');
    }

    if (!this.mixer) {
      this.mixer = new THREE.AnimationMixer(this.vrm.scene);
    }

    this.currentOptions = options;
    const isLoop = !!options.loop;
    const timeScale = options.timeScale ?? 1.0;
    this.fadeDuration = Math.max(0.26, options.fadeDuration ?? 0.75);
    this.clipDuration = clip.duration;
    this.clipEpoch += 1;
    this.playbackListener = null;
    this.holdAtEnd = options.holdAtEnd ?? false;
    this.preservePose = options.preservePose ?? false;
    this.isFadingOut = false;
    this.onEndTriggered = false;

    const action = this.mixer.clipAction(clip);
    action.reset();
    action.setLoop(isLoop ? THREE.LoopRepeat : THREE.LoopOnce, isLoop ? Infinity : 1);
    action.clampWhenFinished = true;
    action.enabled = true;
    action.setEffectiveWeight(1.0);
    action.setEffectiveTimeScale(timeScale);

    if (this.currentAction && this.currentAction !== action) {
      this.currentAction.stop();
    }

    action.play();
    this.currentAction = action;
    this.active = true;

    return {
      name: clip.name || 'UniversalMotion',
      duration: clip.duration,
      stop: (dur?: number) => this.stop(dur),
      pause: () => this.pause(),
      resume: () => this.resume(),
      isPlaying: () => this.isPlaying(),
    };
  }

  /**
   * 每帧更新时间轴，并自动检测非循环动作的尾部淡出与完成
   * @returns 当前动作是否处于即将或正在淡出的状态
   */
  update(delta: number): { isFadingOut: boolean; justEnded: boolean } {
    if (!this.active || !this.mixer || !this.currentAction) {
      return { isFadingOut: false, justEnded: false };
    }

    this.mixer.update(delta);

    const curTime = this.currentAction.time;
    this.playbackListener?.(curTime, this.clipDuration);

    const isLoop = this.currentOptions.loop ?? false;
    let justEnded = false;

    // 续写还没接上时停在末姿。提前淡出会把还在播的动作交回待机。
    if (!isLoop && !this.holdAtEnd) {
      const fadeLead = Math.min(this.fadeDuration, this.clipDuration * 0.40);

      // 动作接近尾声，提前触发管线淡出
      if (curTime >= this.clipDuration - fadeLead && !this.isFadingOut) {
        this.isFadingOut = true;
      }

      // 动作完全到达终点或被标记结束
      if (curTime >= this.clipDuration || !this.currentAction.isRunning()) {
        if (!this.onEndTriggered) {
          this.onEndTriggered = true;
          justEnded = true;
          this.active = false;
          this.currentOptions.onEnd?.();
        }
      }
    }

    return { isFadingOut: this.holdAtEnd ? false : this.isFadingOut, justEnded };
  }

  /**
   * 把正在播的剪辑换成更长的同一条动作，播放头不动。
   * stop 会把绑定骨打回绑定姿，所以先记下姿态，换上新剪辑后立刻采样回去。
   */
  extendClip(clip: THREE.AnimationClip): void {
    if (!this.holdAtEnd || !this.mixer || !this.currentAction || !this.active) {
      this.play(clip, this.currentOptions);
      return;
    }

    const preserved = this.currentAction.time;
    const bones = this.snapshotBones();
    const previousClip = this.currentAction.getClip();
    this.currentAction.stop();
    this.restoreBones(bones);
    if (previousClip) this.mixer.uncacheClip(previousClip);

    const action = this.mixer.clipAction(clip);
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    action.enabled = true;
    action.setEffectiveWeight(1);
    action.setEffectiveTimeScale(this.currentOptions.timeScale ?? 1);
    action.play();
    const duration = clip.duration;
    action.time = duration > 0 ? Math.min(preserved, Math.max(duration - 1e-4, 0)) : 0;
    action.paused = false;
    this.mixer.update(0);

    this.currentAction = action;
    this.clipDuration = duration;
    this.isFadingOut = false;
    this.onEndTriggered = false;
  }

  setHoldAtEnd(hold: boolean): void {
    this.holdAtEnd = hold;
  }

  setPlaybackListener(listener: ((time: number, duration: number) => void) | null): void {
    this.playbackListener = listener;
  }

  currentEpoch(): number {
    return this.clipEpoch;
  }

  private snapshotBones(): { node: THREE.Object3D; q: THREE.Quaternion; p?: THREE.Vector3 }[] {
    const bones: { node: THREE.Object3D; q: THREE.Quaternion; p?: THREE.Vector3 }[] = [];
    if (!this.vrm?.humanoid) return bones;
    for (const name of PIPELINE_BONES) {
      const node = this.vrm.humanoid.getNormalizedBoneNode(name);
      if (!node) continue;
      bones.push({
        node,
        q: node.quaternion.clone(),
        p: name === 'hips' ? node.position.clone() : undefined,
      });
    }
    return bones;
  }

  private restoreBones(bones: { node: THREE.Object3D; q: THREE.Quaternion; p?: THREE.Vector3 }[]): void {
    for (const item of bones) {
      item.node.quaternion.copy(item.q);
      if (item.p) item.node.position.copy(item.p);
    }
  }

  pause(): void {
    if (this.currentAction) {
      this.currentAction.paused = true;
    }
  }

  resume(): void {
    if (this.currentAction) {
      this.currentAction.paused = false;
    }
  }

  /**
   * 安全平滑停止动作播放，杜绝 Three.js stopAllAction 造成的骨骼 T-Pose 闪烁
   */
  stop(_fadeDur?: number): void {
    if (!this.active && !this.currentAction) return;

    const boneTransforms = this.snapshotBones();
    this.clipEpoch += 1;
    this.playbackListener = null;
    this.holdAtEnd = false;
    this.preservePose = false;
    this.mixer?.stopAllAction();
    this.restoreBones(boneTransforms);

    this.active = false;
    this.isFadingOut = false;
    this.currentAction = null;

    if (!this.onEndTriggered) {
      this.onEndTriggered = true;
      this.currentOptions.onEnd?.();
    }
  }

  /** ARDY and other authored clips opt out of FootIK and gaze. */
  preservesPose(): boolean {
    return this.active && this.preservePose;
  }

  isPlaying(): boolean {
    if (!this.active || this.isFadingOut) return false;
    // 末姿被夹住时 action 会暂停。续写期间仍算正在播，避免管线把写手交回待机。
    if (this.holdAtEnd) return this.currentAction !== null;
    return this.currentAction?.isRunning() ?? false;
  }

  isActive(): boolean {
    return this.active;
  }

  getCurrentOptions(): Readonly<PlayMotionOptions> {
    return this.currentOptions;
  }

  getLastUrl(): string | null {
    return this.lastUrl;
  }

  getLastBuffer(): ArrayBuffer | null {
    return this.lastBuffer;
  }

  getPlayback(): { time: number; duration: number; running: boolean } | null {
    if (!this.currentAction || !this.active) return null;
    const clip = this.currentAction.getClip();
    return {
      time: this.currentAction.time,
      duration: clip?.duration ?? this.clipDuration,
      running: this.currentAction.isRunning() && !this.currentAction.paused,
    };
  }

  seek(time: number): void {
    if (!this.currentAction) return;
    const clip = this.currentAction.getClip();
    const dur = clip?.duration ?? this.clipDuration;
    const wasPaused = this.currentAction.paused;
    this.currentAction.paused = false;
    this.currentAction.time = Math.max(0, Math.min(time, Math.max(dur - 0.001, 0)));
    this.mixer?.update(0);
    this.currentAction.paused = wasPaused;
  }
}
