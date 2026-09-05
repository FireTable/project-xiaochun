import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMAnimationLoaderPlugin, createVRMAnimationClip } from '@pixiv/three-vrm-animation';
import type { VRM } from '@pixiv/three-vrm';
import { retargetClip } from '../vrmaRetarget';
import { PIPELINE_BONES, type MotionBoneMask } from './poseBuffer';

export interface PlayMotionOptions {
  /** 混合过渡时间（秒），默认 0.75s */
  fadeDuration?: number;
  /** 是否循环播放，默认 false */
  loop?: boolean;
  /** 播放速度，默认 1.0 */
  timeScale?: number;
  /** 身体部位遮罩：'all' 全身，'upperBody' 仅上半身手势，'lowerBody' 仅下半身 */
  mask?: MotionBoneMask;
  /** 动作播放完毕并完成淡出后的回调 */
  onEnd?: () => void;
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

  bind(vrm: VRM): void {
    this.vrm = vrm;
    this.mixer = new THREE.AnimationMixer(vrm.scene);
  }

  /**
   * 将任意输入解析为适配合法人形模型的 AnimationClip
   */
  async parseToClip(input: string | ArrayBuffer | THREE.AnimationClip, vrm: VRM): Promise<THREE.AnimationClip> {
    if (input instanceof THREE.AnimationClip) {
      return retargetClip(input, vrm);
    }

    let buffer: ArrayBuffer;
    if (typeof input === 'string') {
      const resp = await fetch(input);
      if (!resp.ok) {
        throw new Error(`[UniversalMotion] 无法加载动作文件: ${input} (HTTP ${resp.status})`);
      }
      buffer = await resp.arrayBuffer();
    } else {
      buffer = input;
    }

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
    this.fadeDuration = Math.max(0.20, options.fadeDuration ?? 0.75);
    this.clipDuration = clip.duration;
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

    const isLoop = this.currentOptions.loop ?? false;
    let justEnded = false;

    if (!isLoop) {
      const curTime = this.currentAction.time;
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

    return { isFadingOut: this.isFadingOut, justEnded };
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

    // 保护当前姿态
    const boneTransforms: { node: THREE.Object3D; q: THREE.Quaternion; p?: THREE.Vector3 }[] = [];
    if (this.vrm?.humanoid) {
      for (const name of PIPELINE_BONES) {
        const node = this.vrm.humanoid.getNormalizedBoneNode(name);
        if (node) {
          boneTransforms.push({
            node,
            q: node.quaternion.clone(),
            p: name === 'hips' ? node.position.clone() : undefined,
          });
        }
      }
    }

    this.mixer?.stopAllAction();

    // 还原姿态，交由管线平滑过渡接管
    for (const item of boneTransforms) {
      item.node.quaternion.copy(item.q);
      if (item.p) item.node.position.copy(item.p);
    }

    this.active = false;
    this.isFadingOut = false;
    this.currentAction = null;

    if (!this.onEndTriggered) {
      this.onEndTriggered = true;
      this.currentOptions.onEnd?.();
    }
  }

  isPlaying(): boolean {
    return this.active && (this.currentAction?.isRunning() ?? false);
  }

  getCurrentOptions(): Readonly<PlayMotionOptions> {
    return this.currentOptions;
  }
}
