import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/memory', () => ({ rememberTurn: vi.fn(async () => {}) }));
vi.mock('@/llm/chatWorkflow', () => ({ generateSpeechReply: vi.fn() }));
vi.mock('mpg123-decoder', () => ({ MPEGDecoder: class { ready = Promise.resolve(); } }));

import { ChatDirector, withTimeout } from './chatDirector';

class FakeCtx {
  state = 'running';
  sampleRate = 48000;
  async resume() {}
  createBuffer(_c: number, len: number, sr: number) { return { duration: len / sr } as unknown as AudioBuffer; }
  close() { return Promise.resolve(); }
}

function fakeEmage() {
  return {
    loop: true, playAudio: true, holdLastFrame: true, streamingMotionActive: false,
    onMotionChunk: null as unknown,
    startAudioStream: vi.fn(async () => {}),
    // Simulates the real bug: worker never answers feed_audio_end after a failed stream.
    endAudioStream: vi.fn(() => new Promise(() => {})),
    abortAudioStream: vi.fn(),
    clearExternalClock: vi.fn(), stop: vi.fn(), enterSpeakIdle: vi.fn(), exitSpeakIdle: vi.fn(),
  };
}

describe('ChatDirector TTS failure path', () => {
  beforeEach(() => {
    vi.stubGlobal('AudioContext', FakeCtx);
    vi.stubGlobal('document', { body: { classList: { add() {}, remove() {} } } });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 502, body: null })));
  });

  it('resolves, aborts the EMAGE stream and reports ttsUnavailable (non-error) with the LLM text', async () => {
    const d = new ChatDirector() as any;
    d.plan = { speech: '你好呀，我是小蠢。', llm_provider: 'test' };
    const emage = fakeEmage();
    const status = vi.fn();
    const id = d.utterance;
    await withTimeout(d.runSpeechPipeline('hi', {}, emage, status, id), 5000);
    expect(emage.abortAudioStream).toHaveBeenCalled();
    expect(emage.endAudioStream).not.toHaveBeenCalled();
    const err = status.mock.calls.find((c) => c[0] === 'ttsUnavailable');
    expect(err).toBeTruthy();
    expect(err![1].message).toContain('502');
    expect(err![2]).toBe(false);
    expect(status.mock.calls.some((c) => c[0] === 'error.tts')).toBe(false);
    expect(err![3]).toBe('你好呀，我是小蠢。');
  });

  it('withTimeout rejects a never-settling promise', async () => {
    await expect(withTimeout(new Promise(() => {}), 10)).rejects.toThrow(/timeout/);
  });
});
