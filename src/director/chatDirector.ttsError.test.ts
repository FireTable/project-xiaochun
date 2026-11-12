import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/memory', () => ({
  rememberTurn: vi.fn(async () => {}),
  clearAssembledUserContent: vi.fn(),
}));
vi.mock('@/llm/chatWorkflow', () => ({ generateSpeechReply: vi.fn() }));
vi.mock('mpg123-decoder', () => ({
  MPEGDecoder: class {
    ready = Promise.resolve();
    decode() {
      const ch = new Float32Array(2400).fill(0.12);
      return { channelData: [ch], samplesDecoded: ch.length, sampleRate: 24000 };
    }
    free() {}
  },
}));

import { ChatDirector, withTimeout } from './chatDirector';
import { rememberTurn } from '@/memory';
import { generateSpeechReply } from '@/llm/chatWorkflow';

class FakeCtx {
  state = 'running';
  sampleRate = 48000;
  currentTime = 0;
  destination = {};
  async resume() {
    this.state = 'running';
  }
  createBuffer(_c: number, len: number, sr: number) {
    return { duration: len / sr, copyToChannel() {} } as unknown as AudioBuffer;
  }
  createAnalyser() {
    return { fftSize: 512, connect() {}, getByteTimeDomainData() {} };
  }
  createGain() {
    return { gain: { value: 1, cancelScheduledValues() {}, setValueAtTime() {}, linearRampToValueAtTime() {} }, connect() {} };
  }
  createBufferSource() {
    const src: any = {
      buffer: null,
      playbackRate: { value: 1 },
      onended: null as (() => void) | null,
      connect() {},
      start: () => {
        if (this.state === 'running') {
          setTimeout(() => src.onended?.(), 5);
        }
      },
      stop() {},
    };
    return src;
  }
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

  it('triggers /api/tts immediately on cold mobile visit when EMAGE ONNX preload has not finished', async () => {
    const mp3Chunk = new Uint8Array([0xff, 0xfb, 0x90, 0x64]);
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => ({
      ok: true,
      status: 200,
      body: new ReadableStream({
        start(ctrl) {
          ctrl.enqueue(mp3Chunk);
          ctrl.close();
        },
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const d = new ChatDirector() as any;
    d.plan = { speech: '……咳，命运指引的旅人啊，欢迎来到我的领域……', llm_provider: 'DEV_BYPASS' };
    const emage = {
      ...fakeEmage(),
      ready: false,
      // Simulate 81.6 MiB ONNX download stalled/in-progress over cellular
      ensureLoaded: vi.fn(() => new Promise<void>(() => {})),
      startAudioStream: vi.fn(() => new Promise<void>(() => {})),
      pushAudioChunk: vi.fn(),
      checkpointAudioStream: vi.fn(() => new Promise(() => {})),
    };
    const status = vi.fn();
    const id = d.utterance;

    await withTimeout(
      d.runSpeechPipeline(d.plan.speech, { stop() {} }, emage, status, id, undefined, { preserveMotion: true }),
      1500,
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/tts');
    expect(emage.ensureLoaded).toHaveBeenCalled();
    expect(emage.startAudioStream).not.toHaveBeenCalled();
    expect(emage.pushAudioChunk).not.toHaveBeenCalled();
    expect(status.mock.calls.some((c) => c[0] === 'speaking')).toBe(true);
  });

  it('still calls /api/tts and settles when mobile AudioContext.resume() hangs in suspended/interrupted state', async () => {
    class HangingSuspendedCtx extends FakeCtx {
      override state = 'suspended';
      override resume(): Promise<void> {
        return new Promise<void>(() => {});
      }
    }
    vi.stubGlobal('AudioContext', HangingSuspendedCtx);

    const mp3Chunk = new Uint8Array([0xff, 0xfb, 0x90, 0x64]);
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => ({
      ok: true,
      status: 200,
      body: new ReadableStream({
        start(ctrl) {
          ctrl.enqueue(mp3Chunk);
          ctrl.close();
        },
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const d = new ChatDirector() as any;
    d.plan = { speech: '测试静音挂起兜底。', llm_provider: 'DEV_BYPASS' };
    const emage = { ...fakeEmage(), ready: false, ensureLoaded: vi.fn(() => new Promise<void>(() => {})) };
    const status = vi.fn();
    const id = d.utterance;

    await withTimeout(
      d.runSpeechPipeline(d.plan.speech, { stop() {} }, emage, status, id, undefined, { preserveMotion: true }),
      2500,
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/tts');
    expect(status.mock.calls.some((c) => c[0] === 'speaking')).toBe(true);
  });

  it('unlockAudio() resumes WebKit interrupted state before initializing Tone DSP graph', () => {
    const order: string[] = [];
    class InterruptedCtx extends FakeCtx {
      override state = 'interrupted';
      override async resume() {
        order.push('resume');
        this.state = 'running';
      }
    }
    vi.stubGlobal('AudioContext', InterruptedCtx);
    const d = new ChatDirector();
    vi.spyOn(d.vocalProcessor, 'init').mockImplementation(() => {
      order.push('vocalInit');
    });
    d.unlockAudio();
    expect(order).toEqual(['resume', 'vocalInit']);
  });

  it('speakText() does not pollute client-memory with scripted speech, while say() records user turns', async () => {
    vi.mocked(rememberTurn).mockClear();
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    });
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Macintosh)' });

    const d = new ChatDirector() as any;
    d.audioBlocked = vi.fn(async () => false);
    const emage = fakeEmage();
    const status = vi.fn();
    const fakeVrm = {} as any;
    const fakePlayer = { stop: vi.fn() } as any;

    await d.speakText('这是小蠢自己的台词，不是用户说的话。', fakeVrm, fakePlayer, emage, status, undefined, {
      preserveMotion: true,
    });
    expect(rememberTurn).not.toHaveBeenCalled();

    vi.mocked(generateSpeechReply).mockResolvedValueOnce('你好呀，我记住了！');
    d.provideSystemContext = vi.fn(async () => ({ prompt: 'sys', lang: 'zh-CN' }));
    d.playThinking = vi.fn(async () => {});

    await d.say('我喜欢吃草莓蛋糕', fakeVrm, fakePlayer, emage, status);
    expect(rememberTurn).toHaveBeenCalledTimes(1);
    expect(rememberTurn).toHaveBeenCalledWith('我喜欢吃草莓蛋糕', '你好呀，我记住了！');
  });
});
