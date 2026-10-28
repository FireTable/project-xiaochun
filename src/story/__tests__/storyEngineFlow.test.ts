import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => ({
  speakText: vi.fn(),
  stopSpeaking: vi.fn(),
  playMotion: vi.fn(),
  stopMotion: vi.fn(),
  changeLang: vi.fn(),
  setScene: vi.fn(),
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
    currentVRM: null,
    currentOutfitKey: 'xiaochun_dinner_dress',
    swapOutfit: vi.fn(),
    setFacingBackwards: vi.fn(),
    settleSpringBones: vi.fn(),
    triggerBodyTurnToFront: vi.fn(),
  },
}));
vi.mock('@/core/scene/sceneManager', () => ({
  sceneManager: { getCurrentSceneId: () => 'void', setScene: h.setScene },
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
    h.camera.transitionTo.mockReset().mockResolvedValue(undefined);
    h.camera.stopTransition.mockReset();
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
});
