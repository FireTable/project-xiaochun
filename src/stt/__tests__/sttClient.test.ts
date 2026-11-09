/**
 * Unit tests for sttClient.ts, text editing utilities, acoustic guard, and @firetable/stream-asr integration.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  SttClient,
  insertAtCursor,
  replaceOrInsertAtRange,
  resampleTo,
  meanRms,
} from '../sttClient';

describe('replaceOrInsertAtRange', () => {
  function createMockInput(initial = '') {
    const el = {
      value: initial,
      selectionStart: initial.length,
      selectionEnd: initial.length,
      dispatched: [] as string[],
      setSelectionRange(start: number, end: number) {
        this.selectionStart = start;
        this.selectionEnd = end;
      },
      dispatchEvent(ev: { type: string }) {
        this.dispatched.push(ev.type);
        return true;
      },
    };
    return el as unknown as HTMLTextAreaElement;
  }

  it('inserts text when range is null and returns tracked range', () => {
    const textarea = createMockInput('你好');
    textarea.selectionStart = 2;
    textarea.selectionEnd = 2;

    const range = replaceOrInsertAtRange(textarea, '小春', null);
    expect(textarea.value).toBe('你好小春');
    expect(range).toEqual({ start: 2, end: 4 });
  });

  it('atomically replaces the designated range on subsequent streaming re-inference', () => {
    const textarea = createMockInput('请问：');
    textarea.selectionStart = 3;
    textarea.selectionEnd = 3;

    // 1st chunk interim: "今天晚上"
    const range1 = replaceOrInsertAtRange(textarea, '今天晚上', null);
    expect(textarea.value).toBe('请问：今天晚上');
    expect(range1).toEqual({ start: 3, end: 7 });

    // 2nd chunk re-inference: "今天晚上我们去吃火锅" replaces range1
    const range2 = replaceOrInsertAtRange(textarea, '今天晚上我们去吃火锅', range1);
    expect(textarea.value).toBe('请问：今天晚上我们去吃火锅');
    expect(range2).toEqual({ start: 3, end: 13 });

    // Final commit: "今天晚上我们去吃火锅好不好？"
    const range3 = replaceOrInsertAtRange(textarea, '今天晚上我们去吃火锅好不好？', range2);
    expect(textarea.value).toBe('请问：今天晚上我们去吃火锅好不好？');
    expect(range3).toEqual({ start: 3, end: 17 });
  });
});

describe('insertAtCursor', () => {
  function createMockInput(initial = '') {
    const el = {
      value: initial,
      selectionStart: initial.length,
      selectionEnd: initial.length,
      dispatched: [] as string[],
      setSelectionRange(start: number, end: number) {
        this.selectionStart = start;
        this.selectionEnd = end;
      },
      dispatchEvent(ev: { type: string }) {
        this.dispatched.push(ev.type);
        return true;
      },
    };
    return el as unknown as HTMLTextAreaElement;
  }

  it('inserts text into empty textarea and dispatches input and change events', () => {
    const textarea = createMockInput('');
    insertAtCursor(textarea, '你好小春');
    expect(textarea.value).toBe('你好小春');
    expect((textarea as any).dispatched).toContain('input');
    expect((textarea as any).dispatched).toContain('change');
  });

  it('inserts text at cursor position with proper boundary spacing', () => {
    const textarea = createMockInput('Hello');
    textarea.selectionStart = 5;
    textarea.selectionEnd = 5;

    insertAtCursor(textarea, 'world');
    expect(textarea.value).toBe('Hello world');
  });

  it('preserves Chinese punctuation without extra space', () => {
    const textarea = createMockInput('你好');
    textarea.selectionStart = 2;
    textarea.selectionEnd = 2;

    insertAtCursor(textarea, '，很高兴认识你');
    expect(textarea.value).toBe('你好，很高兴认识你');
  });

  it('inserts text in middle of sentence preserving caret', () => {
    const textarea = createMockInput('你好世界');
    textarea.selectionStart = 2;
    textarea.selectionEnd = 2;

    insertAtCursor(textarea, '美麗的');
    expect(textarea.value).toBe('你好美麗的世界');
    expect(textarea.selectionStart).toBe(5);
  });
});

describe('resampleTo and meanRms utilities', () => {
  it('resamples 48kHz audio to 16kHz audio with 1:3 ratio', () => {
    const input = new Float32Array(4800);
    for (let i = 0; i < input.length; i++) input[i] = Math.sin(i * 0.1);

    const out = resampleTo(16000, input, 48000);
    expect(out.length).toBe(1600);
  });

  it('returns original input when fromRate equals targetRate', () => {
    const input = new Float32Array([0.1, 0.2, 0.3]);
    const out = resampleTo(16000, input, 16000);
    expect(out).toBe(input);
  });

  it('computes correct RMS of PCM samples', () => {
    const pcm = new Float32Array([0.5, -0.5, 0.5, -0.5]);
    const rms = meanRms(pcm);
    expect(rms).toBeCloseTo(0.5, 4);
  });

  it('computes zero RMS for empty buffer', () => {
    expect(meanRms(new Float32Array(0))).toBe(0);
  });
});

describe('SttClient state logic & Acoustic Guard', () => {
  it('initializes in idle state', () => {
    const client = new SttClient();
    expect(client.getState()).toBe('idle');
    expect(client.getProgressPercent()).toBe(0);
    client.dispose();
  });

  it('stops and resets state on stop call', async () => {
    const client = new SttClient();
    await client.stop(false);
    expect(client.getState()).toBe('idle');
    client.dispose();
  });

  it('suppresses speaker audio bleed during TTS speaking when rms < bargeInRms', () => {
    let speaking = true;
    const client = new SttClient({ isTtsSpeaking: () => speaking });

    const probs: number[] = [];
    client.on((ev) => {
      if (ev.type === 'speech_prob') probs.push(ev.prob);
    });

    // Audio chunk with low RMS (0.02 < bargeIn threshold 0.08)
    const lowPcm = new Float32Array(1600).fill(0.02);
    (client as any).processPcmChunk(lowPcm, 16000);

    // Suppressed: prob emitted is 0
    expect(probs).toContain(0);
    client.dispose();
  });

  it('permits barge-in when user speaks loudly over TTS (rms >= bargeInRms)', () => {
    let speaking = true;
    const client = new SttClient({ isTtsSpeaking: () => speaking });

    let fedPcm: Float32Array | null = null;
    (client as any).isModelReady = true;
    (client as any).recognizer = {
      feed: (pcm: Float32Array) => {
        fedPcm = pcm;
      },
    };

    // Audio chunk with high RMS (0.2 > bargeIn threshold 0.08)
    const loudPcm = new Float32Array(1600).fill(0.2);
    (client as any).processPcmChunk(loudPcm, 16000);

    // Permitted: audio was fed to recognizer
    expect(fedPcm).toBeTruthy();
    expect((client as any).isAcousticGuardActive()).toBe(true);
    client.dispose();
  });
});

describe('StreamRecognizer Integration & Events', () => {
  it('dispatches recognizing and recognized events through real initRecognizer listeners with punctuation formatting', async () => {
    const client = new SttClient();
    const textEvents: { text: string; isFinal: boolean }[] = [];

    client.on((ev) => {
      if (ev.type === 'text') {
        textEvents.push({ text: ev.text, isFinal: ev.isFinal });
      }
    });

    const { StreamRecognizer } = await import('@firetable/stream-asr');
    let recognizerRef: InstanceType<typeof StreamRecognizer> | null = null;
    const initSpy = vi
      .spyOn(StreamRecognizer.prototype, 'init')
      .mockImplementationOnce(async function (this: InstanceType<typeof StreamRecognizer>) {
        recognizerRef = this;
        (this as any).emit?.('ready');
      });

    await (client as any).initRecognizer();
    (client as any).desiredActive = true;
    (client as any).setState('listening');

    // Interim multi-sentence speech: CJK inter-segment space becomes comma, state stays 'listening'
    (recognizerRef as any).emit('recognizing', {
      text: '今天天气真好 我们去散步好不好',
      vadState: 1,
      isFinal: false,
    });
    expect(textEvents).toHaveLength(1);
    expect(textEvents[0]).toEqual({ text: '今天天气真好，我们去散步好不好', isFinal: false });
    expect(client.getState()).toBe('listening');

    // Finalized sentence receives question mark
    (recognizerRef as any).emit('recognized', {
      text: '今天天气真好 我们去散步好不好',
      isFinal: true,
      tokenCount: 12,
      inferenceMs: 10,
    });
    expect(textEvents).toHaveLength(2);
    expect(textEvents[1]).toEqual({ text: '今天天气真好，我们去散步好不好？', isFinal: true });

    initSpy.mockRestore();
    client.dispose();
  });

  it('tears down active MediaStream and resets desiredActive if recognizer init rejects', async () => {
    const client = new SttClient();
    const stopTrack = vi.fn();
    (client as any).desiredActive = true;
    (client as any).stream = { getTracks: () => [{ stop: stopTrack }] };

    const { StreamRecognizer } = await import('@firetable/stream-asr');
    const spy = vi
      .spyOn(StreamRecognizer.prototype, 'init')
      .mockRejectedValueOnce(new Error('network_500'));

    await expect((client as any).initRecognizer()).rejects.toThrow('network_500');
    expect(stopTrack).toHaveBeenCalledTimes(1);
    expect((client as any).stream).toBeNull();
    expect((client as any).desiredActive).toBe(false);
    expect(client.getState()).toBe('error');

    spy.mockRestore();
    client.dispose();
  });

  it('does not corrupt sequence counter if recognizer.feed throws synchronously', async () => {
    const client = new SttClient();
    const textEvents: string[] = [];
    client.on((ev) => {
      if (ev.type === 'text') textEvents.push(ev.text);
    });

    const { StreamRecognizer } = await import('@firetable/stream-asr');
    let recognizerRef: InstanceType<typeof StreamRecognizer> | null = null;
    const initSpy = vi
      .spyOn(StreamRecognizer.prototype, 'init')
      .mockImplementationOnce(async function (this: InstanceType<typeof StreamRecognizer>) {
        recognizerRef = this;
        (this as any).emit?.('ready');
      });
    const feedSpy = vi
      .spyOn(StreamRecognizer.prototype, 'feed')
      .mockImplementationOnce(() => {
        throw new Error('transient_post_error');
      })
      .mockImplementation(() => {});
    const resetSpy = vi.spyOn(StreamRecognizer.prototype, 'reset').mockImplementation(() => {});

    await (client as any).initRecognizer();
    (client as any).desiredActive = true;

    // 1st feed throws -> sentFeedCount must remain 0
    (client as any).processPcmChunk(new Float32Array(1600).fill(0.1), 16000);
    expect((client as any).sentFeedCount).toBe(0);

    // Next turn resets session -> ignoreResultsUntilCount is 0, so the very 1st valid chunk is NOT swallowed!
    client.resetSession();
    (client as any).desiredActive = true;
    (client as any).processPcmChunk(new Float32Array(1600).fill(0.1), 16000);
    (recognizerRef as any).emit('recognizing', { text: '正常识别', vadState: 1, isFinal: false });
    expect(textEvents).toEqual(['正常识别']);

    initSpy.mockRestore();
    feedSpy.mockRestore();
    resetSpy.mockRestore();
    client.dispose();
  });
});

describe('SttClient PCM buffer bounds & init recovery', () => {
  it('caps buffered PCM to ~0.5s preroll while VAD is silent', () => {
    const client = new SttClient();
    (client as any).isModelReady = true;
    (client as any).recognizer = { feed: vi.fn() };

    // 20 chunks x 0.1s = 2s of silence-time audio
    for (let i = 0; i < 20; i++) {
      (client as any).processPcmChunk(new Float32Array(1600).fill(0.01), 16000);
    }
    expect((client as any).speechPcmSamples).toBeLessThanOrEqual(8000 + 1600);
    client.dispose();
  });

  it('keeps the whole utterance while VAD reports speech, then flushes', () => {
    const client = new SttClient();
    (client as any).isModelReady = true;
    (client as any).recognizer = { feed: vi.fn() };
    (client as any).vadActive = true;

    for (let i = 0; i < 20; i++) {
      (client as any).processPcmChunk(new Float32Array(1600).fill(0.05), 16000);
    }
    expect((client as any).speechPcmSamples).toBe(32000);
    const pcm = (client as any).flushSpeechPcm();
    expect(pcm.length).toBe(32000);
    expect((client as any).speechPcmSamples).toBe(0);
    client.dispose();
  });

  it('resets loadPromise and reports error when init fails so a retry is possible', async () => {
    const client = new SttClient();
    const errors: string[] = [];
    client.on((ev) => {
      if (ev.type === 'error') errors.push(ev.message);
    });
    const { StreamRecognizer } = await import('@firetable/stream-asr');
    const spy = vi
      .spyOn(StreamRecognizer.prototype, 'init')
      .mockRejectedValueOnce(new Error('boom'));

    await expect((client as any).initRecognizer()).rejects.toThrow('boom');
    expect((client as any).loadPromise).toBeNull();
    expect(client.getState()).toBe('error');
    expect(errors).toContain('boom');
    spy.mockRestore();
    client.dispose();
  });

  it('forwards loaded/total bytes during download_progress and transitions phase cleanly', async () => {
    const client = new SttClient();
    const progressEvents: Array<{
      phase: string;
      percent: number;
      loaded?: number;
      total?: number;
    }> = [];
    client.on((ev) => {
      if (ev.type === 'progress') {
        progressEvents.push({
          phase: ev.phase,
          percent: ev.percent,
          loaded: ev.loaded,
          total: ev.total,
        });
      }
    });

    const { StreamRecognizer } = await import('@firetable/stream-asr');
    const spy = vi
      .spyOn(StreamRecognizer.prototype, 'init')
      .mockImplementationOnce(async function (this: InstanceType<typeof StreamRecognizer>) {
        (this as any).emit?.('download_progress', {
          loaded: 10 * 1024 * 1024,
          total: 40 * 1024 * 1024,
          percent: 25,
          completedChunks: 5,
          totalChunks: 20,
        });
        (this as any).emit?.('download_progress', {
          loaded: 40 * 1024 * 1024,
          total: 40 * 1024 * 1024,
          percent: 100,
          completedChunks: 20,
          totalChunks: 20,
        });
        (this as any).emit?.('ready');
      });

    (client as any).desiredActive = true;
    (client as any).setState('loading');
    await (client as any).initRecognizer();

    expect(progressEvents[0]).toEqual({ phase: 'init', percent: 0, loaded: 0, total: 0 });
    expect(progressEvents[1]).toEqual({
      phase: 'download',
      percent: 25,
      loaded: 10 * 1024 * 1024,
      total: 40 * 1024 * 1024,
    });
    expect(progressEvents[2]).toEqual({
      phase: 'init',
      percent: 100,
      loaded: 40 * 1024 * 1024,
      total: 40 * 1024 * 1024,
    });
    expect(progressEvents[3]).toEqual({
      phase: 'ready',
      percent: 100,
      loaded: undefined,
      total: undefined,
    });
    // Without an active MediaStream yet, ready must not prematurely flip loading -> listening
    expect(client.getState()).toBe('loading');

    spy.mockRestore();
    client.dispose();
  });

  it('drops ghost text when mic closes and user deletes input before async finish() returns', async () => {
    const client = new SttClient();
    const emittedTexts: Array<{ text: string; isFinal: boolean }> = [];
    client.on((ev) => {
      if (ev.type === 'text') emittedTexts.push({ text: ev.text, isFinal: ev.isFinal });
    });

    const { StreamRecognizer } = await import('@firetable/stream-asr');
    let recognizerRef: InstanceType<typeof StreamRecognizer> | null = null;
    const initSpy = vi
      .spyOn(StreamRecognizer.prototype, 'init')
      .mockImplementationOnce(async function (this: InstanceType<typeof StreamRecognizer>) {
        recognizerRef = this;
        (this as any).emit?.('ready');
      });
    const feedSpy = vi.spyOn(StreamRecognizer.prototype, 'feed').mockImplementation(() => {});
    const finishSpy = vi.spyOn(StreamRecognizer.prototype, 'finish').mockImplementation(() => {});
    const resetSpy = vi.spyOn(StreamRecognizer.prototype, 'reset').mockImplementation(() => {});

    await (client as any).initRecognizer();
    (client as any).desiredActive = true;
    (client as any).setState('listening');

    // 1. Feed two chunks -> Worker emits recognizing for chunk #1 ("你好小春")
    (client as any).processPcmChunk(new Float32Array(1600).fill(0.1), 16000);
    (recognizerRef as any).emit('recognizing', { text: '你好小春', vadState: 1, isFinal: false });
    expect(emittedTexts).toHaveLength(1);

    // Identical silent frame from Worker must NOT re-emit duplicate text
    (client as any).processPcmChunk(new Float32Array(1600).fill(0.001), 16000);
    (recognizerRef as any).emit('recognizing', { text: '你好小春', vadState: 0, isFinal: false });
    expect(emittedTexts).toHaveLength(1);

    // 2. User closes mic -> stop(true) queues finish() AND reset()
    await client.stop(true);
    expect(finishSpy).toHaveBeenCalledTimes(1);
    expect(resetSpy).toHaveBeenCalledTimes(1);

    // 3. User deletes input content BEFORE Worker returns finish() RESULT -> ChatBar calls resetSession()
    client.resetSession();

    // 4. Late Worker RESULT arrives for finish() (StreamRecognizer fires both recognizing + recognized)
    (recognizerRef as any).emit('recognizing', { text: '你好小春', vadState: 0, isFinal: true });
    (recognizerRef as any).emit('recognized', {
      text: '你好小春',
      isFinal: true,
      tokenCount: 4,
      inferenceMs: 12,
    });

    // Deleted input stays clean — zero late ghost text emitted!
    expect(emittedTexts).toHaveLength(1);

    initSpy.mockRestore();
    feedSpy.mockRestore();
    finishSpy.mockRestore();
    resetSpy.mockRestore();
    client.dispose();
  });

  it('finalizes speech on normal stop(true) when user does NOT edit input, and resets recognizer for next turn', async () => {
    const client = new SttClient();
    const emittedTexts: Array<{ text: string; isFinal: boolean }> = [];
    client.on((ev) => {
      if (ev.type === 'text') emittedTexts.push({ text: ev.text, isFinal: ev.isFinal });
    });

    const { StreamRecognizer } = await import('@firetable/stream-asr');
    let recognizerRef: InstanceType<typeof StreamRecognizer> | null = null;
    const initSpy = vi
      .spyOn(StreamRecognizer.prototype, 'init')
      .mockImplementationOnce(async function (this: InstanceType<typeof StreamRecognizer>) {
        recognizerRef = this;
        (this as any).emit?.('ready');
      });
    const feedSpy = vi.spyOn(StreamRecognizer.prototype, 'feed').mockImplementation(() => {});
    const finishSpy = vi.spyOn(StreamRecognizer.prototype, 'finish').mockImplementation(() => {});
    const resetSpy = vi.spyOn(StreamRecognizer.prototype, 'reset').mockImplementation(() => {});

    await (client as any).initRecognizer();
    (client as any).desiredActive = true;
    (client as any).setState('listening');

    (client as any).processPcmChunk(new Float32Array(1600).fill(0.1), 16000);
    (recognizerRef as any).emit('recognizing', { text: '今天天气真好', vadState: 1, isFinal: false });

    await client.stop(true);
    // Worker responds to finish()
    (recognizerRef as any).emit('recognizing', { text: '今天天气真好', vadState: 0, isFinal: true });
    (recognizerRef as any).emit('recognized', {
      text: '今天天气真好',
      isFinal: true,
      tokenCount: 6,
      inferenceMs: 15,
    });

    expect(emittedTexts).toEqual([
      { text: '今天天气真好', isFinal: false },
      { text: '今天天气真好。', isFinal: true },
    ]);
    expect(resetSpy).toHaveBeenCalledTimes(1);

    initSpy.mockRestore();
    feedSpy.mockRestore();
    finishSpy.mockRestore();
    resetSpy.mockRestore();
    client.dispose();
  });
});
