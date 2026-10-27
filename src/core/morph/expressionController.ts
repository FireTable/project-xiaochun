import type { VRM } from '@pixiv/three-vrm';
import type { ExpressionDirective, EmotionBase, EmotionMicroReaction } from '@/story/schema';

export interface ExpressionControllerConfig {
  /** 基础情绪过渡阻尼速度 (越大过渡越快，默认 7.5，约 0.35s 完成) */
  emotionDampSpeed: number;
  /** 呼吸微波动幅度 (±0.02) */
  breathOscillationAmp: number;
  /** 说话时唇部表情的闪避系数 (0.25 即说话时嘴角表情只保留 25%，防止嘴部撕裂) */
  speechMouthDucking: number;
}

export class ExpressionController {
  private config: ExpressionControllerConfig = {
    emotionDampSpeed: 7.5,
    breathOscillationAmp: 0.02,
    speechMouthDucking: 0.25,
  };

  /** 是否处于故事剧场接管状态。非故事模式下保持 false，完全由 GazeController 维持自然纯净素颜 */
  private isActive = false;

  // 当前实时计算权重 (0.0 ~ 1.0)
  private currentWeights: Record<EmotionBase, number> = {
    neutral: 1.0,
    gentle_smile: 0.0,
    hesitant: 0.0,
    shy: 0.0,
    surprised: 0.0,
    sad_longing: 0.0,
    playful: 0.0,
  };

  // 目标情绪与强度 (默认纯净 neutral，强度 0)
  private targetEmotion: EmotionBase = 'neutral';
  private targetIntensity = 0.0;

  // 戏剧微反应事件状态
  private currentMicroReaction: EmotionMicroReaction = 'none';
  private microReactionTimer = 0;
  private blushIntensity = 0.0;
  private breathClock = 0;

  // 外部强制覆盖 (支持 devDrawer 或调试)
  private manualOverride: string | null = null;

  public setActive(active: boolean): void {
    this.isActive = active;
    if (!active) {
      this.reset();
    }
  }

  public getIsActive(): boolean {
    return this.isActive;
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

  public setManualOverride(name: string | null): void {
    this.manualOverride = name;
  }

  /**
   * 重置所有表情权重回归纯净默认面部 (Eyes open, natural lips)
   */
  public reset(vrm?: VRM | null): void {
    this.targetEmotion = 'neutral';
    this.targetIntensity = 0.0;
    this.currentMicroReaction = 'none';
    this.blushIntensity = 0.0;

    const emotions: EmotionBase[] = [
      'neutral', 'gentle_smile', 'hesitant', 'shy', 'surprised', 'sad_longing', 'playful'
    ];
    emotions.forEach((e) => {
      this.currentWeights[e] = e === 'neutral' ? 1.0 : 0.0;
    });

    if (vrm?.expressionManager) {
      try {
        vrm.expressionManager.setValue('happy', 0);
        vrm.expressionManager.setValue('sad', 0);
        vrm.expressionManager.setValue('surprised', 0);
        vrm.expressionManager.setValue('relaxed', 0);
        vrm.expressionManager.setValue('aa', 0);
        vrm.expressionManager.setValue('ou', 0);
        vrm.expressionManager.update();
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
    activeVisemeMouth: number = 0
  ): void {
    if (!vrm?.expressionManager) return;
    if (this.manualOverride) return;

    // 非故事剧场接管模式下，直接放行，完全交由 GazeController 驱动自然原生表情与眨眼
    if (!this.isActive) {
      return;
    }

    const mgr = vrm.expressionManager;
    this.breathClock += delta;

    // ── 1. 生理自主层 (呼吸微起伏，幅值控制在极细微 ±0.02) ──
    const breathOsc = Math.sin(this.breathClock * 1.85) * this.config.breathOscillationAmp;

    // ── 2. 情绪基调平滑阻尼流动 ──
    const dampFactor = Math.min(1.0, delta * this.config.emotionDampSpeed);
    const emotions: EmotionBase[] = [
      'neutral', 'gentle_smile', 'hesitant', 'shy', 'surprised', 'sad_longing', 'playful'
    ];

    emotions.forEach((emo) => {
      const target = emo === this.targetEmotion ? this.targetIntensity : (emo === 'neutral' ? (1.0 - this.targetIntensity) : 0.0);
      this.currentWeights[emo] += (target - this.currentWeights[emo]) * dampFactor;
    });

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

    // ── 4. 区域解耦与 VRoid 专属比例微调 (严防眯眼与强行扯嘴) ──
    // VRoid 1.0 的 happy 预设自带眼睛眯成弯月和大幅张嘴。
    // 在温柔微笑 (gentle_smile) 下，happy 权重严格限制在 0.12 以内，仅令嘴角自然上扬，确保大眼睛清澈睁开！
    const mouthDuck = isSpeaking || activeVisemeMouth > 0.05 ? this.config.speechMouthDucking : 1.0;

    const happyScale = 0.12; // 0.12 即可实现柔美抿嘴微甜笑容，绝不眯眼变形
    const happyWeight = Math.min(0.18, Math.max(0, (this.currentWeights.gentle_smile * happyScale + this.currentWeights.playful * 0.15 + breathOsc) * mouthDuck));
    const sadWeight = Math.min(0.25, Math.max(0, (this.currentWeights.sad_longing + this.currentWeights.hesitant) * 0.25 * mouthDuck));
    const surprisedWeight = Math.min(0.45, Math.max(0, this.currentWeights.surprised * 0.45));
    // relaxed 会使上眼皮下耷，只有在明确害羞时微赋 0.1，neutral 绝不参与
    const relaxedWeight = Math.min(0.15, Math.max(0, this.currentWeights.shy * 0.15));

    try {
      mgr.setValue('happy', happyWeight);
      mgr.setValue('sad', sadWeight);
      mgr.setValue('surprised', surprisedWeight);
      mgr.setValue('relaxed', relaxedWeight);

      // 如果有口型输入，写入标准音素
      if (activeVisemeMouth > 0.01) {
        mgr.setValue('aa', activeVisemeMouth);
      } else if (!isSpeaking) {
        mgr.setValue('aa', 0);
      }

      mgr.update();
    } catch {
      // 忽略部分模型缺失的非标表情
    }
  }

  public getBlushIntensity(): number {
    return this.blushIntensity;
  }
}

export const expressionController = new ExpressionController();
