import { cameraDirector } from '@/core/scene/cameraDirector';
import { expressionController } from '@/core/morph/expressionController';
import { storyAudioDirector } from './audioDirector';
import { vrmEngine } from '@/core/vrmEngine';
import { sceneManager } from '@/core/scene/sceneManager';
import { APP_CONFIG } from '@/config';
import { changeLang } from '@/i18n';
import type { i18n as I18nInstance } from 'i18next';
import type {
  StoryScript,
  StoryBeat,
  StoryChoice,
} from './schema';

export interface StoryState {
  isActive: boolean;
  scriptId: string | null;
  currentBeat: StoryBeat | null;
  currentBeatId: string | null;
  isIntertitleActive: boolean;
  intertitleText: string;
  intertitleStyle: 'noto_serif' | 'modern_sans' | 'typewriter';
  isLetterboxActive: boolean;
  isEyeBlinkActive: boolean;
  isSpeaking: boolean;
  choices: StoryChoice[];
  progress: {
    current: number;
    total: number;
  };
}

export type StoryStateListener = (state: StoryState) => void;

export class StoryDirectorEngine {
  private currentScript: StoryScript | null = null;
  private currentBeatId: string | null = null;
  private isInterrupted = false;
  private executionSequence = 0;
  private i18nInstance: I18nInstance | null = null;
  private listeners = new Set<StoryStateListener>();

  private state: StoryState = {
    isActive: false,
    scriptId: null,
    currentBeat: null,
    currentBeatId: null,
    isIntertitleActive: false,
    intertitleText: '',
    intertitleStyle: 'noto_serif',
    isLetterboxActive: false,
    isEyeBlinkActive: false,
    isSpeaking: false,
    choices: [],
    progress: { current: 1, total: 1 },
  };

  private intertitleResolver: (() => void) | null = null;

  public setI18n(i18n: I18nInstance): void {
    this.i18nInstance = i18n;
  }

  public getState(): StoryState {
    return this.state;
  }

  public getCurrentBeatId(): string | null {
    return this.currentBeatId;
  }

  public getIsInterrupted(): boolean {
    return this.isInterrupted;
  }

  public subscribe(fn: StoryStateListener): () => void {
    this.listeners.add(fn);
    fn(this.state);
    return () => this.listeners.delete(fn);
  }

  public skipIntertitle(): void {
    if (this.intertitleResolver) {
      this.intertitleResolver();
      this.intertitleResolver = null;
    }
  }

  private notify(): void {
    this.listeners.forEach((fn) => fn(this.state));
  }

  /**
   * 启动一段故事剧本
   */
  public async playScript(script: StoryScript, initialBeatId?: string): Promise<void> {
    this.currentScript = script;
    const startId = initialBeatId || script.initialBeatId;
    this.isInterrupted = false;

    const beatKeys = Object.keys(script.beats);
    this.state = {
      ...this.state,
      isActive: true,
      scriptId: script.id,
      progress: {
        current: Math.max(1, beatKeys.indexOf(startId) + 1),
        total: Math.max(1, beatKeys.length),
      },
    };
    this.notify();

    await this.goToBeat(startId);
  }

  /**
   * 跳转并执行指定的情节点 (Beat)
   */
  public async goToBeat(beatId: string): Promise<void> {
    if (!this.currentScript || !this.currentScript.beats[beatId]) {
      console.warn(`[StoryEngine] Beat not found: ${beatId}`);
      return;
    }

    const seq = ++this.executionSequence;
    this.currentBeatId = beatId;
    const beat = this.currentScript.beats[beatId];

    const beatKeys = Object.keys(this.currentScript.beats);
    const curIdx = beatKeys.indexOf(beatId);

    this.state = {
      ...this.state,
      currentBeatId: beatId,
      currentBeat: beat,
      choices: [], // 先清空上一拍的选项
      progress: {
        current: curIdx >= 0 ? curIdx + 1 : this.state.progress.current,
        total: beatKeys.length,
      },
    };
    this.notify();

    // ── 阶段一: 舞台起势 (Pre-Act) ──
    // 1. 处理画幅与黑幕白字
    if (beat.cinematics?.letterbox !== undefined) {
      this.state.isLetterboxActive = beat.cinematics.letterbox;
    }

    if (beat.cinematics?.transition === 'eye_blink') {
      this.state.isEyeBlinkActive = true;
      this.notify();
      setTimeout(() => {
        if (this.executionSequence === seq) {
          this.state.isEyeBlinkActive = false;
          this.notify();
        }
      }, 1500);
    }

    if (beat.cinematics?.intertitle) {
      this.state.isIntertitleActive = true;
      this.state.intertitleText = beat.cinematics.intertitle.text;
      this.state.intertitleStyle = beat.cinematics.intertitle.style || 'noto_serif';
      this.notify();

      if (beat.cinematics.intertitle.bgmFaded) {
        storyAudioDirector.setMuffle(true);
      }

      const durationMs = (beat.cinematics.intertitle.durationSec || 2.5) * 1000;
      await new Promise<void>((resolve) => {
        let timer: any = null;
        const finish = () => {
          if (timer) clearTimeout(timer);
          this.intertitleResolver = null;
          resolve();
        };
        this.intertitleResolver = finish;
        timer = setTimeout(finish, durationMs);
      });

      if (this.executionSequence !== seq) return;
      this.state.isIntertitleActive = false;
      storyAudioDirector.setMuffle(false);
      this.notify();
    }

    // 2. 调度镜头 (防崩保护与异步推演)
    if (beat.camera) {
      void cameraDirector.transitionTo(beat.camera).catch((err) => {
        console.warn('[StoryEngine] cameraDirector error:', err);
      });
    }

    // 3. 调度活体表情
    if (beat.actor.expression) {
      expressionController.setDirective(beat.actor.expression);
    }

    // 4. 起势动作 (0.4s Lead-in)
    if (beat.actor.leadInMotion) {
      void vrmEngine.playMotion(beat.actor.leadInMotion, { fadeDuration: 0.6 });
    }

    // 5. 调度 BGM 与音效
    if (beat.audio) {
      void storyAudioDirector.executeDirective(beat.audio);
    }

    await new Promise((r) => setTimeout(r, 350));
    if (this.executionSequence !== seq) return;

    // ── 阶段二: 开声发音 (In-Speech) ──
    storyAudioDirector.duckBgm();

    if (beat.actor.motion) {
      void vrmEngine.playMotion(beat.actor.motion, { fadeDuration: 0.75 });
    }

    if (beat.actor.speechText && beat.actor.speechText.trim().length > 0) {
      this.state.isSpeaking = true;
      this.notify();

      try {
        await vrmEngine.speakText(beat.actor.speechText);
      } catch (e) {
        console.warn('[StoryEngine] speakText error:', e);
      }
    }

    if (this.executionSequence !== seq) return;

    // ── 阶段三: 余韵收势 (Post-Act) ──
    this.state.isSpeaking = false;
    storyAudioDirector.restoreBgmDucking();

    // 手势柔和回落，平滑切入真人动捕倾听姿态 (双手后背温婉前倾)
    void vrmEngine.playMotion('listening', {
      fadeDuration: 0.85,
      loop: true,
      mask: 'upperBody',
    });

    // ── 阶段四: 递麦挂起 (Yield & Hooks) ──
    if (beat.choices && beat.choices.length > 0) {
      // 升起晶体选项卡片，触发晶体空灵音效
      storyAudioDirector.playSfx('crystal_chime');
      this.state.choices = beat.choices;
      this.notify();
    }
  }

  /**
   * 动态向当前脚本注入新的情节点 (用于 AI 实时叙事/分支展开)
   */
  public addBeatToScript(beat: StoryBeat): void {
    if (!this.currentScript) {
      this.currentScript = {
        id: 'dynamic_story',
        title: '小蠢的剧场',
        description: 'AI 动态驱动的剧情演出',
        initialBeatId: beat.id,
        beats: {},
      };
    }
    this.currentScript.beats[beat.id] = beat;
  }

  /**
   * 立即执行一个动态生成的情节点
   */
  public async executeBeat(beat: StoryBeat): Promise<void> {
    this.addBeatToScript(beat);
    await this.goToBeat(beat.id);
  }

  /**
   * 用户选择分支卡片
   */
  public async selectChoice(choice: StoryChoice): Promise<void> {
    if (this.state.isSpeaking) {
      this.interrupt();
    }

    if (choice.actionType === 'change_lang' && choice.actionPayload && this.i18nInstance) {
      changeLang(this.i18nInstance, choice.actionPayload as any);
    } else if (choice.actionType === 'change_scene' && choice.actionPayload) {
      await sceneManager.setScene(String(choice.actionPayload), true);
    } else if (choice.actionType === 'swap_outfit' && choice.actionPayload) {
      const outfitKey = String(choice.actionPayload);
      const addons = (APP_CONFIG.model.addons || {}) as Record<string, { source: string; name: string }>;
      const addon = addons[outfitKey] || addons[`xiaochun_${outfitKey}`];
      if (addon) {
        await vrmEngine.swapOutfit(addon.source, addon.name);
      } else if (outfitKey === 'base' || outfitKey === 'default') {
        await vrmEngine.swapOutfit(APP_CONFIG.model.defaultSource, APP_CONFIG.model.defaultName);
      }
    } else if (choice.actionType === 'custom' && typeof choice.actionPayload === 'function') {
      try {
        await (choice.actionPayload as () => void | Promise<void>)();
      } catch (err) {
        console.warn('[StoryEngine] custom action error:', err);
      }
    } else if (choice.actionType === 'finish') {
      this.finish();
      return;
    }

    if (choice.nextBeatId) {
      await this.goToBeat(choice.nextBeatId);
    }
  }

  /**
   * 全双工打断：立即叫停当前表演并收敛
   */
  public interrupt(): void {
    this.executionSequence++;
    this.isInterrupted = true;
    vrmEngine.stopSpeaking();
    cameraDirector.stopTransition();
    storyAudioDirector.restoreBgmDucking();
    this.state.isSpeaking = false;
    this.state.isIntertitleActive = false;
    this.notify();

    // 刹车后立即进入倾听态
    void vrmEngine.playMotion('listening', { fadeDuration: 0.6, loop: true, mask: 'upperBody' });
  }

  /**
   * 结束当前剧本
   */
  public finish(): void {
    this.interrupt();
    expressionController.setActive(false);
    this.state = {
      ...this.state,
      isActive: false,
      isLetterboxActive: false,
      choices: [],
      currentBeat: null,
      currentBeatId: null,
    };
    this.notify();
    storyAudioDirector.stopBgm(false);
  }
}

export const storyDirectorEngine = new StoryDirectorEngine();
