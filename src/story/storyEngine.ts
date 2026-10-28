import { cameraDirector } from '@/core/scene/cameraDirector';
import { expressionController } from '@/core/morph/expressionController';
import { storyAudioDirector } from './audioDirector';
import { vrmEngine } from '@/core/vrmEngine';
import { sceneManager } from '@/core/scene/sceneManager';
import { APP_CONFIG } from '@/config';
import { changeLang, readClientLang } from '@/i18n';
import type { i18n as I18nInstance } from 'i18next';
import type {
  StoryScript,
  StoryBeat,
  StoryChoice,
  StoryHistoryEntry,
  LocalizedStoryBeat,
  StoryLang,
  GradingPreset,
  TransitionKind,
} from './schema';
import { applyVariant, detectBrowserStoryLang, normalizeStoryLang, resolveBeat, resolveChoice } from './localize';
import { resolveStoryScene } from './scenes';
import { TRANSITION_SPECS } from './transitions';
import type { ViewPrefsSnapshot } from '@/core/viewPrefs';

export interface StoryState {
  isActive: boolean;
  scriptId: string | null;
  currentBeat: StoryBeat | null;
  currentBeatId: string | null;
  isIntertitleActive: boolean;
  intertitleText: string;
  intertitleStyle: 'noto_serif' | 'modern_sans' | 'typewriter';
  /** 当前字卡是否需要点击才继续 */
  intertitleRequiresClick: boolean;
  isLetterboxActive: boolean;
  /** 兼容旧字段：eye_blink 转场遮罩正盖着画面 */
  isEyeBlinkActive: boolean;
  /** 当前（或最近一次）转场的类型 */
  transitionKind: TransitionKind;
  /** 转场遮罩是否盖住画面：true 盖住，false 揭开 (Overlay 用 CSS 过渡渲染) */
  isTransitionCovered: boolean;
  /** 当前后期调色预设 (粘性，剧终复位) */
  grading: GradingPreset;
  isSpeaking: boolean;
  choices: StoryChoice[];
  history: StoryHistoryEntry[];
  progress: {
    current: number;
    total: number;
  };
}

export type StoryStateListener = (state: StoryState) => void;

const HISTORY_TEXT: Record<StoryLang, { outfit: (name: string) => string; scene: (name: string) => string }> = {
  'zh-CN': { outfit: (n) => `换上「${n}」`, scene: (n) => `前往「${n}」` },
  en: { outfit: (n) => `Put on "${n}"`, scene: (n) => `Go to "${n}"` },
  ja: { outfit: (n) => `「${n}」に着替える`, scene: (n) => `「${n}」へ行く` },
};

/** 台词说完后，没有 TTS 声音 (失败 / 静音) 时按字数补足的最短阅读时间 */
function minReadMs(text: string): number {
  return Math.min(7000, 1200 + text.trim().length * 75);
}

export class StoryDirectorEngine {
  private currentScript: StoryScript | null = null;
  private currentBeatId: string | null = null;
  private isInterrupted = false;
  /** 进入故事前的用户视角偏好；finish 时还原 */
  private viewPrefs: ViewPrefsSnapshot | null = null;
  private executionSequence = 0;
  private i18nInstance: I18nInstance | null = null;
  private storyLang: StoryLang | null = null;
  /** 最近一次带 branch 的选项 (本剧本内粘性)，决定后续拍用哪份 variants */
  private branch: string | null = null;
  private hourTimer: ReturnType<typeof setTimeout> | null = null;
  /** 叫醒拍把模型藏起来了：由紧接着的下一拍在遮罩下露出 */
  private modelHiddenForWake = false;
  private listeners = new Set<StoryStateListener>();
  private revealTimer: ReturnType<typeof setTimeout> | null = null;
  private wakeAutoNext: (() => void) | null = null;

  private state: StoryState = {
    isActive: false,
    scriptId: null,
    currentBeat: null,
    currentBeatId: null,
    isIntertitleActive: false,
    intertitleText: '',
    intertitleStyle: 'noto_serif',
    intertitleRequiresClick: true,
    isLetterboxActive: false,
    isEyeBlinkActive: false,
    transitionKind: 'none',
    isTransitionCovered: false,
    grading: 'default',
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

  /**
   * 当前剧情语言：剧本里 change_lang 选项选过的语言优先，其次是 i18n 实例的当前语言，最后是 Cookie / 默认语言。
   * 每一拍在“进入时”按这个语言解析多语言文本，所以语言选择后的下一拍立即生效。
   */
  public getLang(): StoryLang {
    if (this.storyLang) return this.storyLang;
    const fromI18n = this.i18nInstance?.resolvedLanguage || this.i18nInstance?.language;
    if (fromI18n) return normalizeStoryLang(fromI18n);
    try {
      return normalizeStoryLang(readClientLang());
    } catch {
      return 'zh-CN';
    }
  }

  public subscribe(fn: StoryStateListener): () => void {
    this.listeners.add(fn);
    fn(this.state);
    return () => this.listeners.delete(fn);
  }

  /**
   * 点击黑幕白字 / “轻触屏幕唤醒”。
   * 这一下同时是整段剧情里唯一必须的用户手势：在它的同步调用栈里解锁 AudioContext，
   * 之后 TTS / BGM / 音效都能在“无点击自动推进”的状态下正常出声。
   */
  public skipIntertitle(): void {
    storyAudioDirector.unlock();
    if (this.intertitleResolver) {
      this.intertitleResolver();
      this.intertitleResolver = null;
    }
  }

  private notify(): void {
    this.listeners.forEach((fn) => fn(this.state));
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }

  /** 可被打断唤醒的等待 (autoNext 的停顿：用户一点屏幕 / 一插话就不再干等) */
  private waitInterruptible(ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
      let timer: ReturnType<typeof setTimeout> | null = null;
      const done = () => {
        if (timer) clearTimeout(timer);
        if (this.wakeAutoNext === done) this.wakeAutoNext = null;
        resolve();
      };
      timer = setTimeout(done, ms);
      this.wakeAutoNext = done;
    });
  }

  // ───────────────────────── 转场 ─────────────────────────

  private clearRevealTimer(): void {
    if (this.revealTimer) clearTimeout(this.revealTimer);
    this.revealTimer = null;
  }

  private setTransition(kind: TransitionKind, covered: boolean): void {
    this.state.transitionKind = kind;
    this.state.isTransitionCovered = covered;
    this.state.isEyeBlinkActive = covered && kind === 'eye_blink';
    this.notify();
  }

  /** 盖住画面并等遮罩完全不透明 (进入拍之前调用：场景切换 / 换装发生在遮罩之下，杜绝穿帮闪烁) */
  private async coverFor(kind: TransitionKind): Promise<void> {
    if (kind === 'none') return;
    this.clearRevealTimer();
    if (this.state.isTransitionCovered && this.state.transitionKind === kind) return;
    this.setTransition(kind, true);
    await this.sleep(TRANSITION_SPECS[kind].coverMs);
  }

  /** 停留 holdMs 后揭开遮罩 */
  private scheduleReveal(kind: TransitionKind, seq: number): void {
    if (kind === 'none') return;
    this.clearRevealTimer();
    this.revealTimer = setTimeout(() => {
      this.revealTimer = null;
      if (this.executionSequence === seq && this.state.isTransitionCovered) {
        this.setTransition(kind, false);
      }
    }, TRANSITION_SPECS[kind].holdMs);
  }

  private revealNow(): void {
    this.clearRevealTimer();
    if (this.state.isTransitionCovered) {
      this.setTransition(this.state.transitionKind, false);
    }
  }

  /**
   * 启动一段故事剧本
   */
  public async playScript(script: StoryScript, initialBeatId?: string): Promise<void> {
    this.currentScript = script;
    const startId = initialBeatId || script.initialBeatId;
    // 退出时要回到进入前的视角：记下用户的视角偏好 (重复 playScript 时保留第一份)，并停掉上一次未走完的回正
    vrmEngine.cancelViewReturn();
    if (!this.state.isActive || !this.viewPrefs) this.viewPrefs = vrmEngine.captureViewPrefs();
    this.isInterrupted = false;
    this.storyLang = script.startLang === 'browser' ? detectBrowserStoryLang() : null;
    this.branch = null;
    this.clearRevealTimer();

    const beatKeys = Object.keys(script.beats);
    this.state = {
      ...this.state,
      isActive: true,
      scriptId: script.id,
      history: [],
      grading: 'default',
      transitionKind: 'none',
      isTransitionCovered: false,
      isEyeBlinkActive: false,
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
    const baseBeat: LocalizedStoryBeat | undefined = this.currentScript?.beats[beatId];
    const rawBeat: LocalizedStoryBeat | undefined = baseBeat ? applyVariant(baseBeat, this.branch) : undefined;
    if (!this.currentScript || !rawBeat) {
      console.warn(`[StoryEngine] Beat not found: ${beatId}`);
      this.revealNow();
      return;
    }

    const seq = ++this.executionSequence;
    this.currentBeatId = beatId;
    // 新的一拍 = 新的一次发声机会：上一次的打断 (isInterrupted) 只对被打断的那一拍有效
    this.isInterrupted = false;
    this.wakeAutoNext?.();
    storyAudioDirector.cancelPendingSfx();

    // 按当前语言解析本拍所有文本 (getter 在这里求值)
    const lang = this.getLang();
    const beat = resolveBeat(rawBeat, lang);

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
    // 1. 画幅 / 调色 (粘性：写了才改) 与转场
    if (beat.cinematics?.letterbox !== undefined) {
      this.state.isLetterboxActive = beat.cinematics.letterbox;
    }
    if (rawBeat.cinematics?.grading !== undefined) {
      this.state.grading = rawBeat.cinematics.grading;
    }

    const transition: TransitionKind = rawBeat.cinematics?.transition ?? 'none';
    if (transition !== 'none') {
      // 通常已由 selectChoice 提前盖住 (场景切换发生在遮罩下)；直接 goToBeat 进入时在这里盖
      await this.coverFor(transition);
      if (this.executionSequence !== seq) return;
    } else {
      // 上一拍遗留的遮罩，本拍没有转场 → 立刻揭开
      this.revealNow();
    }
    this.notify();

    // 0. 重置上一拍残留的动作与对白气泡，保障本拍骨骼与对白管线纯净
    vrmEngine.stopMotion(0.4);
    vrmEngine.bubbleTracker.hide();

    // 本拍的场景 / 环境风：和转场遮罩同步，场景切换发生在遮罩之下
    if (beat.scene) {
      await this.applyScene(beat.scene);
      if (this.executionSequence !== seq) return;
    }
    if (beat.cinematics?.wind !== undefined) {
      vrmEngine.setStoryWind(beat.cinematics.wind);
    }
    if (beat.cinematics?.timeOfDay) {
      // 补间可以跨拍继续跑；只有下一段补间 / 剧终才会停掉它
      const t = beat.cinematics.timeOfDay;
      this.stopTimeOfDay();
      this.runTimeOfDay(t.from, t.to, t.durationSec ?? 8);
    }
    // 序章“叫醒”拍之后的第一拍：模型在黑幕 / 遮罩下才露出来 (叫醒拍里模型一直是隐藏的)
    if (this.modelHiddenForWake && vrmEngine.currentVRM) {
      vrmEngine.currentVRM.scene.visible = true;
      vrmEngine.settleSpringBones(vrmEngine.currentVRM);
      this.modelHiddenForWake = false;
    }
    if (beat.actor.facing === 'back') {
      vrmEngine.setFacingBackwards();
    } else if (beat.actor.facing === 'front') {
      vrmEngine.triggerBodyTurnToFront();
    }

    // 🌟 序章初见演出准备：黑幕文字界面保持空灵纯黑，角色模型暂隐，镜头保持在常规远景，绝不在未唤醒前过早聚焦
    if (beat.id === 'beat_greet') {
      if (vrmEngine.currentVRM) {
        vrmEngine.currentVRM.scene.visible = false;
        // 关键时序优化：在黑幕阶段提前就位 180 度背对朝向并触发两阶段物理碰撞松弛
        vrmEngine.setFacingBackwards();
        // 叫醒拍如果带 autoNextBeatId (只是“点一下唤醒”)：模型留到下一拍的转场遮罩下再露出
        this.modelHiddenForWake = Boolean(beat.autoNextBeatId);
      }
    }

    if (beat.cinematics?.intertitle) {
      this.state.isIntertitleActive = true;
      this.state.intertitleText = beat.cinematics.intertitle.text;
      this.state.intertitleStyle = beat.cinematics.intertitle.style || 'noto_serif';

      if (beat.cinematics.intertitle.bgmFaded) {
        storyAudioDirector.setMuffle(true);
      }

      // 默认只有序章第一拍 (beat_greet) 必须点击；其它黑幕字卡按 durationSec 自动划过
      const requireClick = beat.cinematics.intertitle.requireClick ?? (beat.id === 'beat_greet');
      this.state.intertitleRequiresClick = requireClick;
      this.notify();
      const durationMs = (beat.cinematics.intertitle.durationSec || 2.5) * 1000;
      await new Promise<void>((resolve) => {
        let timer: ReturnType<typeof setTimeout> | null = null;
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
      // 只是“点一下唤醒”的叫醒拍：先用下一拍的转场把画面盖住 (黑幕 → 睁眼遮罩无缝衔接)，再撤掉黑幕字卡
      if (beat.id === 'beat_greet' && beat.autoNextBeatId) {
        const nextTransition: TransitionKind = this.currentScript.beats[beat.autoNextBeatId]?.cinematics?.transition ?? 'none';
        await this.coverFor(nextTransition);
        if (this.executionSequence !== seq) return;
      }
      this.state.isIntertitleActive = false;
      storyAudioDirector.setMuffle(false);
      this.notify();
    }

    // 🌟 序章专属电影级运镜与转身演出 (叫醒拍带 autoNextBeatId 时不做：镜头与转身由后续拍自己编排)
    if (beat.id === 'beat_greet' && !beat.autoNextBeatId) {
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
      await this.sleep(1100);
      if (this.executionSequence !== seq) return;

      vrmEngine.triggerBodyTurnToFront();
      if (beat.actor.expression) {
        expressionController.setDirective(beat.actor.expression);
      }

      // 等待运镜平滑就位与踏步收敛
      await panPromise;
      if (this.executionSequence !== seq) return;

      // 预留 300ms 步态平息收尾
      await this.sleep(300);
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

    // 画面与镜头已就位 → 停留片刻后揭开转场遮罩 (从黑 / 白里“睁眼”)
    if (transition !== 'none') {
      this.scheduleReveal(transition, seq);
    }

    // 4. 起势动作 (0.4s Lead-in)
    // ⚠️ 规则：起势动作必须是单次非循环 (loop: false)，绝不允许死循环锁定肢体！它会自然播完，不会被开声打断。
    if (beat.actor.leadInMotion) {
      void vrmEngine.playMotion(beat.actor.leadInMotion, {
        fadeDuration: 0.6,
        loop: false,
      });
    }

    // 5. 调度 BGM / 环境声 / 音效
    if (beat.audio) {
      void storyAudioDirector.executeDirective(beat.audio);
    }

    await this.sleep(350);
    if (this.executionSequence !== seq) return;

    // ── 阶段二: 开声发音 (In-Speech) ──
    if (hasSpeech) {
      storyAudioDirector.duckBgm();
    } else {
      storyAudioDirector.restoreBgmDucking();
    }

    // 如果当前拍明确指定了全程特定动作 (例如 show-full-body 全身旋转展示)
    if (beat.actor.motion) {
      void vrmEngine.playMotion(beat.actor.motion, {
        fadeDuration: 0.75,
        loop: false,
      });
    }

    const speechStartedAt = Date.now();
    let heardSpeech = false;
    if (!this.isInterrupted && hasSpeech) {
      this.state.isSpeaking = true;
      this.notify();

      try {
        await vrmEngine.speakText(beat.actor.speechText);
        heardSpeech = true;
      } catch (e) {
        console.warn('[StoryEngine] speakText error:', e);
      }
    }

    if (this.executionSequence !== seq) return;

    // ── 阶段三 & 四: 余韵收势与递麦挂起 (Post-Act & Yield) ──
    const applySpeechEnd = () => {
      this.state.isSpeaking = false;
      // 递麦：将选项与前情提要合并在同一个微任务/渲染帧中同步发布，杜绝前后错位闪烁
      if (beat.choices && beat.choices.length > 0) {
        this.state.choices = this.decorateChoices(beat.choices);
      }
      this.notify();
    };
    // 递麦状态直接通知 React 渲染，绝不使用 document.startViewTransition 截屏，
    // 彻底杜绝 View Transitions API 栅格化冻结 3D WebGL Canvas 导致的 250ms "抽帧/卡顿"
    applySpeechEnd();

    // 手势柔和回落：仅当该拍指定了全程特定动作 (beat.actor.motion) 且本拍说过话时才显式收势；
    // 无台词的拍 (纯演出) 让动作自然播完，由下一拍开头的 stopMotion 接管。
    // 日常台词由 vrmEngine.speakText 内部 (ChatDirector.stop) 在音频播毕时自包含完成平滑淡出至 NaturalIdle。
    if (beat.actor.motion && hasSpeech) {
      vrmEngine.stopMotion(0.85);
    }

    if (beat.choices && beat.choices.length > 0) {
      // 升起晶体选项卡片，触发晶体空灵音效
      storyAudioDirector.playSfx('crystal_chime');
    }

    // ── 阶段五: 自动推进 (autoNext) ──
    // 一拍说完 (或无台词的纯演出拍演完) 后，不需要点击就进入下一拍 (autoFinish = 说完就结束整段剧情)。
    if ((beat.autoNextBeatId || beat.autoFinish) && !(beat.choices && beat.choices.length > 0)) {
      const nextId = beat.autoNextBeatId;
      const pause = beat.autoNextDelayMs ?? 600;
      // TTS 不可用 / 失败 / 静音时，说话几乎瞬间返回：按字数补足最短阅读时间，字幕不会一闪而过
      let wait = pause;
      if (hasSpeech && !this.isInterrupted) {
        const spoken = Date.now() - speechStartedAt;
        const need = heardSpeech && spoken > 800 ? 0 : minReadMs(beat.actor.speechText) - spoken;
        wait = pause + Math.max(0, need);
      }
      // 被打断 (用户插话 / 开口) = 用户接管了剧情：停止自动推进，由用户的输入 (或 AI 生成的下一拍) 决定去向
      if (this.isInterrupted) {
        storyAudioDirector.restoreBgmDucking();
        return;
      }
      // 连续自动推进的拍之间保持压低，避免 BGM 一拍一抬
      if (pause >= 1500) storyAudioDirector.restoreBgmDucking();
      if (wait > 0) await this.waitInterruptible(wait);
      if (this.executionSequence !== seq || this.isInterrupted) return;
      if (beat.autoFinish) {
        this.finish();
        return;
      }
      if (!nextId || !this.currentScript?.beats[nextId]) {
        console.warn(`[StoryEngine] autoNextBeatId not found: ${nextId}`);
        storyAudioDirector.restoreBgmDucking();
        return;
      }
      // 不 await：避免整段剧情变成一条无限嵌套的 Promise 链
      void this.goToBeat(nextId).catch((err) => console.warn('[StoryEngine] autoNext error:', err));
      return;
    }

    storyAudioDirector.restoreBgmDucking();
  }

  // ───────────────────────── 场景 / 镜头任务 / 输入推进 ─────────────────────────

  /** 环境时间平滑补间 (引擎的 setEnvironmentTime 本身是瞬切，这里用定时器逐帧推；终帧才落盘，过程中不写存档) */
  private runTimeOfDay(from: number | undefined, to: number, durationSec: number): void {
    const start = from ?? to;
    if (from === undefined || durationSec <= 0) {
      vrmEngine.setEnvironmentTime(to);
      return;
    }
    const t0 = Date.now();
    const ms = durationSec * 1000;
    vrmEngine.setEnvironmentTime(start, { isDragging: true });
    const step = () => {
      const p = Math.min(1, (Date.now() - t0) / ms);
      const e = p * p * (3 - 2 * p);
      vrmEngine.setEnvironmentTime(start + (to - start) * e, { isDragging: p < 1 });
      this.hourTimer = p < 1 ? setTimeout(step, 40) : null;
    };
    this.hourTimer = setTimeout(step, 40);
  }

  private stopTimeOfDay(): void {
    if (this.hourTimer) clearTimeout(this.hourTimer);
    this.hourTimer = null;
  }

  /** 切到剧本场景 (别名或真实 id)，已经在该场景就什么也不做 */
  private async applyScene(name: string, persist = false): Promise<void> {
    const id = resolveStoryScene(name);
    if (sceneManager.getCurrentSceneId() === id) return;
    await sceneManager.setScene(id, persist);
  }

  /** 给选项加上“当前已选”高亮 (换装 / 场景 / 语言) */
  private decorateChoices(choices: StoryChoice[]): StoryChoice[] {
    const currentOutfit = vrmEngine.currentOutfitKey || 'xiaochun_dinner_dress';
    const currentScene = sceneManager.getCurrentSceneId();
    const lang = this.getLang();
    return choices.map((c) => {
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
      if (c.actionType === 'change_lang') {
        return { ...c, selected: c.actionPayload === lang };
      }
      return c;
    });
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
        const outfitChoices = this.resolvedChoicesOf('beat_outfit_choice');
        const worn = outfitChoices.find(
          (c) =>
            c.actionPayload === currentOutfit ||
            c.id === currentOutfit ||
            (currentOutfit.includes('dress') && c.id === 'outfit_dress') ||
            (currentOutfit.includes('maid') && c.id === 'outfit_maid') ||
            (currentOutfit.includes('cheongsam') && c.id === 'outfit_qipao')
        );
        if (worn?.text) {
          historyText = HISTORY_TEXT[this.getLang()].outfit(worn.text);
        }
      } else if (choice.id === 'scene_confirm') {
        const currentScene = sceneManager.getCurrentSceneId();
        const sceneChoices = this.resolvedChoicesOf('beat_scene_choice');
        const picked = sceneChoices.find(
          (c) =>
            c.actionPayload === currentScene ||
            c.id === `scene_${currentScene}` ||
            (currentScene === 'beach3d' && c.id === 'scene_beach')
        );
        if (picked?.text) {
          historyText = HISTORY_TEXT[this.getLang()].scene(picked.text);
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

    // 下一拍带转场 (white_flash / fade_to_black / eye_blink)：先盖住画面再执行动作，
    // 这样场景切换 / 换装 / 自定义回调都发生在遮罩之下，不会在画面上“跳”一下。
    const nextRaw = choice.nextBeatId ? this.currentScript?.beats[choice.nextBeatId] : undefined;
    const nextTransition: TransitionKind = nextRaw?.cinematics?.transition ?? 'none';
    const advances = choice.actionType !== 'finish' && choice.actionType !== 'open_provider_config' && !isPreviewAction;
    if (advances && nextTransition !== 'none') {
      await this.coverFor(nextTransition);
    }

    if (choice.branch) this.branch = choice.branch;
    if (choice.scene && advances) {
      if (choice.sceneHour !== undefined) vrmEngine.setEnvironmentTime(choice.sceneHour);
      await this.applyScene(choice.scene, true);
    }

    if (choice.actionType === 'change_lang' && choice.actionPayload) {
      // 台词语言由引擎自己持有 (同步生效，下一拍立刻用新语言)；同时让 UI 语言与 Cookie 一起切换
      this.storyLang = normalizeStoryLang(String(choice.actionPayload));
      if (this.i18nInstance) {
        changeLang(this.i18nInstance, this.storyLang);
      }
    } else if (choice.actionType === 'change_scene' && choice.actionPayload) {
      if (choice.sceneHour !== undefined) vrmEngine.setEnvironmentTime(choice.sceneHour);
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
    } else {
      this.revealNow();
    }
  }

  /** 取某一拍的选项 (按当前语言解析)，用于历史记录里显示“换上「…」” */
  private resolvedChoicesOf(beatId: string): StoryChoice[] {
    const raw = this.currentScript?.beats[beatId];
    if (!raw?.choices) return [];
    const lang = this.getLang();
    return raw.choices.map((c) => resolveChoice(c, lang));
  }

  /**
   * 全双工打断：立即叫停当前语音表演并收势递麦
   */
  public interrupt(): void {
    this.isInterrupted = true;
    vrmEngine.stopSpeaking();
    cameraDirector.stopTransition();
    storyAudioDirector.restoreBgmDucking();
    storyAudioDirector.cancelPendingSfx();
    // 若正处于 autoNext 的停顿里，立刻往下走
    this.wakeAutoNext?.();

    const applyInterruptState = () => {
      this.state.isSpeaking = false;
      this.state.isIntertitleActive = false;

      // 若当前拍已有选项，打断后立即展开选项
      if (this.state.currentBeat?.choices && this.state.choices.length === 0) {
        this.state.choices = this.decorateChoices(this.state.currentBeat.choices);
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
    this.clearRevealTimer();
    // 导演放手 + 平滑回到刷新页面后的默认视角 (镜头 / 视距 / FOV / 滚转 / 阵风 / 角色朝向)；场景与环境时间保持不变。
    // 遮幅 / 调色 / 转场在下面的 state 里清零。先还原故事期间被教学拖拽改写的视角偏好，回正才会落到同一个视角。
    if (this.viewPrefs) {
      vrmEngine.restoreViewPrefs(this.viewPrefs);
      this.viewPrefs = null;
    }
    void vrmEngine.returnToDefaultView();
    vrmEngine.setStoryWind(0);
    this.branch = null;
    this.stopTimeOfDay();
    this.modelHiddenForWake = false;
    expressionController.setActive(false);
    this.state = {
      ...this.state,
      isActive: false,
      scriptId: null,
      isLetterboxActive: false,
      isIntertitleActive: false,
      isEyeBlinkActive: false,
      isTransitionCovered: false,
      transitionKind: 'none',
      grading: 'default',
      choices: [],
      currentBeat: null,
      currentBeatId: null,
    };
    this.notify();
    storyAudioDirector.stopAll(1.2);
  }
}

export const storyDirectorEngine = new StoryDirectorEngine();
