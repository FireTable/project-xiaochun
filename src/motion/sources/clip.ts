import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMAnimationLoaderPlugin, createVRMAnimationClip } from '@pixiv/three-vrm-animation';
import type { VRM, VRMHumanBoneName } from '@pixiv/three-vrm';
import { retargetClip, makeClipSeamless } from '../vrmaRetarget';
import { PIPELINE_BONES, BONE_INDEX_MAP, type MotionBoneMask } from '../pipeline/poseBuffer';
import { DEFAULT_MOTION_TRAITS, type MotionTraits } from '../pipeline/types';
import { motionAssetManager } from '../pipeline/motionAssetManager';
import { expressionController } from '../../core/morph/expressionController';

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
   * 是否启用 AI 粗糙动作防穿模限幅（默认 false）。
   * 标准动捕 VRMA 默认保持原生真实度（无 60° 强行截断），避免出现 A-Pose/翅膀悬空畸变。
   */
  antiClip?: boolean;
  clampTorsoPitch?: boolean;
  /**
   * 是否将骨盆（Hips）水平移动锁定在原点（默认 false）。
   * 默认保持动捕原生的重心与骨盆位移（如前倾、后坐、重心偏移），保证双脚稳固原地不滑步。
   * 仅在特定需要原地跑步或漫游动画时可显式开启。
   */
  lockHipsXZ?: boolean;
  /**
   * 动作截取时间区间 [startTime, endTime]（秒）。
   * 用于掐掉动捕原始素材首尾的 T-Pose / A-Pose 标定帧。
   */
  timeRange?: [number, number];
  /**
   * 是否启用双足接地与足底放平约束（默认 false；站姿待机/倾听建议开启）。
   * 由 FootIKSolver 连续平滑解算接地与放平，杜绝骨盆瞬降造成的裙摆物理甩动。
   */
  enableFootIK?: boolean;
  /**
   * 是否禁用眼球与头颈视线注视追踪（默认 false）。
   * 适用于提溜悬空、倒置翻滚等剧烈动作，彻底杜绝逆向欧拉角/四元数极点自旋翻转。
   */
  disableGaze?: boolean;
  /** 内部冷启动迎客动作标识，不触发取消冷启动定时器 */
  isColdStartGreeting?: boolean;

  // ── 动作原生面部表情支持 ──
  /**
   * 动作绑定的面部表情名
   * 可选值: 'gentle_smile' | 'happy' | 'angry' | 'sad' | 'sad_longing' | 'relaxed' | 'surprised' | 'shy' | 'playful' | 'hesitant' | 'neutral'
   */
  expression?: string;
  /** 表情强度 (0.0 ~ 1.0，可选；默认采用 0.8 并由 ExpressionController 精准安全限幅) */
  expressionIntensity?: number;
  /** 可选：特定表情维持时间（秒）。若未指定，默认与动作本身时长和生命周期完全对齐 */
  expressionDuration?: number;
}

export interface UniversalMotionHandle {
  readonly name: string;
  readonly duration: number;
  stop: (fadeDuration?: number) => void;
  pause: () => void;
  resume: () => void;
  setTimeScale: (scale: number) => void;
  isPlaying: () => boolean;
  isPaused: () => boolean;
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
  /** 异步播放世代令牌，用于杜绝快速连续点击切换时的乱序抢占竞态 */
  private currentPlayRequestId = 0;
  /** Remember string URL inputs for outfit-swap restore. */
  private lastUrl: string | null = null;
  private lastBuffer: ArrayBuffer | null = null;
  /** 当前正在播放的 Clip 实际驱动的人体骨骼索引集合 (0~51) */
  private animatedBoneIndices: Set<number> | null = null;
  /** 当前 Clip 是否包含 Hips 根骨骼位移轨道 */
  private hasHipsPosTrack = false;
  /** 节点名至标准 VRM 人形骨骼名的反向映射表缓存 */
  private nodeToBoneMap: Map<string, VRMHumanBoneName> | null = null;
  /** 动作绑定表情的倒计时（秒），用于在指定 duration 后提前平滑归于 neutral */
  private expressionRemainingTimer = 0;

  nextRequestId(): number {
    return ++this.currentPlayRequestId;
  }

  getCurrentRequestId(): number {
    return this.currentPlayRequestId;
  }

  getAnimatedBoneIndices(): Set<number> | null {
    return this.animatedBoneIndices;
  }

  hasHipsPositionTrack(): boolean {
    return this.hasHipsPosTrack;
  }

  bind(vrm: VRM): void {
    if (this.vrm === vrm && this.mixer) return;
    this.vrm = vrm;
    this.mixer = new THREE.AnimationMixer(vrm.scene);
    this.currentAction = null;
    this.active = false;
    this.nodeToBoneMap = null;
    this.animatedBoneIndices = null;
    this.hasHipsPosTrack = false;
    this.expressionRemainingTimer = 0;
  }

  private buildNodeToBoneMap(): Map<string, VRMHumanBoneName> {
    const map = new Map<string, VRMHumanBoneName>();
    if (!this.vrm?.humanoid) return map;
    for (const name of PIPELINE_BONES) {
      const normNode = this.vrm.humanoid.getNormalizedBoneNode(name);
      if (normNode) map.set(normNode.name, name);
      const rawNode = this.vrm.humanoid.getRawBoneNode?.(name);
      if (rawNode) map.set(rawNode.name, name);
      map.set(name, name);
      map.set(`normalized_${name}`, name);
    }
    return map;
  }

  /**
   * 姿态保护闭包：执行销毁/停止动画动作操作前后，完整快照并还原全部 52 根人形骨骼与 Hips 位置，
   * 杜绝 Three.js stopAllAction / Action.stop 触发内部 restoreOriginalState 造成的骨骼 T-Pose 闪烁与跳帧。
   */
  private preserveHumanoidPose(fn: () => void): void {
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

    fn();

    for (const item of boneTransforms) {
      item.node.quaternion.copy(item.q);
      if (item.p) item.node.position.copy(item.p);
    }
  }

  /**
   * 将任意输入解析为适配合法人形模型的 AnimationClip
   */
  async parseToClip(
    input: string | ArrayBuffer | THREE.AnimationClip,
    vrm: VRM,
    options?: PlayMotionOptions,
  ): Promise<THREE.AnimationClip> {
    const antiClip = options?.antiClip ?? false;
    if (typeof input === 'string') {
      const cachedClip = motionAssetManager.getClip(input);
      if (cachedClip) {
        this.lastUrl = input;
        return cachedClip;
      }
    }

    if (input instanceof THREE.AnimationClip) {
      let clip = input;
      if (options?.timeRange) {
        const [startSec, endSec] = options.timeRange;
        const fps = 30;
        const startFrame = Math.round(startSec * fps);
        const endFrame = Math.round(endSec * fps);
        clip = THREE.AnimationUtils.subclip(clip, clip.name || 'subclip', startFrame, endFrame, fps);
      }
      return retargetClip(clip, vrm, { antiClip });
    }

    let buffer: ArrayBuffer;
    if (typeof input === 'string') {
      this.lastUrl = input;
      buffer = await motionAssetManager.fetchBuffer(input);
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

    // 如果指定了时间截取区间，掐掉头尾无用/标定帧（如 T-pose/A-pose）
    if (options?.timeRange) {
      const [startSec, endSec] = options.timeRange;
      const fps = 30;
      const startFrame = Math.round(startSec * fps);
      const endFrame = Math.round(endSec * fps);
      clip = THREE.AnimationUtils.subclip(clip, clip.name || 'subclip', startFrame, endFrame, fps);
    }

    // 校准 Hips 根骨骼位移轨道
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

        // 1. 若显式开启 lockHipsXZ，扣除水平位移保持原地；
        const fixXZ = !!options?.lockHipsXZ;
        // 2. 垂直高度保护：若动作起始帧 Y 偏离模型 restY 超过阈值 (如 AI 生成动捕在 Y=2.10m 烘焙导致空中漂浮)，
        //    自动将起始帧基准高度平移校准至 restY，同时 100% 完整保留起跳/下蹲等相对运动幅度！
        const fixY = Math.abs(offY) > 0.25;

        if (fixXZ || fixY) {
          for (let i = 0; i < t.values.length; i += 3) {
            if (fixXZ) {
              t.values[i]     -= offX;
              t.values[i + 2] -= offZ;
            }
            if (fixY) {
              t.values[i + 1] -= offY;
            }
          }
        }
      });
    }

    const finalClip = retargetClip(clip, vrm, { antiClip });
    if (options?.loop) {
      makeClipSeamless(finalClip, options.fadeDuration);
    }
    if (typeof input === 'string') {
      motionAssetManager.setClip(input, finalClip);
    }
    return finalClip;
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
    this.traits = {
      ...DEFAULT_MOTION_TRAITS,
      ...(options.disableGaze !== undefined ? { disableGaze: options.disableGaze } : {}),
    };
    const isLoop = !!options.loop;
    if (isLoop) {
      makeClipSeamless(clip, options.fadeDuration);
    }
    const timeScale = options.timeScale ?? 1.0;
    this.fadeDuration = Math.max(0.26, options.fadeDuration ?? 0.75);
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
      const prevAction = this.currentAction;
      this.preserveHumanoidPose(() => {
        prevAction.stop();
      });
    }

    // 分析当前 Clip 实际驱动的人体骨骼集合，杜绝未覆盖骨骼继承上一动作的残留姿态 (防动作串连)
    if (!this.nodeToBoneMap || this.nodeToBoneMap.size === 0) {
      this.nodeToBoneMap = this.buildNodeToBoneMap();
    }
    const animatedIndices = new Set<number>();
    let hasHipsPos = false;
    for (const track of clip.tracks) {
      const dotIdx = track.name.indexOf('.');
      const nodeName = dotIdx !== -1 ? track.name.substring(0, dotIdx) : track.name;
      const boneName = this.nodeToBoneMap.get(nodeName);
      if (boneName) {
        const idx = BONE_INDEX_MAP.get(boneName);
        if (idx !== undefined) animatedIndices.add(idx);
        if (boneName === 'hips' && track.name.endsWith('.position')) {
          hasHipsPos = true;
        }
      }
    }
    this.animatedBoneIndices = animatedIndices;
    this.hasHipsPosTrack = hasHipsPos;

    // 动作原生表情绑定与生命周期接管
    const expr = options.expression;
    if (expr && expr !== 'neutral') {
      expressionController.setExpression(expr, options.expressionIntensity);
      this.expressionRemainingTimer = (options.expressionDuration && options.expressionDuration > 0)
        ? options.expressionDuration
        : 0;
    } else {
      // 若当前动作未指定表情或显式指定 neutral，平滑阻尼淡出回基态素颜，杜绝上一动作表情残留
      expressionController.setExpression('neutral');
      this.expressionRemainingTimer = 0;
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
      setTimeScale: (scale: number) => this.setTimeScale(scale),
      isPlaying: () => this.isPlaying(),
      isPaused: () => this.isPaused(),
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

    // 强制刷新 PropertyMixer 缓存脏检测：
    // Three.js PropertyMixer 在连续两帧采样值完全相同时会跳过 binding.setValue()。
    // 这会导致处于尾部静止帧（Tail Hold）的骨骼未被覆写，残留上一帧带有 Gaze LookAt 的四元数，
    // 形成每帧乘以 LookAt 的正反馈恶性循环（如 360° 自旋）以及动作间姿态串联污染。
    const bindings = (this.currentAction as any)?._propertyBindings;
    if (bindings) {
      for (let i = 0; i < bindings.length; i++) {
        const pb = bindings[i];
        if (pb?.buffer && pb.valueSize !== undefined) {
          pb.buffer[pb.valueSize] = NaN;
        }
      }
    }

    this.mixer.update(delta);

    const isLoop = this.currentOptions.loop ?? false;
    let justEnded = false;

    // 动作表情生命周期倒计时 (针对配置了特定表情维持时长的动作)
    if (this.expressionRemainingTimer > 0) {
      this.expressionRemainingTimer -= delta;
      if (this.expressionRemainingTimer <= 0) {
        this.expressionRemainingTimer = 0;
        expressionController.setExpression('neutral');
      }
    }

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
          expressionController.setExpression('neutral');
          this.expressionRemainingTimer = 0;
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

  isPaused(): boolean {
    return !!this.currentAction?.paused;
  }

  setTimeScale(scale: number): void {
    this.currentOptions.timeScale = scale;
    if (this.currentAction) {
      this.currentAction.setEffectiveTimeScale(scale);
    }
  }

  getTimeScale(): number {
    return this.currentOptions.timeScale ?? 1.0;
  }

  /**
   * 安全平滑停止动作播放，杜绝 Three.js stopAllAction 造成的骨骼 T-Pose 闪烁
   */
  stop(_fadeDur?: number): void {
    if (!this.active && !this.currentAction) return;

    this.preserveHumanoidPose(() => {
      this.mixer?.stopAllAction();
    });

    this.active = false;
    this.isFadingOut = false;
    this.currentAction = null;
    this.animatedBoneIndices = null;
    this.hasHipsPosTrack = false;
    this.traits = { ...DEFAULT_MOTION_TRAITS };

    expressionController.setExpression('neutral');
    this.expressionRemainingTimer = 0;

    if (!this.onEndTriggered) {
      this.onEndTriggered = true;
      this.currentOptions.onEnd?.();
    }
  }

  isLoop(): boolean {
    return Boolean(this.currentOptions.loop);
  }

  isPlaying(): boolean {
    return this.active && !this.isFadingOut && (this.currentAction?.isRunning() ?? false);
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
