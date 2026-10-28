import type { VRM } from '@pixiv/three-vrm';
import type { ExpressionDirective, EmotionMicroReaction } from '@/story/schema';

export interface ExpressionControllerConfig {
  /** 基础情绪过渡阻尼速度 (越大过渡越快，默认 7.5，约 0.35s 完成) */
  emotionDampSpeed: number;
  /** 呼吸微波动幅度 (±0.02) */
  breathOscillationAmp: number;
  /** 说话时唇部表情的闪避系数 (0.25 即说话时嘴角表情只保留 25%，防止嘴部撕裂) */
  speechMouthDucking: number;
}

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
    const raw = (name ?? 'neutral').toLowerCase().trim() as SupportedExpression;
    if (!raw || raw === 'neutral') {
      this.targetEmotion = 'neutral';
      this.targetIntensity = 0.0;
      this.currentMicroReaction = 'none';
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
   * 重置所有表情权重回归纯净默认面部 (Eyes open, natural lips)
   */
  public reset(vrm?: VRM | null, isSpeaking = false): void {
    this.targetEmotion = 'neutral';
    this.targetIntensity = 0.0;
    this.currentMicroReaction = 'none';
    this.blushIntensity = 0.0;

    for (let i = 0; i < EMOTION_KEYS.length; i++) {
      const e = EMOTION_KEYS[i];
      this.currentWeights[e] = e === 'neutral' ? 1.0 : 0.0;
    }

    if (vrm?.expressionManager) {
      try {
        vrm.expressionManager.setValue('happy', 0);
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

    // 非接管模式且没有正在衰减的情绪时，放行给 GazeController
    if (!this.isActive) {
      return;
    }

    const mgr = vrm.expressionManager;
    this.breathClock += delta;

    // ── 1. 生理自主层 (呼吸微起伏，幅值控制在极细微 ±0.015) ──
    const breathOsc = Math.sin(this.breathClock * 1.85) * this.config.breathOscillationAmp;

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

    // 当目标为 neutral 且所有情绪权重均已平滑衰减至极小阈值时，释放接管回归基态素颜
    if (this.targetEmotion === 'neutral' && totalNonNeutralWeight < 0.005) {
      this.isActive = false;
      this.reset(vrm, isSpeaking);
      return;
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

    // ── 4. 区域解耦与自然生动表情映射 (Zero-GC 算法) ──
    const mouthDuck = isSpeaking || activeVisemeMouth > 0.05 ? this.config.speechMouthDucking : 1.0;

    // 获取当前头部俯仰角 (Head Pitch)，实现困倦点头/打瞌睡时眼睑与沉睡深度的生理动态联动
    const headNode = vrm.humanoid?.getNormalizedBoneNode('head');
    const headPitch = headNode ? Math.max(0, headNode.rotation.x) : 0;
    // 点头深度系数 (0 ~ 1.0，0.30 rad 约为低头打瞌睡极值)
    const nodFactor = Math.min(1.0, Math.max(0, headPitch / 0.30));

    // 开怀喜悦 (happy) 与温婉微笑 (gentle_smile)
    const happyWeight = Math.min(
      0.80,
      Math.max(
        0,
        (this.currentWeights.happy * 0.70 +
          this.currentWeights.gentle_smile * 0.38 +
          this.currentWeights.playful * 0.52 +
          this.currentWeights.shy * 0.28 +
          breathOsc) *
          mouthDuck,
      ),
    );

    // 傲娇微怒 (angry)
    const angryWeight = Math.min(
      0.70,
      Math.max(0, this.currentWeights.angry * 0.65 * (isSpeaking ? mouthDuck : 1.0)),
    );

    // 困意/放松伴生的眉毛微垂 (睡颜舒缓八字眉)
    const sleepySad = this.currentWeights.relaxed * 0.22 * nodFactor;

    // 忧伤期盼 (sad) 与犹豫疑虑 (hesitant)
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

    // 惊讶一怔 (surprised)
    const surprisedWeight = Math.min(
      0.75,
      Math.max(
        0,
        this.currentWeights.surprised * 0.70 +
          this.currentWeights.hesitant * 0.15,
      ),
    );

    // 放松从容 (relaxed)：随点头垂首自然舒展嘴角
    const relaxedWeight = Math.min(
      0.65,
      Math.max(
        0,
        this.currentWeights.relaxed * (0.45 + 0.15 * nodFactor) +
          this.currentWeights.shy * 0.25,
      ),
    );

    // 俏皮眨眼 (playful wink)：单侧左眼可爱 Wink 灵动眨眼
    const playfulWink = this.currentWeights.playful > 0.005
      ? Math.min(0.95, Math.max(0, this.currentWeights.playful * 0.88))
      : 0;

    // 困倦打盹动态眼睑闭合 (Sleepy Eyelid Lifecycle):
    // - 抬头/初始微困时：眼皮自然下垂至约 0.35 (朦胧睡意半目)
    // - 点头垂首时 (nodFactor 升高)：眼睑随重力与沉睡深度平滑闭合至 0.88 ~ 0.92 (深沉酣睡闭眼)
    // - 猛然抬起或惊醒微动时：眼皮随 headPitch 下降瞬间睁开至 0.45 ~ 0.55
    // - 动作结束时：随 currentWeights 平滑淡出完全睁开 (0.0)
    let sleepyBlink = 0;
    if (this.currentWeights.relaxed > 0.01) {
      const normRelaxed = Math.min(1.0, this.currentWeights.relaxed / 0.70);
      sleepyBlink = normRelaxed * (0.35 + nodFactor * 0.55);
    } else if (this.currentWeights.shy > 0.01) {
      sleepyBlink = this.currentWeights.shy * 0.25; // 害羞时眼帘微垂
    }

    // 犹豫疑惑时的微张口型
    const hesitantMouth = this.currentWeights.hesitant * 0.20 * mouthDuck;
    // 惊讶时的张口吸气
    const surprisedMouth = this.currentWeights.surprised * 0.18 * mouthDuck;
    // 困倦深睡时的微弱口呼吸
    const sleepyMouth = this.currentWeights.relaxed * 0.08 * nodFactor * mouthDuck;

    try {
      mgr.setValue('happy', happyWeight);
      mgr.setValue('angry', angryWeight);
      mgr.setValue('sad', sadWeight);
      mgr.setValue('surprised', surprisedWeight);
      mgr.setValue('relaxed', relaxedWeight);

      // 单眼俏皮眨眼 (Wink)
      mgr.setValue('blinkLeft', playfulWink);

      // 叠加双眼闭合度 (生理眨眼与困意眼睑取最大值，零回读零累加)
      const finalBlink = Math.min(1.0, Math.max(gazeBlink, sleepyBlink));
      mgr.setValue('blink', finalBlink);

      // 口型音素合成 (语音、惊讶张嘴、困意呼吸、犹豫微张)
      if (activeVisemeMouth > 0.01) {
        mgr.setValue('aa', activeVisemeMouth);
        mgr.setValue('ou', 0);
      } else if (!isSpeaking) {
        const combinedAa = Math.max(surprisedMouth, sleepyMouth);
        mgr.setValue('aa', combinedAa);
        mgr.setValue('ou', hesitantMouth);
      }

      // 注意：无需在此处重复调用 mgr.update()，vrm.update(delta) 在渲染主循环中会统一调度
    } catch {
      // 忽略部分模型缺失的非标表情
    }
  }

  public getBlushIntensity(): number {
    return this.blushIntensity;
  }
}

export const expressionController = new ExpressionController();
