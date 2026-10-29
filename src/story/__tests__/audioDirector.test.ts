import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => ({ playerBehaviour: 'error' as 'error' | 'ok', playerCtor: vi.fn(), ctx: null as unknown }));

vi.mock('tone', () => {
  class Player {
    constructor(opts: { onload?: () => void; onerror?: (e: Error) => void }) {
      h.playerCtor(opts);
      queueMicrotask(() => (h.playerBehaviour === 'ok' ? opts.onload?.() : opts.onerror?.(new Error('404'))));
    }
    connect() {}
    start() {}
    stop() {}
    dispose() {}
  }
  return {
    Player,
    getContext: () => ({ rawContext: h.ctx }),
    start: () => Promise.resolve(),
  };
});

function param(value = 0) {
  return {
    value,
    cancelScheduledValues: vi.fn(),
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
  };
}
const node = (extra: Record<string, unknown> = {}) => ({ connect: vi.fn(), disconnect: vi.fn(), ...extra });

function makeCtx() {
  return {
    currentTime: 0,
    sampleRate: 1000,
    state: 'running',
    destination: node(),
    resume: vi.fn(() => Promise.resolve()),
    createGain: () => node({ gain: param(1) }),
    createBiquadFilter: () => node({ type: 'lowpass', frequency: param(1000), Q: param(1) }),
    createOscillator: () => node({ type: 'sine', frequency: param(440), detune: param(0), start: vi.fn(), stop: vi.fn() }),
    createBufferSource: () => node({ buffer: null, loop: false, loopStart: 0, start: vi.fn(), stop: vi.fn() }),
    createBuffer: (_c: number, len: number) => ({ getChannelData: () => new Float32Array(len) }),
  };
}

import { StoryAudioDirector, BGM_MOODS, BGM_MOOD_ALIASES, SFX_IDS, SFX_ALIASES } from '../audioDirector';

describe('StoryAudioDirector (procedural BGM, ambience, ducking)', () => {
  let d: StoryAudioDirector;

  beforeEach(() => {
    vi.useFakeTimers();
    (globalThis as any).window = (globalThis as any).window ?? {};
    h.ctx = makeCtx();
    h.playerBehaviour = 'error';
    h.playerCtor.mockClear();
    d = new StoryAudioDirector();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    d.stopAll(0);
    vi.advanceTimersByTime(1000);
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('starts a procedural mood, ignores repeats, crossfades to a new mood and fades out', async () => {
    await d.executeDirective({ bgmMood: 'dusk_warm', bgmVolume: 0.3 });
    expect(d.getState().bgm).toBe('mood:dusk_warm');
    await d.executeDirective({ bgmMood: 'dusk_warm' });
    expect(d.getState().bgm).toBe('mood:dusk_warm');
    await d.executeDirective({ bgmMood: 'lights_on', bgmAction: 'fade_in' });
    expect(d.getState().bgm).toBe('mood:lights_on');
    await d.executeDirective({ bgmAction: 'fade_out' });
    expect(d.getState().bgm).toBeNull();
  });

  it('knows every mood and maps the story generator’s mood names', async () => {
    for (const m of Object.keys(BGM_MOODS)) {
      await d.executeDirective({ bgmMood: m });
      expect(d.getState().bgm).toBe(`mood:${m}`);
    }
    await d.executeDirective({ bgmMood: 'melancholy_piano' });
    expect(d.getState().bgm).toBe('mood:longing');
  });

  it('unknown mood or ambience is a harmless no-op', async () => {
    await expect(d.executeDirective({ bgmMood: 'nope', ambience: 'nope' })).resolves.toBeUndefined();
    expect(d.getState().bgm).toBeNull();
    expect(d.getState().ambience).toBeNull();
  });

  it('falls back to the mood when the BGM file is missing, and does not retry the broken URL', async () => {
    await d.executeDirective({ bgmTrack: '/audio/missing.mp3', bgmMood: 'longing' });
    expect(d.getState().bgm).toBe('mood:longing');
    expect(h.playerCtor).toHaveBeenCalledTimes(1);
    await d.executeDirective({ bgmTrack: '/audio/missing.mp3', bgmMood: 'longing' });
    expect(h.playerCtor).toHaveBeenCalledTimes(1);
    expect(d.getState().bgm).toBe('mood:longing');
  });

  it('missing BGM file without a mood continues silently', async () => {
    await d.executeDirective({ bgmTrack: '/audio/missing.mp3' });
    expect(d.getState().bgm).toBeNull();
  });

  it('plays a real track when it loads', async () => {
    h.playerBehaviour = 'ok';
    await d.executeDirective({ bgmTrack: '/audio/ok.mp3', bgmMood: 'longing' });
    expect(d.getState().bgm).toBe('track:/audio/ok.mp3');
  });

  it('starts and stops ambience', async () => {
    await d.executeDirective({ ambience: 'sea_waves', ambienceVolume: 0.2 });
    expect(d.getState().ambience).toBe('sea_waves');
    await d.executeDirective({ ambience: 'none' });
    expect(d.getState().ambience).toBeNull();
  });

  it('ducks and restores, muffles, and un-muffles when music (re)starts', async () => {
    d.init();
    d.duckBgm();
    expect(d.getState().ducked).toBe(true);
    d.restoreBgmDucking();
    expect(d.getState().ducked).toBe(false);
    await d.executeDirective({ bgmAction: 'muffle' });
    expect(d.getState().muffled).toBe(true);
    await d.executeDirective({ bgmMood: 'dusk_warm' });
    expect(d.getState().muffled).toBe(false);
  });

  it('plays a one-shot sfx by string and cancels delayed sfx on demand', async () => {
    const spy = vi.spyOn(d, 'playSfx');
    await d.executeDirective({ playSfx: 'bell', sfx: [{ id: 'whoosh', delaySec: 1, volume: 0.5 }] });
    expect(spy).toHaveBeenCalledWith('bell');
    d.cancelPendingSfx();
    vi.advanceTimersByTime(2000);
    expect(spy).not.toHaveBeenCalledWith('whoosh', 0.5);
    await d.executeDirective({ sfx: [{ id: 'whoosh', delaySec: 1, volume: 0.5 }] });
    vi.advanceTimersByTime(1100);
    expect(spy).toHaveBeenCalledWith('whoosh', 0.5);
  });

  it('every built-in sfx id synthesises without throwing', () => {
    for (const id of SFX_IDS) expect(() => d.playSfx(id)).not.toThrow();
  });

  it('unlock() resumes a suspended context from inside the gesture', () => {
    (h.ctx as any).state = 'suspended';
    d.unlock();
    expect((h.ctx as any).resume).toHaveBeenCalled();
  });

  it('stopAll() silences everything', async () => {
    await d.executeDirective({ bgmMood: 'dusk_warm', ambience: 'wind' });
    d.stopAll(0);
    expect(d.getState().bgm).toBeNull();
    expect(d.getState().ambience).toBeNull();
  });

  it('accepts the script short names for sfx and moods (aliases)', async () => {
    const spy = vi.spyOn(d, 'playSfx');
    for (const [alias, id] of Object.entries(SFX_ALIASES)) {
      expect(SFX_IDS as readonly string[]).toContain(id);
      expect(() => d.playSfx(alias)).not.toThrow();
    }
    expect(spy).toHaveBeenCalledWith('wind');
    for (const mood of ['calm', 'bright', 'mystic']) expect(Object.keys(BGM_MOODS)).toContain(BGM_MOOD_ALIASES[mood]);
  });
});
