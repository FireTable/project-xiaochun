/**
 * Unit tests for sttClient.ts and insertAtCursor.
 */
import { describe, it, expect, vi } from 'vitest';
import { SttClient, insertAtCursor, replaceOrInsertAtRange } from '../sttClient';

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

  it('calls focus on textarea when inserting text', () => {
    const textarea = createMockInput('你好');
    let focused = false;
    (textarea as any).focus = () => {
      focused = true;
    };
    insertAtCursor(textarea, '小春');
    expect(focused).toBe(true);
    expect(textarea.value).toBe('你好小春');
  });
});

describe('SttClient state logic', () => {
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

  it('keeps listening state when model finishes loading while desiredActive is true', () => {
    const originalWorker = (globalThis as any).Worker;
    (globalThis as any).Worker = class MockWorker {
      onmessage: any = null;
      postMessage() {}
      terminate() {}
    };

    try {
      const client = new SttClient();
      const states: string[] = [];
      client.on((ev) => {
        if (ev.type === 'state') states.push(ev.state);
      });

      // Simulate start() setting desiredActive = true and listening state
      (client as any).desiredActive = true;
      (client as any).setState('listening');

      // Simulate worker ready message arriving while stream is not yet ready (async getUserMedia in flight)
      (client as any).stream = null;
      const workerInstance = (client as any).ensureWorker();
      // Trigger onmessage with { type: 'ready' }
      workerInstance.onmessage({ data: { type: 'ready' } } as any);

      expect(client.getState()).toBe('listening');
      expect(states).not.toContain('idle');
      client.dispose();
    } finally {
      (globalThis as any).Worker = originalWorker;
    }
  });

  it('emits utterance_result event with pcm, duration, latency and rms on worker result', () => {
    let lastPostedMsg: any = null;
    const originalWorker = (globalThis as any).Worker;
    (globalThis as any).Worker = class MockWorker {
      onmessage: any = null;
      postMessage(msg: any) {
        lastPostedMsg = msg;
      }
      terminate() {}
    };

    try {
      const client = new SttClient();
      let receivedUtterance: any = null;
      client.on((ev) => {
        if (ev.type === 'utterance_result') {
          receivedUtterance = ev;
        }
      });

      // Submit an utterance of 16000 samples (1 second at 16kHz)
      const pcm = new Float32Array(16000).fill(0.2);
      (client as any).submitUtterance(pcm, true);

      expect(lastPostedMsg).toBeTruthy();
      expect(lastPostedMsg.type).toBe('recognize');
      const id = lastPostedMsg.id;

      // Simulate worker result
      const workerInstance = (client as any).worker;
      workerInstance.onmessage({
        data: {
          type: 'result',
          id,
          text: '你好小春',
          isFinal: true,
        },
      });

      expect(receivedUtterance).toBeTruthy();
      expect(receivedUtterance.id).toBe(id);
      expect(receivedUtterance.text).toBe('你好，小春。');
      expect(receivedUtterance.durationMs).toBe(1000);
      expect(receivedUtterance.pcm.length).toBe(16000);
      expect(receivedUtterance.rms).toBeCloseTo(0.2, 2);
      expect(receivedUtterance.inferenceMs).toBeGreaterThanOrEqual(0);

      client.dispose();
    } finally {
      (globalThis as any).Worker = originalWorker;
    }
  });

  it('recognizePcm performs ad-hoc recognition without opening mic stream', async () => {
    let lastPostedMsg: any = null;
    const originalWorker = (globalThis as any).Worker;
    (globalThis as any).Worker = class MockWorker {
      onmessage: any = null;
      postMessage(msg: any) {
        lastPostedMsg = msg;
        if (msg.type === 'recognize') {
          setTimeout(() => {
            this.onmessage?.({
              data: {
                type: 'result',
                id: msg.id,
                text: '重测成功',
              },
            });
          }, 5);
        }
      }
      terminate() {}
    };

    try {
      const client = new SttClient();
      const pcm = new Float32Array(8000).fill(0.1);
      const res = await client.recognizePcm(pcm, 16000);

      expect(lastPostedMsg).toBeTruthy();
      expect(lastPostedMsg.type).toBe('recognize');
      expect(res.text).toBe('重测成功。');
      expect(res.inferenceMs).toBeGreaterThanOrEqual(0);
      expect(client.getState()).toBe('idle'); // mic never touched

      client.dispose();
    } finally {
      (globalThis as any).Worker = originalWorker;
    }
  });

  it('commitSession delegates to worker punctuate RPC and emits finalized text', async () => {
    let punctuateMsg: any = null;
    const originalWorker = (globalThis as any).Worker;
    (globalThis as any).Worker = class MockWorker {
      onmessage: any = null;
      postMessage(msg: any) {
        if (msg.type === 'punctuate') {
          punctuateMsg = msg;
          setTimeout(() => {
            this.onmessage?.({
              data: {
                type: 'punctuate_result',
                id: msg.id,
                text: '简单说两句，我们这个项目其实移动的比较晚，在市场上并没有特别大的份额。',
              },
            });
          }, 5);
        }
      }
      terminate() {}
    };

    try {
      const client = new SttClient();
      (client as any).ensureWorker();
      (client as any).isModelReady = true;
      (client as any).lastSessionText = '简单说两句我们这个项目其实移动的比较晚在市场上并没有特别大的份额';

      let emittedTextEvent: any = null;
      client.on((ev) => {
        if (ev.type === 'text') emittedTextEvent = ev;
      });

      await client.commitSession();

      expect(punctuateMsg).toBeTruthy();
      expect(punctuateMsg.type).toBe('punctuate');
      expect(punctuateMsg.text).toBe('简单说两句我们这个项目其实移动的比较晚在市场上并没有特别大的份额');
      expect(emittedTextEvent).toBeTruthy();
      expect(emittedTextEvent.isFinal).toBe(true);
      expect(emittedTextEvent.text).toBe('简单说两句，我们这个项目其实移动的比较晚，在市场上并没有特别大的份额。');

      client.dispose();
    } finally {
      (globalThis as any).Worker = originalWorker;
    }
  });

  it('resetSession invalidates in-flight utterances and prevents ghost text emission', async () => {
    const originalWorker = (globalThis as any).Worker;
    let workerInstance: any = null;
    (globalThis as any).Worker = class MockWorker {
      onmessage: any = null;
      postMessage() {
        workerInstance = this;
      }
      terminate() {}
    };

    try {
      const client = new SttClient();
      (client as any).ensureWorker();
      (client as any).isModelReady = true;

      // Submit an utterance in-flight
      (client as any).submitUtterance(new Float32Array(3200), false);
      const inFlightId = (client as any).inFlightUtterance.id;

      let emittedEvents: any[] = [];
      client.on((ev) => {
        if (ev.type === 'text') emittedEvents.push(ev);
      });

      // User hits send, which calls resetSession()
      client.resetSession();

      // In-flight worker result arrives late
      workerInstance.onmessage?.({
        data: {
          type: 'result',
          id: inFlightId,
          text: '迟到的幽灵文本',
          isFinal: false,
        },
      });

      // Verify no text event was emitted
      expect(emittedEvents.length).toBe(0);
      expect((client as any).lastSessionText).toBe('');

      client.dispose();
    } finally {
      (globalThis as any).Worker = originalWorker;
    }
  });

  describe('acoustic bleed gating (Self-Listening Guard)', () => {
    it('suppresses acoustic bleed when TTS is speaking and audio RMS is below barge-in threshold', () => {
      let isTtsSpeaking = true;
      const client = new SttClient({ isTtsSpeaking: () => isTtsSpeaking });

      let vadResetCount = 0;
      let vadProcessCount = 0;
      const mockVad = {
        reset: () => {
          vadResetCount++;
        },
        dispose: () => {},
        isInSpeech: () => false,
        isSpeechCandidate: () => false,
        processChunk: () => {
          vadProcessCount++;
          return Promise.resolve();
        },
      };
      (client as any).vad = mockVad;

      const events: any[] = [];
      client.on((ev) => events.push(ev));

      // Create a low-volume audio chunk (speaker bleed RMS ~ 0.03 < 0.08)
      const bleedPcm = new Float32Array(512).fill(0.03);
      (client as any).processPcmChunk(bleedPcm);

      // Verify VAD was reset and not fed the bleed chunk
      expect(vadResetCount).toBe(1);
      expect(vadProcessCount).toBe(0);

      // Verify partial_rms was emitted with prob: 0, and no speech_start was emitted
      const rmsEv = events.find((e) => e.type === 'partial_rms');
      const probEv = events.find((e) => e.type === 'speech_prob');
      const startEv = events.find((e) => e.type === 'speech_start');

      expect(rmsEv).toBeTruthy();
      expect(rmsEv.rms).toBeCloseTo(0.03, 3);
      expect(probEv).toBeTruthy();
      expect(probEv.prob).toBe(0);
      expect(startEv).toBeUndefined();

      client.dispose();
    });

    it('permits user barge-in when TTS is speaking and audio RMS exceeds barge-in threshold', () => {
      let isTtsSpeaking = true;
      const client = new SttClient({ isTtsSpeaking: () => isTtsSpeaking });

      let vadProcessCount = 0;
      let onVadEventCb: any = null;
      const mockVad = {
        reset: () => {},
        dispose: () => {},
        isInSpeech: () => false,
        isSpeechCandidate: () => false,
        processChunk: (_chunk: Float32Array, onEvent: (ev: any) => void) => {
          vadProcessCount++;
          onVadEventCb = onEvent;
          return Promise.resolve();
        },
      };
      (client as any).vad = mockVad;

      const events: any[] = [];
      client.on((ev) => events.push(ev));

      // Create a loud chunk (user directly speaking into mic RMS ~ 0.15 >= 0.08)
      const userPcm = new Float32Array(512).fill(0.15);
      (client as any).processPcmChunk(userPcm);

      // Verify chunk passed through to VAD
      expect(vadProcessCount).toBe(1);

      // When VAD confirms speech start from user, client forwards speech_start
      onVadEventCb?.({ type: 'speech_start' });
      const startEv = events.find((e) => e.type === 'speech_start');
      expect(startEv).toBeTruthy();

      client.dispose();
    });

    it('maintains acoustic guard during post-TTS room reverberation cooldown window', () => {
      let isTtsSpeaking = true;
      const client = new SttClient({ isTtsSpeaking: () => isTtsSpeaking });

      expect(client.isAcousticGuardActive()).toBe(true);

      // TTS finishes speaking
      isTtsSpeaking = false;
      // Mark last speaking time to now
      (client as any).lastTtsSpeakingTime = performance.now();

      // Guard is still active during the 250ms cooldown window
      expect(client.isAcousticGuardActive()).toBe(true);

      // Simulate passage of 300ms (> 250ms cooldown)
      (client as any).lastTtsSpeakingTime = performance.now() - 350;
      expect(client.isAcousticGuardActive()).toBe(false);

      client.dispose();
    });

    describe('Client-Cloud 2-Pass Hybrid Mode', () => {
      it('Pass 1: keeps interim draft recognition purely on local WebWorker without calling remote ASR', () => {
        let lastWorkerMsg: any = null;
        const originalWorker = (globalThis as any).Worker;
        (globalThis as any).Worker = class MockWorker {
          onmessage: any = null;
          postMessage(msg: any) {
            lastWorkerMsg = msg;
          }
          terminate() {}
        };

        try {
          const client = new SttClient();
          const pcm = new Float32Array(8000).fill(0.1);
          // Draft submission (isFinal = false)
          (client as any).submitUtterance(pcm, false);

          // Should go directly to local worker
          expect(lastWorkerMsg).toBeTruthy();
          expect(lastWorkerMsg.type).toBe('recognize');
          expect(lastWorkerMsg.isFinal).toBe(false);

          client.dispose();
        } finally {
          (globalThis as any).Worker = originalWorker;
        }
      });

      it('Pass 2: commitSession triggers transcribeRemote for full accumulated audio and emits finalized text', async () => {
        const originalFetch = globalThis.fetch;
        const originalWindow = (globalThis as any).window;

        // Mock window.localStorage to return 'builtin'
        (globalThis as any).window = {
          localStorage: {
            getItem: (key: string) => (key === 'xiaochun.stt.mode' ? 'builtin' : null),
          },
        };

        let fetchCalledWith: any = null;
        globalThis.fetch = vi.fn().mockImplementation(async (url: string, opts: any) => {
          fetchCalledWith = { url, opts };
          return {
            ok: true,
            status: 200,
            json: async () => ({
              text: '今天天气真好，我们一起去海边吧。',
            }),
          };
        });

        try {
          const client = new SttClient();
          (client as any).sessionPcmChunks = [
            new Float32Array(8000).fill(0.1),
            new Float32Array(8000).fill(0.1),
          ];
          (client as any).lastSessionText = '今天天气真好我们一起去海边吧';

          let emittedFinal: any = null;
          client.on((ev) => {
            if (ev.type === 'text' && ev.isFinal) {
              emittedFinal = ev;
            }
          });

          await client.commitSession();

          // Verify fetch was called with /api/stt
          expect(fetchCalledWith).toBeTruthy();
          expect(fetchCalledWith.url).toBe('/api/stt');

          // Verify emitted text from Whisper
          expect(emittedFinal).toBeTruthy();
          expect(emittedFinal.isFinal).toBe(true);
          expect(emittedFinal.text).toBe('今天天气真好，我们一起去海边吧。');

          client.dispose();
        } finally {
          globalThis.fetch = originalFetch;
          (globalThis as any).window = originalWindow;
        }
      });

      it('Pass 2 fallback: gracefully falls back to local draft text when transcribeRemote fails on commit', async () => {
        const originalFetch = globalThis.fetch;
        const originalWindow = (globalThis as any).window;
        const originalWorker = (globalThis as any).Worker;

        (globalThis as any).window = {
          localStorage: {
            getItem: (key: string) => (key === 'xiaochun.stt.mode' ? 'builtin' : null),
          },
        };

        // Simulate remote failure (e.g. 502)
        globalThis.fetch = vi.fn().mockResolvedValue({
          ok: false,
          status: 502,
          text: async () => 'Inference error',
        });

        (globalThis as any).Worker = class MockWorker {
          onmessage: any = null;
          postMessage() {}
          terminate() {}
        };

        try {
          const client = new SttClient();
          (client as any).sessionPcmChunks = [new Float32Array(8000).fill(0.1)];
          (client as any).lastSessionText = '今天天气真好';

          let emittedFinal: any = null;
          client.on((ev) => {
            if (ev.type === 'text' && ev.isFinal) {
              emittedFinal = ev;
            }
          });

          await client.commitSession();

          // Should fall back to local draft text with Stage 1 punctuation
          expect(emittedFinal).toBeTruthy();
          expect(emittedFinal.isFinal).toBe(true);
          expect(emittedFinal.text).toBe('今天天气真好。');

          client.dispose();
        } finally {
          globalThis.fetch = originalFetch;
          (globalThis as any).window = originalWindow;
          (globalThis as any).Worker = originalWorker;
        }
      });

      it('Direct mode (Cloud-Only): skips local interim recognition during speech chunks and commits directly to cloud', async () => {
        const originalFetch = globalThis.fetch;
        const originalWindow = (globalThis as any).window;
        const originalWorker = (globalThis as any).Worker;

        (globalThis as any).window = {
          localStorage: {
            getItem: (key: string) => {
              if (key === 'xiaochun.stt.mode') return 'builtin';
              if (key === 'xiaochun.stt.strategy') return 'direct';
              return null;
            },
          },
        };

        let fetchCalledCount = 0;
        globalThis.fetch = vi.fn().mockImplementation(async (_url: string) => {
          fetchCalledCount++;
          return {
            ok: true,
            status: 200,
            json: async () => ({ text: '直接云端定稿识别文本' }),
          };
        });

        const workerPostMessages: any[] = [];
        (globalThis as any).Worker = class MockWorker {
          onmessage: any = null;
          postMessage(msg: any) {
            workerPostMessages.push(msg);
          }
          terminate() {}
        };

        try {
          const client = new SttClient();
          const emittedEvents: any[] = [];
          client.on((ev) => emittedEvents.push(ev));

          // Simulate incoming chunk in direct mode
          const pcmChunk = new Float32Array(8000).fill(0.05);
          (client as any).handleSpeechChunk(pcmChunk);

          // In direct mode, interim chunk does NOT trigger worker recognize message!
          const recognizeMsgs = workerPostMessages.filter((m) => m.type === 'recognize');
          expect(recognizeMsgs.length).toBe(0);
          expect(fetchCalledCount).toBe(0); // not yet committed

          // Now simulate commit
          await client.commitSession();

          // Full audio is sent in exactly 1 request to /api/stt
          expect(fetchCalledCount).toBe(1);
          const finalEvent = emittedEvents.find((e) => e.type === 'text' && e.isFinal);
          expect(finalEvent).toBeTruthy();
          expect(finalEvent.text).toBe('直接云端定稿识别文本。');

          client.dispose();
        } finally {
          globalThis.fetch = originalFetch;
          (globalThis as any).window = originalWindow;
          (globalThis as any).Worker = originalWorker;
        }
      });
    });
  });
});
