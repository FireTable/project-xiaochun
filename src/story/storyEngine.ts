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
  StoryHistoryEntry,
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
  history: StoryHistoryEntry[];
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
    history: [],
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
      history: [],
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

    const hasSpeech = Boolean(beat.actor.speechText && beat.actor.speechText.trim().length > 0);
    this.state = {
      ...this.state,
      currentBeatId: beatId,
      currentBeat: beat,
      choices: [], // 先清空上一拍的选项
      isSpeaking: hasSpeech, // 只要本拍有台词，在进入舞台时即标记为说话中，防止前情提要提前抢跑
      isIntertitleActive: Boolean(beat.cinematics?.intertitle),
      progress: {
        current: curIdx >= 0 ? curIdx + 1 : this.state.progress.current,
        total: beatKeys.length,
      },
    };

    // 记录小蠢台词到剧情历史流水线
    if (beat.actor.speechText && beat.actor.speechText.trim().length > 0) {
      const speech = beat.actor.speechText.trim();
      if (!this.state.history.some((h) => h.id === `${beatId}_speech`)) {
        this.state.history.push({
          id: `${beatId}_speech`,
          role: 'xiaochun',
          text: speech,
          timestamp: Date.now(),
        });
      }
    }
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

    // 0. 重置上一拍残留的动作与对白气泡，保障本拍骨骼与对白管线纯净
    vrmEngine.stopMotion(0.4);
    vrmEngine.bubbleTracker.hide();

    // 🌟 序章初见演出准备：黑幕文字界面保持空灵纯黑，角色模型暂隐，镜头保持在常规远景，绝不在未唤醒前过早聚焦
    if (beat.id === 'beat_greet') {
      if (vrmEngine.currentVRM) {
        vrmEngine.currentVRM.scene.visible = false;
        // 关键时序优化：在黑幕阶段提前就位 180 度背对朝向并触发两阶段物理碰撞松弛
        vrmEngine.setFacingBackwards();
      }
    }

    if (beat.cinematics?.intertitle) {
      this.state.isIntertitleActive = true;
      this.state.intertitleText = beat.cinematics.intertitle.text;
      this.state.intertitleStyle = beat.cinematics.intertitle.style || 'noto_serif';
      this.notify();

      if (beat.cinematics.intertitle.bgmFaded) {
        storyAudioDirector.setMuffle(true);
      }

      // 需求 1：必须主动点击屏幕进入下一步，不设自动超时划过
      const requireClick = (beat.cinematics.intertitle as any).requireClick ?? (beat.id === 'beat_greet');
      const durationMs = (beat.cinematics.intertitle.durationSec || 2.5) * 1000;
      await new Promise<void>((resolve) => {
        let timer: any = null;
        const finish = () => {
          if (timer) clearTimeout(timer);
          this.intertitleResolver = null;
          resolve();
        };
        this.intertitleResolver = finish;
        // 唯有明确不要求点击 (requireClick === false) 时才启动自动超时定时器
        if (!requireClick && durationMs > 0) {
          timer = setTimeout(finish, durationMs);
        }
      });

      if (this.executionSequence !== seq) return;
      this.state.isIntertitleActive = false;
      storyAudioDirector.setMuffle(false);
      this.notify();
    }

    // 🌟 序章专属电影级运镜与转身演出
    if (beat.id === 'beat_greet') {
      // 唤醒瞬间：在纯黑转场中恢复模型可见、执行两阶段碰撞松弛与动能归零，并就位裙摆优雅视高
      if (vrmEngine.currentVRM) {
        vrmEngine.currentVRM.scene.visible = true;
        vrmEngine.settleSpringBones(vrmEngine.currentVRM);
      }
      cameraDirector.preparePanUpStart();

      // 电影级自下而上运镜与转身无缝交叠 (总时长约 2.2s，拒绝生硬停顿)
      const panPromise = cameraDirector.panUpReveal(2.2);

      // 在镜头上升至腰背部时 (约 1.1s 处)，角色自然启动踏步迈步转身
      // 运镜与转身动作双重流动重合，镜头就位胸前时角色恰好转正、面带初醒微笑，消灭一切死板定格与顿挫
      await new Promise((r) => setTimeout(r, 1100));
      if (this.executionSequence !== seq) return;

      vrmEngine.triggerBodyTurnToFront();
      if (beat.actor.expression) {
        expressionController.setDirective(beat.actor.expression);
      }

      // 等待运镜平滑就位与踏步收敛
      await panPromise;
      if (this.executionSequence !== seq) return;

      // 预留 300ms 步态平息收尾
      await new Promise((r) => setTimeout(r, 300));
      if (this.executionSequence !== seq) return;
    } else {
      // 2. 常规镜头调度 (防崩保护与异步推演)
      if (beat.camera) {
        void cameraDirector.transitionTo(beat.camera).catch((err) => {
          console.warn('[StoryEngine] cameraDirector error:', err);
        });
      }

      // 3. 调度活体表情
      if (beat.actor.expression) {
        expressionController.setDirective(beat.actor.expression);
      }
    }

    // 4. 起势动作 (0.4s Lead-in)
    // ⚠️ 规则：起势动作必须是单次非循环 (loop: false)，绝不允许死循环锁定肢体！
    if (beat.actor.leadInMotion) {
      void vrmEngine.playMotion(beat.actor.leadInMotion, {
        fadeDuration: 0.6,
        loop: false,
      });
    }

    // 5. 调度 BGM 与音效
    if (beat.audio) {
      void storyAudioDirector.executeDirective(beat.audio);
    }

    await new Promise((r) => setTimeout(r, 350));
    if (beatId !== this.currentBeatId) return;

    // ── 阶段二: 开声发音 (In-Speech) ──
    storyAudioDirector.duckBgm();

    // 如果当前拍明确指定了全程特定动作 (例如 show-full-body 全身旋转展示)
    if (beat.actor.motion) {
      void vrmEngine.playMotion(beat.actor.motion, {
        fadeDuration: 0.75,
        loop: false,
      });
    } else if (beat.actor.leadInMotion) {
      // 若当前拍设置了起势动作，平滑淡出，让骨骼写入权自然交由 EMAGE 语音手势驱动
      vrmEngine.stopMotion(0.75);
    }

    if (!this.isInterrupted && beat.actor.speechText && beat.actor.speechText.trim().length > 0) {
      this.state.isSpeaking = true;
      this.notify();

      try {
        await vrmEngine.speakText(beat.actor.speechText);
      } catch (e) {
        console.warn('[StoryEngine] speakText error:', e);
      }
    }

    if (beatId !== this.currentBeatId) return;

    // ── 阶段三 & 四: 余韵收势与递麦挂起 (Post-Act & Yield) ──
    const applySpeechEnd = () => {
      this.state.isSpeaking = false;
      // 递麦：将选项与前情提要合并在同一个微任务/渲染帧中同步发布，杜绝前后错位闪烁
      if (beat.choices && beat.choices.length > 0) {
        // 若当前拍为换装拍，同步当前已穿戴服装高亮态 (selected)
        const currentOutfit = vrmEngine.currentOutfitKey || 'xiaochun_dinner_dress';
        const currentScene = sceneManager.getCurrentSceneId();
        this.state.choices = beat.choices.map((c) => {
          if (c.actionType === 'swap_outfit') {
            const isWorn =
              c.actionPayload === currentOutfit ||
              c.id === currentOutfit ||
              (currentOutfit.includes('dress') && c.id === 'outfit_dress') ||
              (currentOutfit.includes('maid') && c.id === 'outfit_maid') ||
              (currentOutfit.includes('cheongsam') && c.id === 'outfit_qipao');
            return { ...c, selected: Boolean(isWorn) };
          }
          if (c.actionType === 'change_scene') {
            const isSelected =
              c.actionPayload === currentScene ||
              c.id === `scene_${currentScene}` ||
              (currentScene === 'beach3d' && c.id === 'scene_beach') ||
              (currentScene === 'void' && c.id === 'scene_beach');
            return { ...c, selected: Boolean(isSelected) };
          }
          return c;
        });
      }
      this.notify();
    };
    // 递麦状态直接通知 React 渲染，绝不使用 document.startViewTransition 截屏，
    // 彻底杜绝 View Transitions API 栅格化冻结 3D WebGL Canvas 导致的 250ms "抽帧/卡顿"
    applySpeechEnd();
    storyAudioDirector.restoreBgmDucking();

    // 手势柔和回落：仅当该拍指定了全程特定动作 (beat.actor.motion) 时才显式收势；
    // 若为日常台词，vrmEngine.speakText 内部 (ChatDirector.stop) 在音频播毕时已自包含完成平滑淡出至 NaturalIdle。
    if (beat.actor.motion) {
      vrmEngine.stopMotion(0.85);
    }

    if (beat.choices && beat.choices.length > 0) {
      // 升起晶体选项卡片，触发晶体空灵音效
      storyAudioDirector.playSfx('crystal_chime');
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

    const isOutfitSwap = choice.actionType === 'swap_outfit';
    const isScenePreview = choice.actionType === 'change_scene' && !choice.nextBeatId;
    const isPreviewAction = isOutfitSwap || isScenePreview;

    // 推进剧情拍时立即清空选项防止连击；而换装/场景试选时选项保留在场
    if (!isPreviewAction) {
      this.state.choices = [];
    }

    if (choice.text && !isPreviewAction) {
      let historyText = choice.text;
      if (choice.id === 'outfit_confirm') {
        const currentOutfit = vrmEngine.currentOutfitKey || 'xiaochun_dinner_dress';
        const outfitChoices = this.currentScript?.beats['beat_outfit_choice']?.choices || [];
        const worn = outfitChoices.find(
          (c) =>
            c.actionPayload === currentOutfit ||
            c.id === currentOutfit ||
            (currentOutfit.includes('dress') && c.id === 'outfit_dress') ||
            (currentOutfit.includes('maid') && c.id === 'outfit_maid') ||
            (currentOutfit.includes('cheongsam') && c.id === 'outfit_qipao')
        );
        if (worn?.text) {
          historyText = `换上「${worn.text}」`;
        }
      } else if (choice.id === 'scene_confirm') {
        const currentScene = sceneManager.getCurrentSceneId();
        const sceneChoices = this.currentScript?.beats['beat_scene_choice']?.choices || [];
        const picked = sceneChoices.find(
          (c) =>
            c.actionPayload === currentScene ||
            c.id === `scene_${currentScene}` ||
            (currentScene === 'beach3d' && c.id === 'scene_beach')
        );
        if (picked?.text) {
          historyText = `前往「${picked.text}」`;
        }
      }
      this.state.history.push({
        id: `choice_${Date.now()}`,
        role: 'user',
        text: historyText,
        subText: choice.subText,
        choiceBadge: choice.badge,
        timestamp: Date.now(),
      });
    }
    this.notify();

    if (choice.actionType === 'change_lang' && choice.actionPayload && this.i18nInstance) {
      changeLang(this.i18nInstance, choice.actionPayload as any);
    } else if (choice.actionType === 'change_scene' && choice.actionPayload) {
      await sceneManager.setScene(String(choice.actionPayload), true);
      if (isScenePreview) {
        storyAudioDirector.playSfx('crystal_chime');
        const baseChoices =
          this.state.choices.length > 0
            ? this.state.choices
            : this.state.currentBeat?.choices || [];
        this.state.choices = baseChoices.map((c) => ({
          ...c,
          selected: c.id === choice.id || c.actionPayload === choice.actionPayload,
        }));
        this.notify();
        return;
      }
    } else if (choice.actionType === 'swap_outfit' && choice.actionPayload) {
      const outfitKey = String(choice.actionPayload);
      const addons = (APP_CONFIG.model.addons || {}) as Record<string, { source: string; name: string }>;
      const addon = addons[outfitKey] || addons[`xiaochun_${outfitKey}`];
      if (addon) {
        await vrmEngine.swapOutfit(addon.source, addon.name, { showcase: false });
      } else if (outfitKey === 'base' || outfitKey === 'default') {
        await vrmEngine.swapOutfit(APP_CONFIG.model.defaultSource, APP_CONFIG.model.defaultName, { showcase: false });
      }

      // 换完衣服之后，进行一次 360° 自信全身服装展示动效
      void vrmEngine.playMotion('showFullBody', { fadeDuration: 0.6, loop: false });
      storyAudioDirector.playSfx('crystal_chime');

      // 更新高亮态 (当前穿戴的衣服被选定)
      const baseChoices =
        this.state.choices.length > 0
          ? this.state.choices
          : this.state.currentBeat?.choices || [];
      this.state.choices = baseChoices.map((c) => ({
        ...c,
        selected: c.id === choice.id || c.actionPayload === choice.actionPayload,
      }));
      this.notify();
      return;
    } else if (choice.actionType === 'open_provider_config') {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('xc-open-provider-config'));
      }
      return;
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
   * 全双工打断：立即叫停当前语音表演并收势递麦
   */
  public interrupt(): void {
    this.isInterrupted = true;
    vrmEngine.stopSpeaking();
    cameraDirector.stopTransition();
    storyAudioDirector.restoreBgmDucking();

    const applyInterruptState = () => {
      this.state.isSpeaking = false;
      this.state.isIntertitleActive = false;

      // 若当前拍已有选项，打断后立即展开选项
      if (this.state.currentBeat?.choices && this.state.choices.length === 0) {
        this.state.choices = this.state.currentBeat.choices;
      }
      this.notify();
    };

    applyInterruptState();

    // 刹车后立即平滑回落至自然待机，并确保角色可见性恢复
    if (vrmEngine.currentVRM) {
      vrmEngine.currentVRM.scene.visible = true;
    }
    vrmEngine.stopMotion(0.5);
  }

  /**
   * 结束当前剧本并彻底重置舞台、镜头与音画
   */
  public finish(): void {
    ++this.executionSequence;
    this.currentBeatId = null;
    this.interrupt();
    cameraDirector.reset();
    expressionController.setActive(false);
    this.state = {
      ...this.state,
      isActive: false,
      scriptId: null,
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
