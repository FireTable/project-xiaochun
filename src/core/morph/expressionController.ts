import * as THREE from 'three';
import { VRM, VRMExpression, VRMExpressionMorphTargetBind } from '@pixiv/three-vrm';
import type { ExpressionDirective, EmotionMicroReaction } from '@/story/schema';

export interface ExpressionControllerConfig {
  /** 基础情绪过渡阻尼速度 (越大过渡越快，默认 7.5，约 0.35s 完成) */
  emotionDampSpeed: number;
  /** 呼吸微波动幅度 (±0.02) */
  breathOscillationAmp: number;
  /** 说话时唇部表情的闪避系数 (0.25 即说话时嘴角表情只保留 25%，防止嘴部撕裂) */
  speechMouthDucking: number;
}

/**
 * 动作动态表情上下文 (每帧计算并注入到 MotionExpressionFn 中，Zero-GC 循环复用对象)
 */
export interface MotionExpressionContext {
  /** 动作已播放时间 (秒) */
  elapsed: number;
  /** 动作总时长 (秒)，循环动作一般为单个周期的时长 */
  duration: number;
  /** 动作归一化播放进度 [0.0, 1.0] */
  progress: number;
  /** 当前帧时间间隔 delta (秒) */
  delta: number;
  /** 全局运行时间戳 (秒) */
  time: number;
  /** 当前被驱动的 VRM 人偶实例 */
  vrm: VRM;
  /** 当前头部实时俯仰角 Pitch (rad, >0 为低头/垂首, <0 为仰头) */
  headPitch: number;
  /** 当前头部实时偏航角 Yaw (rad, >0 为左转, <0 为右转) */
  headYaw: number;
  /** 当前头部实时翻滚角 Roll (rad) */
  headRoll: number;
  /** 当前角色是否正在发声说话 (TTS 或语音流) */
  isSpeaking: boolean;
  /** 当前自主注视系统的生理眨眼度 (0.0 ~ 1.0) */
  gazeBlink: number;
}

/**
 * 动作动态表情输出通道 (由 MotionExpressionFn 写入，直接映射至标准 VRM ExpressionManager)
 */
export interface MotionExpressionOutput {
  happy: number;
  gentle_smile: number;
  playful: number;
  angry: number;
  sad: number;
  surprised: number;
  relaxed: number;
  blink: number;
  blinkLeft: number;
  blinkRight: number;
  aa: number;
  ou: number;
  /** 快速重置所有通道为 0 (Zero-GC) */
  reset: () => void;
}

/**
 * 动作原生动态表情回调函数签名
 */
export type MotionExpressionFn = (
  ctx: MotionExpressionContext,
  out: MotionExpressionOutput,
) => void;

export const EMOTION_KEYS = [
  'neutral',
  'happy',
  'gentle_smile',
  'hesitant',
  'shy',
  'surprised',
  'sad_longing',
  'playful',
  'angry',
  'relaxed',
] as const;

export type EmotionKey = (typeof EMOTION_KEYS)[number];

export const MORPH_KEYS = [
  'happy',
  'gentle_smile',
  'playful',
  'angry',
  'sad',
  'surprised',
  'relaxed',
  'blink',
  'blinkLeft',
  'blinkRight',
  'aa',
  'ou',
] as const;

export type ExpressionMorphKey = (typeof MORPH_KEYS)[number];

export const PRESET_EMOTION_MAP = {
  neutral: 'neutral',
  happy: 'happy',
  gentle_smile: 'gentle_smile',
  smile: 'gentle_smile',
  angry: 'angry',
  sad: 'sad_longing',
  sad_longing: 'sad_longing',
  relaxed: 'relaxed',
  surprised: 'surprised',
  shy: 'shy',
  playful: 'playful',
  hesitant: 'hesitant',
} as const satisfies Record<string, EmotionKey>;

/**
 * 所有合法的表情语义名（强类型编译期约束）
 * 若在 PRESET_EMOTION_MAP 中删除或重命名某表情，
 * 任何引用了该表情的 MotionCatalogItem 都会在编译阶段（npx tsc）立即抛出类型错误！
 */
export type SupportedExpression = keyof typeof PRESET_EMOTION_MAP;

export class ExpressionController {
  private config: ExpressionControllerConfig = {
    emotionDampSpeed: 7.5,
    breathOscillationAmp: 0.015,
    speechMouthDucking: 0.25,
  };

  /** 是否处于表情接管状态 (故事剧场或 DevDrawer 手动表情)。若非激活且已平滑衰减至 neutral，放行让 Gaze 接管 */
  private isActive = false;

  // 当前实时计算权重 (0.0 ~ 1.0)
  private currentWeights: Record<EmotionKey, number> = {
    neutral: 1.0,
    happy: 0.0,
    gentle_smile: 0.0,
    hesitant: 0.0,
    shy: 0.0,
    surprised: 0.0,
    sad_longing: 0.0,
    playful: 0.0,
    angry: 0.0,
    relaxed: 0.0,
  };

  // 目标情绪与强度 (默认纯净 neutral，强度 0)
  private targetEmotion: string = 'neutral';
  private targetIntensity = 0.0;

  // 戏剧微反应事件状态
  private currentMicroReaction: EmotionMicroReaction = 'none';
  private microReactionTimer = 0;
  private blushIntensity = 0.0;
  private breathClock = 0;

  // 俏皮表情眨眼脉冲计时器 (秒)
  private playfulTimer = 0;

  // 动作原生动态表情回调与时间提取器
  private customExpressionFn: MotionExpressionFn | null = null;
  private customTimingGetter: (() => { elapsed: number; duration: number }) | null = null;

  // Zero-GC 预分配复用上下文与输出缓冲池
  private readonly exprContext: MotionExpressionContext = {
    elapsed: 0,
    duration: 1,
    progress: 0,
    delta: 0,
    time: 0,
    vrm: null as any,
    headPitch: 0,
    headYaw: 0,
    headRoll: 0,
    isSpeaking: false,
    gazeBlink: 0,
  };

  private readonly exprOutput: MotionExpressionOutput = {
    happy: 0,
    gentle_smile: 0,
    playful: 0,
    angry: 0,
    sad: 0,
    surprised: 0,
    relaxed: 0,
    blink: 0,
    blinkLeft: 0,
    blinkRight: 0,
    aa: 0,
    ou: 0,
    reset() {
      this.happy = 0;
      this.gentle_smile = 0;
      this.playful = 0;
      this.angry = 0;
      this.sad = 0;
      this.surprised = 0;
      this.relaxed = 0;
      this.blink = 0;
      this.blinkLeft = 0;
      this.blinkRight = 0;
      this.aa = 0;
      this.ou = 0;
    },
  };

  /** 实时平滑应用到 VRM 的 Morph 缓冲池 (Zero-GC, 指数阻尼滤波，杜绝 1 帧瞬切) */
  private readonly liveMorphs = {
    happy: 0,
    gentle_smile: 0,
    playful: 0,
    angry: 0,
    sad: 0,
    surprised: 0,
    relaxed: 0,
    blink: 0,
    blinkLeft: 0,
    blinkRight: 0,
    aa: 0,
    ou: 0,
  };

  /** 当前帧计算的目标 Morph 权值暂存器 (Zero-GC) */
  private readonly targetMorphs = {
    happy: 0,
    gentle_smile: 0,
    playful: 0,
    angry: 0,
    sad: 0,
    surprised: 0,
    relaxed: 0,
    blink: 0,
    blinkLeft: 0,
    blinkRight: 0,
    aa: 0,
    ou: 0,
    reset() {
      this.happy = 0;
      this.gentle_smile = 0;
      this.playful = 0;
      this.angry = 0;
      this.sad = 0;
      this.surprised = 0;
      this.relaxed = 0;
      this.blink = 0;
      this.blinkLeft = 0;
      this.blinkRight = 0;
      this.aa = 0;
      this.ou = 0;
    },
  };

  // Zero-GC 欧拉角转换暂存器
  private readonly tempEuler = new THREE.Euler(0, 0, 0, 'YXZ');

  public setActive(active: boolean): void {
    this.isActive = active;
    if (!active) {
      this.reset();
    }
  }

  public getIsActive(): boolean {
    return this.isActive;
  }

  /**
   * 外部或 DevDrawer 设置预设表情 / 情绪名
   * @param name 表情名称 (如 'neutral', 'happy', 'angry', 'sad', 'relaxed', 'surprised', 'shy', 'playful')
   * @param intensity 情绪强度 (0.0 ~ 1.0，默认 0.8)
   */
  public setExpression(name: SupportedExpression | (string & {}), intensity?: number): void {
    this.customExpressionFn = null;
    this.customTimingGetter = null;

    const raw = (name ?? 'neutral').toLowerCase().trim() as SupportedExpression;
    if (!raw || raw === 'neutral') {
      this.targetEmotion = 'neutral';
      this.targetIntensity = 0.0;
      this.currentMicroReaction = 'none';
      this.playfulTimer = 0;
      return;
    }

    const mapped: EmotionKey = PRESET_EMOTION_MAP[raw] || 'gentle_smile';
    this.isActive = true;
    this.targetEmotion = mapped;
    this.targetIntensity = Math.min(1.0, Math.max(0.1, intensity ?? 0.8));

    if (raw === 'shy') {
      this.triggerMicroReaction('blush_ramp');
    } else {
      this.currentMicroReaction = 'none';
    }
  }

  public setDirective(directive: ExpressionDirective): void {
    this.isActive = true;
    this.targetEmotion = directive.base || 'gentle_smile';
    this.targetIntensity = Math.min(1.0, Math.max(0.0, directive.intensity ?? 0.7));

    if (directive.microReaction && directive.microReaction !== 'none') {
      this.triggerMicroReaction(directive.microReaction);
    }
  }

  public triggerMicroReaction(reaction: EmotionMicroReaction): void {
    this.currentMicroReaction = reaction;
    this.microReactionTimer = 0;

    if (reaction === 'blush_ramp') {
      this.blushIntensity = 0.1;
    }
  }

  public setManualOverride(_name: string | null): void {
    // 兼容历史接口
  }

  /**
   * 注册动作级动态表情回调函数（每帧调用，由动作上下文实时计算动态表情）
   * @param fn 动态表情计算函数。传入 null 则注销并恢复预设表情模式
   * @param timingGetter 获取动作实时时间轴进度（elapsed, duration）的回调
   */
  public setExpressionFn(
    fn: MotionExpressionFn | null,
    timingGetter?: () => { elapsed: number; duration: number },
  ): void {
    this.customExpressionFn = fn;
    this.customTimingGetter = timingGetter ?? null;
    if (fn) {
      this.isActive = true;
    }
  }

  public getExpressionFn(): MotionExpressionFn | null {
    return this.customExpressionFn;
  }

  /**
   * 解耦 VRoid 模型复合表情绑定 (Fcl_ALL_Joy -> Fcl_MTH_Joy, Fcl_ALL_Fun -> Fcl_MTH_Fun)
   * 1. 微笑与开心解耦：微笑 (gentle_smile) 纯嘴部微笑，眼睛完全不眯 (eyeJoy = 0)；
   *    开心 (happy) 主要通过嘴巴大笑表现，眼睛稍微有一点点眯眼即可 (eyeJoy <= 0.12)；
   * 2. 放松 (relaxed) 眼睛不需要任何变化，仅嘴巴自然放松 (eyeFun = 0)；
   * 3. 俏皮 (playful) 眼睛绝不维持半眯，右眼 100% 全睁，左眼仅单次 Wink 脉冲；
   * 4. 彻底杜绝常态眯眯眼。
   */
  public ensureDecoupledExpressions(vrm: VRM): void {
    if (!vrm?.expressionManager || (vrm as any)._expressionsDecoupled || !vrm.scene?.traverse) {
      return;
    }

    try {
      let faceMesh: THREE.Mesh | null = null;
      vrm.scene.traverse((node: any) => {
        if (
          !faceMesh &&
          node.isMesh &&
          node.morphTargetDictionary &&
          (node.morphTargetDictionary['Fcl_MTH_Joy'] !== undefined ||
            node.morphTargetDictionary['Fcl_ALL_Joy'] !== undefined)
        ) {
          faceMesh = node as THREE.Mesh;
        }
      });

      if (faceMesh && (faceMesh as THREE.Mesh).morphTargetDictionary) {
        const dict = (faceMesh as THREE.Mesh).morphTargetDictionary!;
        const mgr = vrm.expressionManager;

        // 1. 注册/重写 gentle_smile 表情 (纯嘴部微笑 + 微弱提眉，眼睛 100% 睁开，0 眯眼)
        if (dict['Fcl_MTH_Joy'] !== undefined) {
          const gentleSmileExpr = mgr.getExpression('gentle_smile');
          if (!gentleSmileExpr) {
            const newExpr = new VRMExpression('gentle_smile');
            newExpr.addBind(
              new VRMExpressionMorphTargetBind({
                primitives: [faceMesh],
                index: dict['Fcl_MTH_Joy'],
                weight: 1.0,
              }),
            );
            if (dict['Fcl_BRW_Joy'] !== undefined) {
              newExpr.addBind(
                new VRMExpressionMorphTargetBind({
                  primitives: [faceMesh],
                  index: dict['Fcl_BRW_Joy'],
                  weight: 0.35,
                }),
              );
            }
            mgr.registerExpression(newExpr);
          }
        }

        // 2. 解耦 happy 预设表情 (嘴巴大笑 1.0，眉毛 0.45，眼睛完全不眯 0，杜绝眯眼)
        const happyExpr = mgr.getExpression('happy');
        if (happyExpr && dict['Fcl_MTH_Joy'] !== undefined) {
          happyExpr.clearAppliedWeight();
          (happyExpr as any)._binds.length = 0;
          happyExpr.addBind(
            new VRMExpressionMorphTargetBind({
              primitives: [faceMesh],
              index: dict['Fcl_MTH_Joy'],
              weight: 1.0,
            }),
          );
          if (dict['Fcl_BRW_Joy'] !== undefined) {
            happyExpr.addBind(
              new VRMExpressionMorphTargetBind({
                primitives: [faceMesh],
                index: dict['Fcl_BRW_Joy'],
                weight: 0.45,
              }),
            );
          }
          // 开心的眼睛也不需要眯，彻底排除 Fcl_EYE_Joy！
        }

        // 3. 解耦 relaxed 预设表情 (放松眼睛不需要任何变化，仅嘴巴自然放松 1.0)
        const relaxedExpr = mgr.getExpression('relaxed');
        if (relaxedExpr && dict['Fcl_MTH_Fun'] !== undefined) {
          relaxedExpr.clearAppliedWeight();
          (relaxedExpr as any)._binds.length = 0;
          relaxedExpr.addBind(
            new VRMExpressionMorphTargetBind({
              primitives: [faceMesh],
              index: dict['Fcl_MTH_Fun'],
              weight: 1.0,
            }),
          );
          if (dict['Fcl_BRW_Fun'] !== undefined) {
            relaxedExpr.addBind(
              new VRMExpressionMorphTargetBind({
                primitives: [faceMesh],
                index: dict['Fcl_BRW_Fun'],
                weight: 0.25,
              }),
            );
          }
          // 放松眼睛也不需要眯，彻底排除 Fcl_EYE_Fun！
        }

        // 4. 注册/重写 playful 预设表情 (甜美微笑 + 眉毛微扬 + 双眼微微眯一点 0.20)
        if (dict['Fcl_MTH_Joy'] !== undefined) {
          let playfulExpr = mgr.getExpression('playful');
          if (!playfulExpr) {
            playfulExpr = new VRMExpression('playful');
            mgr.registerExpression(playfulExpr);
          }
          playfulExpr.clearAppliedWeight();
          (playfulExpr as any)._binds.length = 0;
          playfulExpr.addBind(
            new VRMExpressionMorphTargetBind({
              primitives: [faceMesh],
              index: dict['Fcl_MTH_Joy'],
              weight: 0.85,
            }),
          );
          if (dict['Fcl_BRW_Joy'] !== undefined) {
            playfulExpr.addBind(
              new VRMExpressionMorphTargetBind({
                primitives: [faceMesh],
                index: dict['Fcl_BRW_Joy'],
                weight: 0.35,
              }),
            );
          }
          if (dict['Fcl_EYE_Joy'] !== undefined) {
            playfulExpr.addBind(
              new VRMExpressionMorphTargetBind({
                primitives: [faceMesh],
                index: dict['Fcl_EYE_Joy'],
                weight: 0.20, // 俏皮微微眯一点就好 (20% 弧度，绝不挤压成缝)
              }),
            );
          }
        }
      }

      (vrm as any)._expressionsDecoupled = true;
    } catch (e) {
      console.warn('[ExpressionController] Failed to decouple VRM expressions:', e);
    }
  }

  /**
   * 重置所有表情权重回归纯净默认面部 (Eyes open, natural lips)
   */
  public reset(vrm?: VRM | null, isSpeaking = false): void {
    this.targetEmotion = 'neutral';
    this.targetIntensity = 0.0;
    this.currentMicroReaction = 'none';
    this.blushIntensity = 0.0;
    this.playfulTimer = 0;
    this.customExpressionFn = null;
    this.customTimingGetter = null;
    this.targetMorphs.reset();

    for (let i = 0; i < EMOTION_KEYS.length; i++) {
      const e = EMOTION_KEYS[i];
      this.currentWeights[e] = e === 'neutral' ? 1.0 : 0.0;
    }

    for (let i = 0; i < MORPH_KEYS.length; i++) {
      this.liveMorphs[MORPH_KEYS[i]] = 0;
    }

    if (vrm?.expressionManager) {
      try {
        vrm.expressionManager.setValue('happy', 0);
        vrm.expressionManager.setValue('gentle_smile', 0);
        vrm.expressionManager.setValue('playful', 0);
        vrm.expressionManager.setValue('angry', 0);
        vrm.expressionManager.setValue('sad', 0);
        vrm.expressionManager.setValue('surprised', 0);
        vrm.expressionManager.setValue('relaxed', 0);
        vrm.expressionManager.setValue('blink', 0);
        vrm.expressionManager.setValue('blinkLeft', 0);
        vrm.expressionManager.setValue('blinkRight', 0);
        if (!isSpeaking) {
          vrm.expressionManager.setValue('aa', 0);
        }
        vrm.expressionManager.setValue('ou', 0);
      } catch { }
    }
  }

  /**
   * 逐帧更新活体表情并提交给 VRM
   */
  public update(
    delta: number,
    vrm: VRM | null,
    isSpeaking: boolean = false,
    activeVisemeMouth: number = 0,
    gazeBlink: number = 0,
  ): void {
    if (!vrm?.expressionManager) return;
    this.ensureDecoupledExpressions(vrm);

    // 检查是否有仍在平滑衰减的残余权重
    let hasLiveRemnant = false;
    for (let i = 0; i < MORPH_KEYS.length; i++) {
      if (this.liveMorphs[MORPH_KEYS[i]] > 0.001) {
        hasLiveRemnant = true;
        break;
      }
    }

    // 非接管模式且没有正在平滑衰减的残余权重时，放行给 GazeController
    if (!this.isActive && !hasLiveRemnant) {
      return;
    }

    const mgr = vrm.expressionManager;
    this.breathClock += delta;
    this.targetMorphs.reset();

    const mouthDuck = isSpeaking || activeVisemeMouth > 0.05 ? this.config.speechMouthDucking : 1.0;

    // ── 0. 目标值求值：动作动态函数优先 (Motion Expression Function) ──
    if (this.customExpressionFn) {
      const timing = this.customTimingGetter ? this.customTimingGetter() : { elapsed: 0, duration: 1 };
      const dur = Math.max(0.001, timing.duration);
      const elapsed = Math.max(0, timing.elapsed);

      // 读取头部骨骼姿态 (Pitch, Yaw, Roll)
      // 注意：Three.js 动作管线直接写入 bone.quaternion，必须通过四元数转换提取真实欧拉角
      const headNode = vrm.humanoid?.getNormalizedBoneNode('head');
      let headPitch = 0;
      let headYaw = 0;
      let headRoll = 0;
      if (headNode) {
        if (Math.abs(headNode.rotation.x) > 0.001) {
          headPitch = headNode.rotation.x;
          headYaw = headNode.rotation.y;
          headRoll = headNode.rotation.z;
        } else {
          this.tempEuler.setFromQuaternion(headNode.quaternion, 'YXZ');
          headPitch = this.tempEuler.x;
          headYaw = this.tempEuler.y;
          headRoll = this.tempEuler.z;
        }
      }

      this.exprContext.elapsed = elapsed;
      this.exprContext.duration = dur;
      this.exprContext.progress = Math.min(1.0, elapsed / dur);
      this.exprContext.delta = delta;
      this.exprContext.time = this.breathClock;
      this.exprContext.vrm = vrm;
      this.exprContext.headPitch = headPitch;
      this.exprContext.headYaw = headYaw;
      this.exprContext.headRoll = headRoll;
      this.exprContext.isSpeaking = isSpeaking;
      this.exprContext.gazeBlink = gazeBlink;

      this.exprOutput.reset();
      this.customExpressionFn(this.exprContext, this.exprOutput);

      this.targetMorphs.happy = Math.min(1.0, Math.max(0, this.exprOutput.happy * mouthDuck));
      this.targetMorphs.gentle_smile = Math.min(1.0, Math.max(0, (this.exprOutput.gentle_smile || 0) * mouthDuck));
      this.targetMorphs.playful = Math.min(1.0, Math.max(0, (this.exprOutput.playful || 0) * mouthDuck));
      this.targetMorphs.angry = Math.min(1.0, Math.max(0, this.exprOutput.angry * (isSpeaking ? mouthDuck : 1.0)));
      this.targetMorphs.sad = Math.min(1.0, Math.max(0, this.exprOutput.sad * mouthDuck));
      this.targetMorphs.surprised = Math.min(1.0, Math.max(0, this.exprOutput.surprised));
      this.targetMorphs.relaxed = Math.min(1.0, Math.max(0, this.exprOutput.relaxed));
      this.targetMorphs.blinkLeft = Math.min(1.0, Math.max(0, this.exprOutput.blinkLeft));
      this.targetMorphs.blinkRight = Math.min(1.0, Math.max(0, this.exprOutput.blinkRight));
      this.targetMorphs.blink = Math.min(1.0, Math.max(0, this.exprOutput.blink));
      if (!isSpeaking) {
        this.targetMorphs.aa = Math.min(1.0, Math.max(0, this.exprOutput.aa * mouthDuck));
        this.targetMorphs.ou = Math.min(1.0, Math.max(0, this.exprOutput.ou * mouthDuck));
      }
    } else if (this.isActive) {
      // ── 1. 生理自主层 (呼吸微起伏，幅值控制在极细微 ±0.015) ──
      const breathOsc = Math.sin(this.breathClock * 1.85) * this.config.breathOscillationAmp;

      // 预设表情计时演化
      if (this.targetEmotion === 'playful') {
        this.playfulTimer += delta;
      } else {
        this.playfulTimer = 0;
      }

      // ── 2. 情绪基调平滑阻尼流动 (连续时间滤波，Zero-GC 循环，杜绝 1 帧突变抽动) ──
      const dampFactor = Math.min(1.0, delta * this.config.emotionDampSpeed);
      let totalNonNeutralWeight = 0;

      for (let i = 0; i < EMOTION_KEYS.length; i++) {
        const emo = EMOTION_KEYS[i];
        const target = emo === this.targetEmotion ? this.targetIntensity : (emo === 'neutral' ? (1.0 - this.targetIntensity) : 0.0);
        this.currentWeights[emo] += (target - this.currentWeights[emo]) * dampFactor;
        if (emo !== 'neutral') {
          totalNonNeutralWeight += this.currentWeights[emo];
        }
      }

      // 当目标为 neutral 且所有情绪权重均已平滑衰减至极小阈值时，释放接管标记（由 liveMorphs 丝滑渐变归零）
      if (this.targetEmotion === 'neutral' && totalNonNeutralWeight < 0.005) {
        this.isActive = false;
      }

      // ── 3. 戏剧微事件脉冲演化 ──
      if (this.currentMicroReaction !== 'none') {
        this.microReactionTimer += delta;

        if (this.currentMicroReaction === 'blush_ramp') {
          if (this.microReactionTimer < 1.2) {
            this.blushIntensity += (0.85 - this.blushIntensity) * Math.min(1.0, delta * 3.0);
          } else {
            this.blushIntensity += (0.0 - this.blushIntensity) * Math.min(1.0, delta * 0.4);
            if (this.blushIntensity < 0.02) {
              this.currentMicroReaction = 'none';
            }
          }
        } else if (this.microReactionTimer > 2.0) {
          this.currentMicroReaction = 'none';
        }
      }

      // 获取当前头部俯仰角 (Head Pitch)，实现困倦点头/打瞌睡时眼睑与沉睡深度的生理动态联动
      const headNode = vrm.humanoid?.getNormalizedBoneNode('head');
      let headPitch = 0;
      if (headNode) {
        if (Math.abs(headNode.rotation.x) > 0.001) {
          headPitch = headNode.rotation.x;
        } else {
          this.tempEuler.setFromQuaternion(headNode.quaternion, 'YXZ');
          headPitch = this.tempEuler.x;
        }
      }
      // 点头深度系数 (0 ~ 1.0，0.25 rad 约为低头打瞌睡极值)
      const nodFactor = Math.min(1.0, Math.max(0, headPitch / 0.25));

      // 1. 微笑 (gentle_smile) 与 娇羞嘴部 (纯嘴部微笑，眼睛 100% 睁开，0 眯眼)
      const gentleSmileWeight = Math.min(
        0.85,
        Math.max(
          0,
          (this.currentWeights.gentle_smile * 0.75 +
            this.currentWeights.shy * 0.35 +
            breathOsc) *
            mouthDuck,
        ),
      );

      // 2. 开怀喜悦 (happy)：主要是通过嘴巴表现开心程度，眼睛完全不需要眯 (解耦后 Fcl_EYE_Joy 为 0，双眼 100% 自然全睁)
      const happyWeight = Math.min(
        0.80,
        Math.max(
          0,
          (this.currentWeights.happy * 0.75 + breathOsc) * mouthDuck,
        ),
      );

      // 3. 俏皮 (playful)：甜美微笑 + 眉毛轻扬 + 双眼微微眯一点就好 (解耦后 Fcl_EYE_Joy 为 0.20)
      const playfulWeight = Math.min(
        0.80,
        Math.max(
          0,
          (this.currentWeights.playful * 0.75 + breathOsc) * mouthDuck,
        ),
      );

      // 4. 放松 (relaxed)：眼睛不需要任何变化，仅嘴巴自然放松 (解耦后 Fcl_EYE_Fun 为 0，双眼 100% 自然全睁)
      const relaxedWeight = Math.min(
        0.75,
        Math.max(0, (this.currentWeights.relaxed * 0.70 + breathOsc) * mouthDuck),
      );

      // 5. 傲娇微怒 (angry)
      const angryWeight = Math.min(
        0.70,
        Math.max(0, this.currentWeights.angry * 0.65 * (isSpeaking ? mouthDuck : 1.0)),
      );

      // 困意伴生的眉毛微垂 (睡颜舒缓八字眉)
      const sleepySad = this.currentWeights.relaxed * 0.22 * nodFactor;

      // 6. 忧伤期盼 (sad) 与犹豫疑虑 (hesitant)
      const sadWeight = Math.min(
        0.65,
        Math.max(
          0,
          (this.currentWeights.sad_longing * 0.60 +
            this.currentWeights.hesitant * 0.38 +
            sleepySad) *
            mouthDuck,
        ),
      );

      // 7. 惊讶一怔 (surprised)
      const surprisedWeight = Math.min(
        0.75,
        Math.max(
          0,
          this.currentWeights.surprised * 0.70 +
            this.currentWeights.hesitant * 0.15,
        ),
      );

      // 动态打瞌睡眼睑闭合：
      // 站立挺直姿态下眼睛必须 100% 睁开 (sleepyBlink = 0，杜绝眯眯眼)；
      // 仅在真实垂首点头打瞌睡时 (nodFactor > 0.05)，眼睑随低头重力平滑闭合至 0.88 ~ 0.92
      let sleepyBlink = 0;
      if (this.currentWeights.relaxed > 0.01 && nodFactor > 0.05) {
        const normRelaxed = Math.min(1.0, this.currentWeights.relaxed / 0.70);
        sleepyBlink = normRelaxed * nodFactor * 0.90;
      }

      // 犹豫疑惑时的微张口型
      const hesitantMouth = this.currentWeights.hesitant * 0.20 * mouthDuck;
      // 惊讶时的张口吸气
      const surprisedMouth = this.currentWeights.surprised * 0.18 * mouthDuck;
      // 困倦深睡时的微弱口呼吸
      const sleepyMouth = this.currentWeights.relaxed * 0.08 * nodFactor * mouthDuck;

      this.targetMorphs.gentle_smile = gentleSmileWeight;
      this.targetMorphs.happy = happyWeight;
      this.targetMorphs.playful = playfulWeight;
      this.targetMorphs.angry = angryWeight;
      this.targetMorphs.sad = sadWeight;
      this.targetMorphs.surprised = surprisedWeight;
      this.targetMorphs.relaxed = relaxedWeight;
      this.targetMorphs.blinkLeft = 0;
      this.targetMorphs.blinkRight = 0;
      this.targetMorphs.blink = sleepyBlink;
      if (!isSpeaking) {
        this.targetMorphs.aa = Math.max(surprisedMouth, sleepyMouth);
        this.targetMorphs.ou = hesitantMouth;
      }
    }

    // ── 4. 全局形态连续指数滤波 (Zero-Snap Continuous Damping) ──
    // 无论是动作函数还是预设切换，所有形态变化均从当前瞬时状态出发，平滑过渡至目标状态 (~0.12s 达 80%)，杜绝 1 帧跳跃
    const morphDamp = 1.0 - Math.exp(-this.config.emotionDampSpeed * delta * 1.8);
    for (let i = 0; i < MORPH_KEYS.length; i++) {
      const k = MORPH_KEYS[i];
      const target = this.targetMorphs[k];
      this.liveMorphs[k] += (target - this.liveMorphs[k]) * morphDamp;
      if (Math.abs(this.liveMorphs[k]) < 0.002 && target === 0) {
        this.liveMorphs[k] = 0;
      }
    }

    // ── 5. 提交至 VRM ExpressionManager ──
    try {
      mgr.setValue('happy', this.liveMorphs.happy);
      mgr.setValue('gentle_smile', this.liveMorphs.gentle_smile);
      mgr.setValue('playful', this.liveMorphs.playful);
      mgr.setValue('angry', this.liveMorphs.angry);
      mgr.setValue('sad', this.liveMorphs.sad);
      mgr.setValue('surprised', this.liveMorphs.surprised);
      mgr.setValue('relaxed', this.liveMorphs.relaxed);
      mgr.setValue('blinkLeft', this.liveMorphs.blinkLeft);
      mgr.setValue('blinkRight', this.liveMorphs.blinkRight);

      // 叠加双眼闭合度：生理眨眼与平滑表情眨眼取最大值
      const finalBlink = Math.min(1.0, Math.max(gazeBlink, this.liveMorphs.blink));
      mgr.setValue('blink', finalBlink);

      // 口型音素合成
      if (activeVisemeMouth > 0.01) {
        mgr.setValue('aa', activeVisemeMouth);
        mgr.setValue('ou', 0);
      } else if (!isSpeaking) {
        mgr.setValue('aa', this.liveMorphs.aa);
        mgr.setValue('ou', this.liveMorphs.ou);
      }
    } catch { }

    // ── 6. 若处于非激活注销状态且所有 Morph 已平滑衰减至 0，完成物理重置 ──
    if (!this.isActive && !this.customExpressionFn && this.targetEmotion === 'neutral') {
      let stillActive = false;
      for (let i = 0; i < MORPH_KEYS.length; i++) {
        if (this.liveMorphs[MORPH_KEYS[i]] > 0.002) {
          stillActive = true;
          break;
        }
      }
      if (!stillActive) {
        this.reset(vrm, isSpeaking);
      }
    }
  }

  public getBlushIntensity(): number {
    return this.blushIntensity;
  }
}

export const expressionController = new ExpressionController();
