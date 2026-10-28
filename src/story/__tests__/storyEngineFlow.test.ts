import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => ({
  speakText: vi.fn(),
  stopSpeaking: vi.fn(),
  playMotion: vi.fn(),
  stopMotion: vi.fn(),
  changeLang: vi.fn(),
  setScene: vi.fn(),
  currentScene: { id: 'void' },
  setStoryWind: vi.fn(),
  setEnvironmentTime: vi.fn(),
  getViewSample: vi.fn(),
  visibility: { visible: true },
  triggerBodyTurnToFront: vi.fn(),
  setFacingBackwards: vi.fn(),
  audio: {
    unlock: vi.fn(),
    duckBgm: vi.fn(),
    restoreBgmDucking: vi.fn(),
    setMuffle: vi.fn(),
    playSfx: vi.fn(),
    executeDirective: vi.fn(),
    cancelPendingSfx: vi.fn(),
    stopAll: vi.fn(),
  },
  view: {
    captureViewPrefs: vi.fn(),
    restoreViewPrefs: vi.fn(),
    returnToDefaultView: vi.fn(),
    cancelViewReturn: vi.fn(),
  },
  camera: {
    transitionTo: vi.fn(),
    stopTransition: vi.fn(),
    reset: vi.fn(),
    preparePanUpStart: vi.fn(),
    panUpReveal: vi.fn(),
  },
}));

vi.mock('@/core/vrmEngine', () => ({
  vrmEngine: {
    speakText: h.speakText,
    stopSpeaking: h.stopSpeaking,
    playMotion: h.playMotion,
    stopMotion: h.stopMotion,
    bubbleTracker: { hide: vi.fn() },
    currentVRM: { scene: h.visibility },
    setStoryWind: h.setStoryWind,
    setEnvironmentTime: h.setEnvironmentTime,
    getViewSample: h.getViewSample,
    currentOutfitKey: 'xiaochun_dinner_dress',
    swapOutfit: vi.fn(),
    setFacingBackwards: h.setFacingBackwards,
    settleSpringBones: vi.fn(),
    triggerBodyTurnToFront: h.triggerBodyTurnToFront,
    ...h.view,
  },
}));
vi.mock('@/core/scene/sceneManager', () => ({
  sceneManager: { getCurrentSceneId: () => h.currentScene.id, setScene: h.setScene },
}));
vi.mock('@/core/scene/cameraDirector', () => ({ cameraDirector: h.camera }));
vi.mock('@/core/morph/expressionController', () => ({
  expressionController: { setDirective: vi.fn(), setActive: vi.fn() },
}));
vi.mock('@/story/audioDirector', () => ({ storyAudioDirector: h.audio }));
vi.mock('@/i18n', () => ({ changeLang: h.changeLang, readClientLang: () => 'zh-CN' }));

import { StoryDirectorEngine } from '../storyEngine';
import { TRANSITION_SPECS } from '../transitions';

const actor = (speechText: unknown) => ({
  expression: { base: 'neutral' as const, intensity: 0.5, microReaction: 'none' as const },
  speechText: speechText as string,
});

/** 一个说话要 `ms` 毫秒的 TTS */
const speaksFor = (ms: number) => h.speakText.mockImplementation(() => new Promise<void>((r) => setTimeout(r, ms)));

describe('StoryDirectorEngine runtime behaviour', () => {
  let engine: StoryDirectorEngine;

  beforeEach(() => {
    vi.useFakeTimers();
    Object.values(h.audio).forEach((f) => f.mockReset());
    h.speakText.mockReset();
    h.stopSpeaking.mockReset();
    h.playMotion.mockReset();
    h.stopMotion.mockReset();
    h.changeLang.mockReset();
    h.setScene.mockReset().mockResolvedValue(undefined);
    h.currentScene.id = 'void';
    h.setStoryWind.mockReset();
    h.setEnvironmentTime.mockReset();
    h.getViewSample.mockReset().mockReturnValue({ azimuth: 0, polar: Math.PI / 2, yaw: 0, distance: 2 });
    h.visibility.visible = true;
    h.triggerBodyTurnToFront.mockReset();
    h.setFacingBackwards.mockReset();
    h.camera.transitionTo.mockReset().mockResolvedValue(undefined);
    h.camera.stopTransition.mockReset();
    h.view.captureViewPrefs.mockReset().mockReturnValue({ snap: 'before-story' });
    h.view.restoreViewPrefs.mockReset();
    h.view.returnToDefaultView.mockReset().mockResolvedValue(undefined);
    h.view.cancelViewReturn.mockReset();
    engine = new StoryDirectorEngine();
  });

  afterEach(() => {
    engine.finish();
    vi.useRealTimers();
  });

  describe('i18n', () => {
    const script = {
      id: 's',
      title: { 'zh-CN': '标题', en: 'Title' },
      initialBeatId: 'a',
      beats: {
        a: {
          id: 'a',
          actor: actor({ 'zh-CN': '你好', en: 'Hello', ja: 'やあ' }),
          choices: [
            { id: 'zh', text: '中文', actionType: 'change_lang', actionPayload: 'zh-CN', nextBeatId: 'b' },
            { id: 'ja', text: '日本語', actionType: 'change_lang', actionPayload: 'ja', nextBeatId: 'b' },
          ],
        },
        b: { id: 'b', actor: actor({ 'zh-CN': '下一句', en: 'Next', ja: '次' }) },
      },
    };

    it('plays the beat in the i18n language and speaks that text', async () => {
      engine.setI18n({ language: 'en', resolvedLanguage: 'en' } as never);
      const p = engine.playScript(script as never);
      await vi.advanceTimersByTimeAsync(400);
      await p;
      expect(h.speakText).toHaveBeenCalledWith('Hello');
      expect(engine.getState().currentBeat?.actor.speechText).toBe('Hello');
    });

    it('change_lang switches the story language synchronously for the next beat and mirrors it to the UI', async () => {
      engine.setI18n({ language: 'en', resolvedLanguage: 'en' } as never);
      const p = engine.playScript(script as never);
      await vi.advanceTimersByTimeAsync(400);
      await p;
      // en 被标为已选
      expect(engine.getState().choices.find((c) => c.id === 'zh')?.selected).toBe(false);

      const jaChoice = engine.getState().choices.find((c) => c.id === 'ja')!;
      const sel = engine.selectChoice(jaChoice);
      await vi.advanceTimersByTimeAsync(400);
      await sel;
      expect(h.changeLang).toHaveBeenCalledWith(expect.anything(), 'ja');
      expect(engine.getLang()).toBe('ja');
      expect(h.speakText).toHaveBeenLastCalledWith('次');
    });
  });

  describe('autoNextBeatId', () => {
    const script = {
      id: 's',
      title: 't',
      initialBeatId: 'a',
      beats: {
        a: { id: 'a', actor: actor('one'), autoNextBeatId: 'b', autoNextDelayMs: 500 },
        b: { id: 'b', actor: actor('two'), autoNextBeatId: 'c', autoNextDelayMs: 100 },
        c: { id: 'c', actor: actor('three'), choices: [{ id: 'x', text: 'x', nextBeatId: 'a' }] },
      },
    };

    it('advances through consecutive beats without any click, honouring the pause after speech', async () => {
      speaksFor(1000);
      void engine.playScript(script as never);
      await vi.advanceTimersByTimeAsync(350 + 1000);
      expect(engine.getState().currentBeatId).toBe('a'); // 说完了但停顿还没过
      await vi.advanceTimersByTimeAsync(500);
      expect(engine.getState().currentBeatId).toBe('b');
      await vi.advanceTimersByTimeAsync(350 + 1000 + 100);
      expect(engine.getState().currentBeatId).toBe('c');
      await vi.advanceTimersByTimeAsync(350 + 1000);
      // 有选项的拍不会自动离开，选项递出
      expect(engine.getState().currentBeatId).toBe('c');
      expect(engine.getState().choices).toHaveLength(1);
    });

    it('still gives subtitles a minimum reading time when TTS fails instantly', async () => {
      h.speakText.mockRejectedValue(new Error('tts down'));
      void engine.playScript(script as never);
      await vi.advanceTimersByTimeAsync(350 + 500 + 100);
      expect(engine.getState().currentBeatId).toBe('a'); // 没有一闪而过
      await vi.advanceTimersByTimeAsync(5000);
      expect(engine.getState().currentBeatId).not.toBe('a');
    });

    it('stops auto-advancing when the user interrupts (the user takes over the story)', async () => {
      speaksFor(2000);
      void engine.playScript(script as never);
      await vi.advanceTimersByTimeAsync(350 + 500);
      engine.interrupt();
      await vi.advanceTimersByTimeAsync(10000);
      expect(engine.getState().currentBeatId).toBe('a');
    });

    it('autoNext on a silent beat waits only the configured pause', async () => {
      const silent = {
        id: 's2',
        title: 't',
        initialBeatId: 'a',
        beats: {
          a: { id: 'a', actor: actor(''), autoNextBeatId: 'b', autoNextDelayMs: 2000 },
          b: { id: 'b', actor: actor('') },
        },
      };
      void engine.playScript(silent as never);
      await vi.advanceTimersByTimeAsync(350 + 1900);
      expect(engine.getState().currentBeatId).toBe('a');
      await vi.advanceTimersByTimeAsync(200);
      expect(engine.getState().currentBeatId).toBe('b');
    });
  });

  describe('interruption', () => {
    it('resets the interrupted flag on the next beat so later lines are spoken again', async () => {
      const script = {
        id: 's',
        title: 't',
        initialBeatId: 'a',
        beats: {
          a: { id: 'a', actor: actor('first'), choices: [{ id: 'go', text: 'go', nextBeatId: 'b' }] },
          b: { id: 'b', actor: actor('second') },
        },
      };
      speaksFor(3000);
      void engine.playScript(script as never);
      await vi.advanceTimersByTimeAsync(600);
      engine.interrupt();
      expect(engine.getIsInterrupted()).toBe(true);
      await vi.advanceTimersByTimeAsync(10);
      h.speakText.mockClear();
      speaksFor(100);
      const go = engine.selectChoice({ id: 'go', text: 'go', nextBeatId: 'b' } as never);
      await vi.advanceTimersByTimeAsync(600);
      await go;
      expect(engine.getIsInterrupted()).toBe(false);
      expect(h.speakText).toHaveBeenCalledWith('second');
    });
  });

  describe('motions', () => {
    it('lets a lead-in clip finish by itself and keeps a silent beat’s motion playing', async () => {
      const script = {
        id: 's',
        title: 't',
        initialBeatId: 'a',
        beats: {
          a: { id: 'a', actor: { ...actor('hi'), leadInMotion: 'pokeFingers' } },
          b: { id: 'b', actor: { ...actor(''), motion: 'gazeObserve' } },
        },
      };
      speaksFor(500);
      void engine.playScript(script as never);
      await vi.advanceTimersByTimeAsync(1500);
      expect(h.playMotion).toHaveBeenCalledWith('pokeFingers', expect.objectContaining({ loop: false }));
      expect(h.stopMotion).not.toHaveBeenCalledWith(0.75);
      h.stopMotion.mockClear();
      void engine.goToBeat('b');
      await vi.advanceTimersByTimeAsync(1500);
      expect(h.playMotion).toHaveBeenCalledWith('gazeObserve', expect.anything());
      expect(h.stopMotion).not.toHaveBeenCalledWith(0.85);
    });
  });

  describe('transitions and grading', () => {
    const script = (transition: 'white_flash' | 'fade_to_black' | 'eye_blink') => ({
      id: 's',
      title: 't',
      initialBeatId: 'a',
      beats: {
        a: { id: 'a', actor: actor(''), choices: [] },
        b: { id: 'b', cinematics: { transition, grading: 'dream_bloom' }, actor: actor('') },
        c: { id: 'c', cinematics: { grading: 'default' }, actor: actor('') },
      },
    });

    it.each(['white_flash', 'fade_to_black', 'eye_blink'] as const)(
      '%s covers the screen BEFORE a choice action runs, then reveals it',
      async (kind) => {
        void engine.playScript(script(kind) as never);
        await vi.advanceTimersByTimeAsync(400);

        let coveredWhenActionRan: boolean | null = null;
        let kindWhenActionRan: string | null = null;
        const action = vi.fn(() => {
          coveredWhenActionRan = engine.getState().isTransitionCovered;
          kindWhenActionRan = engine.getState().transitionKind;
        });
        const sel = engine.selectChoice({ id: 'x', text: 'x', actionType: 'custom', actionPayload: action, nextBeatId: 'b' } as never);
        await vi.advanceTimersByTimeAsync(TRANSITION_SPECS[kind].coverMs + 50);
        expect(action).toHaveBeenCalledTimes(1);
        expect(coveredWhenActionRan).toBe(true);
        expect(kindWhenActionRan).toBe(kind);
        expect(engine.getState().isEyeBlinkActive).toBe(kind === 'eye_blink');

        await vi.advanceTimersByTimeAsync(2000);
        await sel;
        expect(engine.getState().currentBeatId).toBe('b');
        expect(engine.getState().isTransitionCovered).toBe(false);
      },
    );

    it('grading is sticky until changed and resets on finish', async () => {
      void engine.playScript(script('white_flash') as never);
      await vi.advanceTimersByTimeAsync(400);
      void engine.goToBeat('b');
      await vi.advanceTimersByTimeAsync(1500);
      expect(engine.getState().grading).toBe('dream_bloom');
      void engine.goToBeat('c');
      await vi.advanceTimersByTimeAsync(500);
      expect(engine.getState().grading).toBe('default');
      void engine.goToBeat('b');
      await vi.advanceTimersByTimeAsync(1500);
      expect(engine.getState().grading).toBe('dream_bloom');
      engine.finish();
      expect(engine.getState().grading).toBe('default');
      expect(engine.getState().isTransitionCovered).toBe(false);
    });
  });

  describe('audio', () => {
    it('unlocks the AudioContext inside the tap gesture and ducks BGM only while speaking', async () => {
      engine.skipIntertitle();
      expect(h.audio.unlock).toHaveBeenCalledTimes(1);

      const script = {
        id: 's',
        title: 't',
        initialBeatId: 'a',
        beats: { a: { id: 'a', actor: actor('hello'), audio: { bgmMood: 'dusk_warm' } } },
      };
      speaksFor(500);
      void engine.playScript(script as never);
      await vi.advanceTimersByTimeAsync(1200);
      expect(h.audio.executeDirective).toHaveBeenCalledWith({ bgmMood: 'dusk_warm' });
      expect(h.audio.duckBgm).toHaveBeenCalled();
      expect(h.audio.restoreBgmDucking).toHaveBeenCalled();
    });

    it('stops all sound when the story finishes', () => {
      engine.finish();
      expect(h.audio.stopAll).toHaveBeenCalled();
    });
  });

  describe('leaving the story returns to the refreshed default view', () => {
    const script = {
      id: 'exit',
      title: 't',
      initialBeatId: 'a',
      beats: {
        a: {
          id: 'a',
          actor: actor(''),
          cinematics: { letterbox: true, grading: 'dream_bloom', transition: 'white_flash' },
          camera: { shot: 'medium', movement: 'dutch_tilt', durationSec: 1, windMultiplier: 2 },
          autoNextBeatId: 'a',
        },
      },
    };

    it('finish restores the saved view prefs first, then eases back, and clears every cinematic effect', async () => {
      void engine.playScript(script as never);
      await vi.advanceTimersByTimeAsync(1500);
      expect(h.view.cancelViewReturn).toHaveBeenCalled();
      expect(engine.getState().isLetterboxActive).toBe(true);
      expect(engine.getState().grading).toBe('dream_bloom');

      engine.finish();
      expect(h.view.restoreViewPrefs).toHaveBeenCalledWith({ snap: 'before-story' });
      expect(h.view.returnToDefaultView).toHaveBeenCalledTimes(1);
      expect(h.view.restoreViewPrefs.mock.invocationCallOrder[0]).toBeLessThan(h.view.returnToDefaultView.mock.invocationCallOrder[0]);
      const s = engine.getState();
      expect(s.isActive).toBe(false);
      expect(s.isLetterboxActive).toBe(false);
      expect(s.grading).toBe('default');
      expect(s.transitionKind).toBe('none');
      expect(s.isTransitionCovered).toBe(false);
      expect(h.camera.stopTransition).toHaveBeenCalled();
    });

    it('snapshots the prefs once per story even if the script is started twice, and a second finish does not restore again', async () => {
      void engine.playScript(script as never);
      await vi.advanceTimersByTimeAsync(100);
      void engine.playScript(script as never);
      await vi.advanceTimersByTimeAsync(100);
      expect(h.view.captureViewPrefs).toHaveBeenCalledTimes(1);
      engine.finish();
      engine.finish();
      expect(h.view.restoreViewPrefs).toHaveBeenCalledTimes(1);
    });

    it('also returns the view when the player skips or exits (same finish path)', () => {
      engine.finish();
      expect(h.view.returnToDefaultView).toHaveBeenCalledTimes(1);
    });
  });

  describe('browser start language', () => {
    const script = (startLang?: 'browser') => ({
      id: 'sl',
      title: 't',
      startLang,
      initialBeatId: 'a',
      beats: { a: { id: 'a', actor: actor({ 'zh-CN': '你好', en: 'Hello', ja: 'やあ' }) } },
    });

    it('startLang: browser plays in the browser language and falls back to en for anything else', async () => {
      engine.setI18n({ language: 'zh-CN', resolvedLanguage: 'zh-CN' } as never);
      vi.stubGlobal('navigator', { languages: ['ja-JP', 'en-US'], language: 'ja-JP' });
      void engine.playScript(script('browser') as never);
      await vi.advanceTimersByTimeAsync(600);
      expect(engine.getLang()).toBe('ja');
      expect(h.speakText).toHaveBeenLastCalledWith('やあ');
      engine.finish();

      vi.stubGlobal('navigator', { languages: ['fr-FR'], language: 'fr-FR' });
      void engine.playScript(script('browser') as never);
      await vi.advanceTimersByTimeAsync(600);
      expect(engine.getLang()).toBe('en');
      expect(h.speakText).toHaveBeenLastCalledWith('Hello');
      // 没有选语言之前不动 UI 语言
      expect(h.changeLang).not.toHaveBeenCalled();
      vi.unstubAllGlobals();
    });

    it('without startLang the UI language still wins', async () => {
      engine.setI18n({ language: 'zh-CN', resolvedLanguage: 'zh-CN' } as never);
      vi.stubGlobal('navigator', { languages: ['ja-JP'], language: 'ja-JP' });
      void engine.playScript(script() as never);
      await vi.advanceTimersByTimeAsync(600);
      expect(engine.getLang()).toBe('zh-CN');
      vi.unstubAllGlobals();
    });
  });

  describe('wake-only greet', () => {
    const script = {
      id: 'wake',
      title: 't',
      initialBeatId: 'beat_greet',
      beats: {
        beat_greet: {
          id: 'beat_greet',
          cinematics: { letterbox: true, intertitle: { text: 'wake', durationSec: 0, requireClick: true } },
          actor: actor(''),
          autoNextBeatId: 'one',
          autoNextDelayMs: 0,
        },
        one: {
          id: 'one',
          scene: 'lineart_day',
          cinematics: { transition: 'eye_blink' },
          actor: actor('first line'),
        },
      },
    };

    it('hides the model until the tap, covers with the next beat\'s transition, then reveals her under the cover', async () => {
      void engine.playScript(script as never);
      await vi.advanceTimersByTimeAsync(100);
      expect(h.visibility.visible).toBe(false);
      expect(h.setFacingBackwards).toHaveBeenCalled();
      expect(engine.getState().isIntertitleActive).toBe(true);
      expect(h.camera.panUpReveal).not.toHaveBeenCalled();

      engine.skipIntertitle();
      expect(h.audio.unlock).toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(TRANSITION_SPECS.eye_blink.coverMs + 20);
      // 黑幕撤掉之前，眨眼遮罩已经盖住画面
      expect(engine.getState().isTransitionCovered).toBe(true);
      expect(engine.getState().transitionKind).toBe('eye_blink');
      expect(engine.getState().isIntertitleActive).toBe(false);

      await vi.advanceTimersByTimeAsync(800);
      expect(engine.getCurrentBeatId()).toBe('one');
      expect(h.visibility.visible).toBe(true);
      expect(h.setScene).toHaveBeenCalledWith('light', false); // lineart_day → light，不写入存档
      expect(h.speakText).toHaveBeenCalledWith('first line');
      expect(h.camera.panUpReveal).not.toHaveBeenCalled();
      expect(h.triggerBodyTurnToFront).not.toHaveBeenCalled();
    });
  });

  describe('beat scene, wind and facing', () => {
    it('applies the beat scene (not persisted), the wind level (sticky) and the facing', async () => {
      const script = {
        id: 'sw',
        title: 't',
        initialBeatId: 'a',
        beats: {
          a: { id: 'a', scene: 'beach', cinematics: { wind: 3 }, actor: { ...actor(''), facing: 'back' } },
          b: { id: 'b', actor: { ...actor(''), facing: 'front' } },
        },
      };
      void engine.playScript(script as never);
      await vi.advanceTimersByTimeAsync(500);
      expect(h.setScene).toHaveBeenCalledWith('beach3d', false);
      expect(h.setStoryWind).toHaveBeenCalledWith(3);
      expect(h.setFacingBackwards).toHaveBeenCalledTimes(1);

      void engine.goToBeat('b');
      await vi.advanceTimersByTimeAsync(500);
      expect(h.setStoryWind).toHaveBeenCalledTimes(1); // 没写 wind = 不改
      expect(h.triggerBodyTurnToFront).toHaveBeenCalledTimes(1);

      engine.finish();
      expect(h.setStoryWind).toHaveBeenLastCalledWith(0);
    });

    it('skips a scene switch when already in that scene', async () => {
      h.currentScene.id = 'light';
      const script = { id: 's', title: 't', initialBeatId: 'a', beats: { a: { id: 'a', scene: 'lineart_day', actor: actor('') } } };
      void engine.playScript(script as never);
      await vi.advanceTimersByTimeAsync(500);
      expect(h.setScene).not.toHaveBeenCalled();
    });
  });

  describe('per-choice scene branch', () => {
    const script = {
      id: 'br',
      title: 't',
      initialBeatId: 'pick',
      beats: {
        pick: {
          id: 'pick',
          actor: actor('choose'),
          choices: [
            { id: 'beach', text: 'Beach', actionType: 'next_beat', branch: 'beach', scene: 'beach', sceneHour: 14.5, nextBeatId: 'out' },
            { id: 'night', text: 'Night', actionType: 'next_beat', branch: 'night', scene: 'lineart_night', nextBeatId: 'out' },
          ],
        },
        out: {
          id: 'out',
          cinematics: { transition: 'white_flash', grading: 'default', wind: 3 },
          audio: { bgmMood: 'bright', sfx: [{ id: 'waves', delaySec: 0.1 }] },
          actor: actor('out base'),
          variants: {
            night: { cinematics: { grading: 'rainy_noir', wind: 2 }, audio: { bgmMood: 'mystic', sfx: [{ id: 'bell', delaySec: 0.1 }] } },
          },
        },
      },
    };

    const pick = async (id: string) => {
      void engine.playScript(script as never);
      await vi.advanceTimersByTimeAsync(500);
      const sel = engine.selectChoice(engine.getState().choices.find((c) => c.id === id)!);
      await vi.advanceTimersByTimeAsync(2000);
      await sel;
    };

    it('beach: switches under the white flash with the base grading / wind / BGM / SFX', async () => {
      await pick('beach');
      expect(h.setEnvironmentTime).toHaveBeenCalledWith(14.5);
      expect(h.setScene).toHaveBeenCalledWith('beach3d', true);
      expect(h.setEnvironmentTime.mock.invocationCallOrder[0]).toBeLessThan(h.setScene.mock.invocationCallOrder[0]);
      expect(engine.getState().grading).toBe('default');
      expect(h.setStoryWind).toHaveBeenLastCalledWith(3);
      expect(h.audio.executeDirective).toHaveBeenLastCalledWith({ bgmMood: 'bright', sfx: [{ id: 'waves', delaySec: 0.1 }] });
    });

    it('night: same beat, different scene / grading / wind / BGM / SFX', async () => {
      await pick('night');
      expect(h.setEnvironmentTime).not.toHaveBeenCalled();
      expect(h.setScene).toHaveBeenCalledWith('dark', true);
      expect(engine.getState().grading).toBe('rainy_noir');
      expect(h.setStoryWind).toHaveBeenLastCalledWith(2);
      expect(h.audio.executeDirective).toHaveBeenLastCalledWith({ bgmMood: 'mystic', sfx: [{ id: 'bell', delaySec: 0.1 }] });
      expect(engine.getState().currentBeat?.actor.speechText).toBe('out base');
    });

    it('the branch is cleared when the story is replayed', async () => {
      await pick('night');
      engine.finish();
      void engine.playScript(script as never);
      await vi.advanceTimersByTimeAsync(500);
      void engine.goToBeat('out');
      await vi.advanceTimersByTimeAsync(2000);
      expect(engine.getState().grading).toBe('default');
    });
  });

  describe('camera task', () => {
    const script = {
      id: 'ct',
      title: 't',
      initialBeatId: 'task',
      beats: {
        task: {
          id: 'task',
          hint: 'orbit',
          actor: actor('look at me'),
          camera: { shot: 'medium', movement: 'dutch_tilt', durationSec: 2 },
          cameraTask: {
            orbitDeg: 35,
            zoomRatio: 0.2,
            timeoutMs: 6000,
            nextBeatId: 'after',
            fallback: {
              camera: { shot: 'full', movement: 'orbit_subtle', durationSec: 2 },
              motion: 'showFullBody',
              expression: { base: 'playful', intensity: 0.8 },
              speechText: 'fine, I will spin myself',
              afterMs: 500,
            },
          },
        },
        after: { id: 'after', actor: actor('next beat') },
      },
    };

    it('advances as soon as the user has orbited 35° (no fallback line)', async () => {
      void engine.playScript(script as never);
      await vi.advanceTimersByTimeAsync(1000);
      expect(engine.getCurrentBeatId()).toBe('task');
      h.getViewSample.mockReturnValue({ azimuth: 0, polar: Math.PI / 2, yaw: (40 * Math.PI) / 180, distance: 2 });
      await vi.advanceTimersByTimeAsync(800);
      expect(engine.getCurrentBeatId()).toBe('after');
      expect(h.speakText).not.toHaveBeenCalledWith('fine, I will spin myself');
      expect(h.speakText).toHaveBeenLastCalledWith('next beat');
    });

    it('advances on a 20% zoom change too', async () => {
      void engine.playScript(script as never);
      await vi.advanceTimersByTimeAsync(1000);
      h.getViewSample.mockReturnValue({ azimuth: 0, polar: Math.PI / 2, yaw: 0, distance: 2.5 });
      await vi.advanceTimersByTimeAsync(300);
      expect(engine.getCurrentBeatId()).toBe('after');
    });

    it('does not count the director\'s own camera move as user input (waits for it, then measures from there)', async () => {
      let finishMove: () => void = () => undefined;
      h.camera.transitionTo.mockImplementation(() => new Promise<void>((r) => { finishMove = r; }));
      void engine.playScript(script as never);
      await vi.advanceTimersByTimeAsync(1000);
      // 运镜还没结束：视角在变，但不算用户操作；超时计时也还没开始
      h.getViewSample.mockReturnValue({ azimuth: 1, polar: Math.PI / 2, yaw: 0, distance: 3 });
      await vi.advanceTimersByTimeAsync(8000);
      expect(engine.getCurrentBeatId()).toBe('task');
      finishMove();
      await vi.advanceTimersByTimeAsync(300);
      expect(engine.getCurrentBeatId()).toBe('task'); // 从运镜结束的视角算起，用户还没动
    });

    it('after 6000ms without input: camera move + playful + one fallback line, then auto-advances', async () => {
      void engine.playScript(script as never);
      await vi.advanceTimersByTimeAsync(1000);
      h.camera.transitionTo.mockClear();
      await vi.advanceTimersByTimeAsync(4500);
      expect(h.speakText).not.toHaveBeenCalledWith('fine, I will spin myself');
      expect(engine.getCurrentBeatId()).toBe('task');

      await vi.advanceTimersByTimeAsync(1800);
      expect(h.speakText).toHaveBeenCalledWith('fine, I will spin myself');
      expect(h.camera.transitionTo).toHaveBeenCalledWith({ shot: 'full', movement: 'orbit_subtle', durationSec: 2 });
      expect(h.playMotion).toHaveBeenCalledWith('showFullBody', expect.anything());
      expect(engine.getState().history.some((e) => e.text === 'fine, I will spin myself')).toBe(true);
      await vi.advanceTimersByTimeAsync(3000);
      expect(engine.getCurrentBeatId()).toBe('after');
      expect(h.speakText.mock.calls.filter((c) => c[0] === 'fine, I will spin myself')).toHaveLength(1);
    });

    it('a later beat cancels a pending task (no stray fallback)', async () => {
      void engine.playScript(script as never);
      await vi.advanceTimersByTimeAsync(1000);
      void engine.goToBeat('after');
      await vi.advanceTimersByTimeAsync(10000);
      expect(h.speakText).not.toHaveBeenCalledWith('fine, I will spin myself');
    });
  });

  describe('input advance (canned reply, no LLM)', () => {
    const script = {
      id: 'in',
      title: 't',
      initialBeatId: 'ask',
      beats: {
        ask: {
          id: 'ask',
          allowInput: true,
          actor: actor('say something'),
          inputReply: {
            speechText: 'copy that',
            expression: { base: 'playful', intensity: 0.9 },
            camera: { shot: 'close_up', movement: 'arc_sweep', durationSec: 1.5 },
            nextBeatId: 'done',
            afterMs: 500,
          },
        },
        done: { id: 'done', actor: actor('wrapping up') },
      },
    };

    it('waits for the user, then plays the reply once and moves on', async () => {
      void engine.playScript(script as never);
      await vi.advanceTimersByTimeAsync(2000);
      expect(engine.getCurrentBeatId()).toBe('ask'); // 不会自己往下走

      const consumed = engine.submitScriptedInput('  hello there ');
      await vi.advanceTimersByTimeAsync(100);
      expect(h.speakText).toHaveBeenCalledWith('copy that');
      expect(h.camera.transitionTo).toHaveBeenCalledWith({ shot: 'close_up', movement: 'arc_sweep', durationSec: 1.5 });
      const hist = engine.getState().history.map((e) => [e.role, e.text]);
      expect(hist).toContainEqual(['user', 'hello there']);
      expect(hist).toContainEqual(['xiaochun', 'copy that']);

      await vi.advanceTimersByTimeAsync(8000); // TTS 瞬间返回时，按字数补足最短阅读时间
      expect(await consumed).toBe(true);
      expect(engine.getCurrentBeatId()).toBe('done');
      // 第二次输入不再被接管 (已经不在这一拍)
      expect(await engine.submitScriptedInput('again')).toBe(false);
    });

    it('only the first input counts, empty input is ignored, and beats without a reply are not hijacked', async () => {
      void engine.playScript(script as never);
      await vi.advanceTimersByTimeAsync(2000);
      expect(await engine.submitScriptedInput('   ')).toBe(false);
      const first = engine.submitScriptedInput('one');
      expect(await engine.submitScriptedInput('two')).toBe(false);
      await vi.advanceTimersByTimeAsync(3000);
      await first;
      expect(h.speakText.mock.calls.filter((c) => c[0] === 'copy that')).toHaveLength(1);
      expect(await engine.submitScriptedInput('three')).toBe(false); // 现在是 done 拍
    });

    it('an input while she is still talking cuts her off and still gets the reply', async () => {
      speaksFor(3000);
      void engine.playScript(script as never);
      await vi.advanceTimersByTimeAsync(1000);
      expect(engine.getState().isSpeaking).toBe(true);
      const p = engine.submitScriptedInput('hey');
      await vi.advanceTimersByTimeAsync(4000);
      await p;
      expect(h.stopSpeaking).toHaveBeenCalled();
      expect(h.speakText).toHaveBeenCalledWith('copy that');
    });
  });

  describe('autoFinish', () => {
    it('finishes the story 300ms after the last line and hands the view back', async () => {
      const script = {
        id: 'fin',
        title: 't',
        initialBeatId: 'last',
        beats: { last: { id: 'last', actor: actor('bye'), autoFinish: true, autoNextDelayMs: 300 } },
      };
      speaksFor(1000);
      void engine.playScript(script as never);
      await vi.advanceTimersByTimeAsync(1200);
      expect(engine.getState().isActive).toBe(true);
      await vi.advanceTimersByTimeAsync(600);
      expect(engine.getState().isActive).toBe(false);
      expect(h.view.returnToDefaultView).toHaveBeenCalledTimes(1);
      expect(h.setStoryWind).toHaveBeenLastCalledWith(0);
    });
  });
});
