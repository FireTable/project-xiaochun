import { describe, expect, it, vi } from 'vitest';
import {
  DUPLEX_RING_SAMPLES,
  DuplexRingBuffer16k,
  StreamingLinearResampler,
} from '../duplexAudioWorklet';
import {
  DuplexEar,
  ECHO_DUCKING_GAIN,
} from '../duplexEar';
import {
  LIVE_SPEECH_SAMPLE_RATE,
  LiveSpeechPlayer,
  type AudioBufferLike,
  type AudioBufferSourceNodeLike,
  type AudioContextLike,
  type GainNodeLike,
} from '../liveSpeechPlayer';
import {
  WarmEdgeSocketPool,
  type EdgeWebSocketLike,
} from '@/server/warmEdgePool';

function makeSine16k(durationMs: number, amplitude: number, freqHz = 320): Float32Array {
  const len = Math.round((durationMs / 1000) * 16000);
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    out[i] = amplitude * Math.sin((2 * Math.PI * freqHz * i) / 16000);
  }
  return out;
}

function makeTone24k(durationSec: number, amplitude = 0.4): Float32Array {
  const len = Math.round(durationSec * LIVE_SPEECH_SAMPLE_RATE);
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    out[i] = amplitude * Math.sin((2 * Math.PI * 260 * i) / LIVE_SPEECH_SAMPLE_RATE);
  }
  return out;
}

function createMockAudioContext(getNow: () => number) {
  const fadeCurves: Array<{ values: Float32Array | number[]; startTime: number; duration: number }> = [];
  const scheduledStarts: number[] = [];
  const scheduledStops: number[] = [];

  const ctx: AudioContextLike = {
    get currentTime() {
      return getNow();
    },
    sampleRate: LIVE_SPEECH_SAMPLE_RATE,
    state: 'running',
    destination: { kind: 'destination' },
    createGain(): GainNodeLike {
      return {
        gain: {
          value: 1,
          setValueAtTime() {},
          linearRampToValueAtTime() {},
          setValueCurveAtTime(values, startTime, duration) {
            fadeCurves.push({ values, startTime, duration });
          },
          cancelScheduledValues() {},
        },
        connect() {},
        disconnect() {},
      };
    },
    createBuffer(_channels: number, length: number, sampleRate: number): AudioBufferLike {
      const ch0 = new Float32Array(length);
      return {
        length,
        sampleRate,
        getChannelData() {
          return ch0;
        },
      };
    },
    createBufferSource(): AudioBufferSourceNodeLike {
      return {
        buffer: null,
        onended: null,
        connect() {},
        disconnect() {},
        start(when = 0) {
          scheduledStarts.push(when);
        },
        stop(when = 0) {
          scheduledStops.push(when);
        },
      };
    },
  };

  return { ctx, fadeCurves, scheduledStarts, scheduledStops };
}

describe('LiveSpeechPlayer (24 kHz continuous WebAudio queue)', () => {
  it('computes exact sample-offset getHeardTranscript() across single and multiple clauses', () => {
    let nowSec = 10.0;
    const { ctx, scheduledStarts } = createMockAudioContext(() => nowSec);
    const chunkSizes: number[] = [];
    const startedSeqs: number[] = [];
    let drainedHeard = '';

    const player = new LiveSpeechPlayer({
      audioContext: ctx,
      autoTick: false,
      onPcmChunk: (ev) => chunkSizes.push(ev.chunk.length),
      onClauseStart: (ev) => startedSeqs.push(ev.seq),
      onDrain: (ev) => {
        drainedHeard = ev.heardText;
      },
    });

    const c1 = player.enqueueClause({ seq: 1, text: '你好世界', pcm24k: makeTone24k(1.0, 0.5) });
    const c2 = player.enqueueClause({ seq: 2, text: '今天晴天', pcm24k: makeTone24k(1.0, 0.3) });

    expect(c1.startSample).toBe(0);
    expect(c1.endSample).toBe(24_000);
    expect(c2.startSample).toBe(24_000);
    expect(c2.endSample).toBe(48_000);
    expect(scheduledStarts).toEqual([10.0, 11.0]);
    expect(chunkSizes.length).toBeGreaterThan(20);
    expect(startedSeqs).toEqual([1]);

    // 0%
    expect(player.getHeardTranscript()).toBe('');
    expect(player.getCurrentPlaybackRms()).toBeGreaterThan(0.2);

    // 50% of clause 1
    nowSec = 10.5;
    expect(player.getSampleOffset()).toBeCloseTo(12_000, 3);
    expect(player.getHeardTranscript()).toBe('你好');

    // End of clause 1 / start of clause 2
    nowSec = 11.0;
    player.tick(nowSec);
    expect(startedSeqs).toEqual([1, 2]);
    expect(player.getHeardTranscript()).toBe('你好世界');

    // 50% into clause 2
    nowSec = 11.5;
    expect(player.getSampleOffset()).toBeCloseTo(36_000, 3);
    expect(player.getHeardTranscript()).toBe('你好世界今天');

    // Drain at end
    nowSec = 12.0;
    player.tick(nowSec);
    expect(player.isPlaying()).toBe(false);
    expect(player.getCurrentPlaybackRms()).toBe(0);
    expect(drainedHeard).toBe('你好世界今天晴天');
    expect(player.getHeardTranscript()).toBe('你好世界今天晴天');

    player.dispose();
  });

  it('executes smooth 45ms cosine abortAndFade, cancels queued sources, and freezes heard substring', () => {
    let nowSec = 0.0;
    const { ctx, fadeCurves, scheduledStops } = createMockAudioContext(() => nowSec);
    let abortCallbackCount = 0;

    const player = new LiveSpeechPlayer({
      audioContext: ctx,
      autoTick: false,
      onAbort: () => {
        abortCallbackCount++;
      },
    });

    player.enqueueClause({ seq: 1, text: '你好世界', pcm24k: makeTone24k(1.0, 0.5) });
    player.enqueueClause({ seq: 2, text: '后续内容', pcm24k: makeTone24k(1.0, 0.5) });

    nowSec = 0.5;
    const abortRes = player.abortAndFade(45);

    expect(abortCallbackCount).toBe(1);
    expect(abortRes.fadeMs).toBe(45);
    expect(abortRes.sampleOffset).toBeCloseTo(12_000, 3);
    expect(abortRes.heardText).toBe('你好');

    // Cosine fade curve applied cleanly for 0.045s from 1.0 down to 0.0
    expect(fadeCurves.length).toBe(1);
    expect(fadeCurves[0]!.duration).toBeCloseTo(0.045, 5);
    const curve = Array.from(fadeCurves[0]!.values);
    expect(curve[0]).toBeCloseTo(1.0, 4);
    expect(curve[curve.length - 1]).toBe(0);
    expect(curve[Math.floor(curve.length / 2)]!).toBeGreaterThan(0.3);
    expect(curve[Math.floor(curve.length / 2)]!).toBeLessThan(0.7);

    // Active source stops at now + 0.045s, future queued source stops immediately at now (0.5s)
    expect(scheduledStops).toEqual([0.545, 0.5]);

    // Active playback state resets immediately
    expect(player.isPlaying()).toBe(false);
    expect(player.getCurrentPlaybackRms()).toBe(0);
    expect(player.getQueuedClauses()).toEqual([]);

    // Frozen heard transcript persists even after time continues advancing
    nowSec = 3.0;
    expect(player.getHeardTranscript()).toBe('你好');

    player.dispose();
  });
});

describe('DuplexAudioWorklet Ring + StreamingLinearResampler + DuplexEar', () => {
  it('resamples 48 kHz -> 16 kHz cleanly and maintains exact 8.0s (128000) end-aligned window', () => {
    const resampler = new StreamingLinearResampler(16_000);
    const in48k = new Float32Array(480); // 10ms @ 48kHz
    for (let i = 0; i < in48k.length; i++) in48k[i] = i / 480;
    const out16k = resampler.resample(in48k, 48_000);
    expect(out16k.length).toBe(160);

    const ring = new DuplexRingBuffer16k({ shared: false });
    const small = new Float32Array([0.1, 0.2, 0.3, 0.4]);
    ring.write(small);
    const winSmall = ring.readEndAlignedWindow();
    expect(winSmall.length).toBe(DUPLEX_RING_SAMPLES);
    expect(winSmall[0]).toBe(0);
    expect(winSmall[DUPLEX_RING_SAMPLES - 5]).toBe(0);
    expect(Array.from(winSmall.subarray(DUPLEX_RING_SAMPLES - 4)).map((v) => Number(v.toFixed(2)))).toEqual([
      0.1, 0.2, 0.3, 0.4,
    ]);

    // Overflow past 128,000 samples keeps newest samples end-aligned
    const filler = new Float32Array(DUPLEX_RING_SAMPLES);
    for (let i = 0; i < filler.length; i++) filler[i] = i + 1;
    ring.write(filler);
    const winFull = ring.readEndAlignedWindow();
    expect(winFull[0]).toBe(1);
    expect(winFull[DUPLEX_RING_SAMPLES - 1]).toBe(DUPLEX_RING_SAMPLES);
  });

  it('emits 260ms micro-pause and 350-550ms turn probes with end-aligned 8s PCM window', () => {
    const microProbes: Array<{ pauseMs: number; len: number; text: string }> = [];
    const turnProbes: Array<{ index: number; pauseMs: number; len: number; tailVal: number }> = [];

    const ear = new DuplexEar({
      enableAsr: false,
      microPauseMs: 260,
      turnProbeMs: 380,
      turnProbeRepeatMs: 160,
      onMicroPauseProbe: (ev) => {
        microProbes.push({ pauseMs: ev.pauseMs, len: ev.pcm16k.length, text: ev.fullText });
      },
      onTurnProbe: (ev) => {
        turnProbes.push({
          index: ev.probeIndex,
          pauseMs: ev.pauseMs,
          len: ev.pcm16k.length,
          tailVal: ev.pcm16k[ev.pcm16k.length - 1]!,
        });
      },
    });

    // 400ms of clear speech (amplitude 0.15 => ~ -19.5 dBFS) + 600ms of silence
    const speech = makeSine16k(400, 0.15);
    const silence = new Float32Array(Math.round(0.6 * 16000));
    ear.feedSimulatedPcm16k(speech, { transcriptHint: '今天天气真不错' });
    ear.feedSimulatedPcm16k(silence);

    expect(microProbes.length).toBe(1);
    expect(microProbes[0]!.pauseMs).toBeGreaterThanOrEqual(260);
    expect(microProbes[0]!.pauseMs).toBeLessThan(300);
    expect(microProbes[0]!.len).toBe(DUPLEX_RING_SAMPLES);
    expect(microProbes[0]!.text).toBe('今天天气真不错');

    expect(turnProbes.length).toBeGreaterThanOrEqual(2);
    expect(turnProbes[0]!.pauseMs).toBeGreaterThanOrEqual(360);
    expect(turnProbes[0]!.pauseMs).toBeLessThanOrEqual(420);
    expect(turnProbes[1]!.pauseMs).toBeGreaterThanOrEqual(520);
    expect(turnProbes[1]!.pauseMs).toBeLessThanOrEqual(580);
    expect(turnProbes[0]!.len).toBe(DUPLEX_RING_SAMPLES);
  });

  it('performs echo-aware 0.56x ducking instead of fixed -22 dBFS cutoff for soft vs loud double-talk', () => {
    let speaking = true;
    let playbackRms = 0.02; // Quiet assistant TTS (~ -34 dBFS)
    const bargeIns: Array<{ rmsDb: number; effectiveThresholdDb: number; duckingGain: number }> = [];

    const ear = new DuplexEar({
      enableAsr: false,
      bargeInMinMs: 20,
      isAssistantSpeakingProvider: () => speaking,
      playbackRmsProvider: () => playbackRms,
      onBargeInCandidate: (ev) => {
        bargeIns.push({
          rmsDb: ev.rmsDb,
          effectiveThresholdDb: ev.effectiveThresholdDb,
          duckingGain: ev.duckingGain,
        });
      },
    });

    // Soft user voice at 0.045 amplitude (~ -30 dBFS RMS, BELOW static -22 dBFS!)
    // Because playback is quiet (-34 dBFS), echo-aware threshold adapts down to -42 dBFS -> SHOULD trigger!
    const softUser = makeSine16k(80, 0.045);
    ear.feedSimulatedPcm16k(softUser);

    expect(bargeIns.length).toBe(1);
    expect(bargeIns[0]!.duckingGain).toBe(ECHO_DUCKING_GAIN);
    expect(bargeIns[0]!.effectiveThresholdDb).toBe(-42);
    expect(bargeIns[0]!.rmsDb).toBeLessThan(-22);

    // Verify 0.56x attenuation stored in rolling buffer
    const win = ear.getRollingWindow16k();
    const expectedTail = softUser[softUser.length - 1]! * ECHO_DUCKING_GAIN;
    expect(win[DUPLEX_RING_SAMPLES - 1]).toBeCloseTo(expectedTail, 5);

    // Now test LOUD playback (0.50 RMS ~ -6 dBFS): adaptive threshold rises to -6 - 18 + 6 = -18 dBFS.
    // Moderate residual speaker bleed (-22 dBFS ~ 0.11 amp sine) must NOT false-trigger barge-in!
    ear.setAssistantPlaybackState(false); // reset cycle
    speaking = false;
    ear.feedSimulatedPcm16k(new Float32Array(4000)); // clear cooldown (250ms)

    playbackRms = 0.5;
    speaking = true;
    ear.setAssistantPlaybackState(true, 0.5);
    bargeIns.length = 0;

    const bleedSignal = makeSine16k(80, 0.11); // ~ -22.2 dBFS RMS
    ear.feedSimulatedPcm16k(bleedSignal);
    expect(bargeIns.length).toBe(0);
    expect(ear.getDuckingState().effectiveThresholdDb).toBeCloseTo(-18, 0);

    // Direct close-mic user speech (-12 dBFS ~ 0.35 amp sine) DOES trigger!
    const loudUser = makeSine16k(80, 0.35);
    ear.feedSimulatedPcm16k(loudUser);
    expect(bargeIns.length).toBe(1);
  });

  it('startMic calls getUserMedia immediately without awaiting ASR, wires sink-connected worklet, and emits final turn probe without duplicate recognized text', async () => {
    let resolveAsr!: () => void;
    const asrListeners = new Map<string, Set<(payload: any) => void>>();
    let recognizerReady = false;

    const fakeRecognizer = {
      get isReady() {
        return recognizerReady;
      },
      on(event: string, listener: (payload: any) => void) {
        let set = asrListeners.get(event);
        if (!set) {
          set = new Set();
          asrListeners.set(event, set);
        }
        set.add(listener);
        return () => set!.delete(listener);
      },
      off(event: string, listener: (payload: any) => void) {
        asrListeners.get(event)?.delete(listener);
      },
      init: () =>
        new Promise<void>((resolve) => {
          resolveAsr = () => {
            recognizerReady = true;
            resolve();
          };
        }),
      feed: vi.fn(),
      reset: vi.fn(),
      destroy: vi.fn(),
    };

    const emitAsr = (event: string, payload: any) => {
      for (const fn of asrListeners.get(event) ?? []) fn(payload);
    };

    const connections: Array<{ from: string; to: string }> = [];
    const fakeDestination = { __nodeName: 'destination' };
    const fakeMuteGain = {
      __nodeName: 'muteGain',
      gain: { value: 1 },
      connect: vi.fn((dest: any) => {
        connections.push({ from: 'muteGain', to: dest?.__nodeName ?? 'unknown' });
        return dest;
      }),
      disconnect: vi.fn(),
    };
    const fakeSourceNode = {
      __nodeName: 'source',
      connect: vi.fn((dest: any) => {
        connections.push({ from: 'source', to: dest?.__nodeName ?? 'unknown' });
        return dest;
      }),
      disconnect: vi.fn(),
    };

    let createdWorkletOpts: any = null;
    let createdWorklet: FakeAudioWorkletNode | null = null;
    class FakeAudioWorkletNode {
      __nodeName = 'worklet';
      port = {
        onmessage: null as ((ev: MessageEvent) => void) | null,
        postMessage: vi.fn(),
      };
      connect = vi.fn((dest: any) => {
        connections.push({ from: 'worklet', to: dest?.__nodeName ?? 'unknown' });
        return dest;
      });
      disconnect = vi.fn();
      constructor(_ctx: any, _name: string, opts?: any) {
        createdWorkletOpts = opts;
        createdWorklet = this;
      }
    }

    const fakeTrackStop = vi.fn();
    const fakeStream = {
      getTracks: () => [{ stop: fakeTrackStop }],
      getAudioTracks: () => [{ stop: fakeTrackStop }],
    };
    const getUserMedia = vi.fn(async () => fakeStream);

    const fakeAudioCtx = {
      state: 'running',
      sampleRate: 16_000,
      destination: fakeDestination,
      audioWorklet: {
        addModule: vi.fn(async () => {}),
      },
      resume: vi.fn(async () => {}),
      close: vi.fn(async () => {}),
      createMediaStreamSource: vi.fn(() => fakeSourceNode),
      createGain: vi.fn(() => fakeMuteGain),
    };

    vi.stubGlobal('window', { isSecureContext: true });
    vi.stubGlobal('isSecureContext', true);
    vi.stubGlobal('navigator', {
      mediaDevices: { getUserMedia },
    });
    vi.stubGlobal('AudioWorkletNode', FakeAudioWorkletNode);
    vi.stubGlobal(
      'AudioContext',
      vi.fn(function FakeAudioContext() {
        return fakeAudioCtx;
      }),
    );

    const turnProbes: Array<{ stableText: string; fullText: string }> = [];
    const ear = new DuplexEar({
      enableAsr: true,
      recognizerFactory: () => fakeRecognizer,
      onTurnProbe: (ev) => {
        turnProbes.push({ stableText: ev.stableText, fullText: ev.fullText });
      },
    });

    try {
      await ear.startMic({ awaitAsr: false });

      expect(getUserMedia).toHaveBeenCalledTimes(1);
      expect(ear.getState().micActive).toBe(true);
      expect(ear.getState().asrReady).toBe(false);
      expect(createdWorkletOpts?.numberOfOutputs).toBe(1);
      expect(fakeMuteGain.gain.value).toBe(0);
      expect(connections).toEqual(
        expect.arrayContaining([
          { from: 'source', to: 'worklet' },
          { from: 'worklet', to: 'muteGain' },
          { from: 'muteGain', to: 'destination' },
        ]),
      );

      // Resolve deferred ASR initialization after mic is already live
      resolveAsr();
      await Promise.resolve();
      await Promise.resolve();
      expect(ear.getState().asrReady).toBe(true);

      // Drive ambient silence then active speech through worklet.port.onmessage
      const workletOnMessage = (createdWorklet as FakeAudioWorkletNode | null)?.port.onmessage;
      expect(typeof workletOnMessage).toBe('function');
      workletOnMessage!({ data: { type: 'pcm', pcm: new Float32Array(1600).fill(0.001) } } as MessageEvent);
      const speechSamples = makeSine16k(240, 0.28);
      for (let i = 0; i < speechSamples.length; i += 320) {
        workletOnMessage!({
          data: { type: 'pcm', pcm: speechSamples.slice(i, i + 320) },
        } as MessageEvent);
      }

      // recognizer emits final recognizing and then recognized for the same utterance:
      // neither should duplicate text nor miss emitting onTurnProbe.
      emitAsr('recognizing', { text: '你好', isFinal: false, vadState: 1 });
      emitAsr('recognizing', { text: '你好呀', isFinal: true, vadState: 0 });
      emitAsr('recognized', { text: '你好呀' });

      expect(turnProbes.length).toBe(1);
      expect(turnProbes[0]?.fullText).toBe('你好，呀。');

      // Stale recognized right after markTurnCommitted must be ignored
      ear.markTurnCommitted(true);
      emitAsr('recognized', { text: '你好呀' });
      expect(turnProbes.length).toBe(1);
    } finally {
      await ear.stop();
      expect(fakeTrackStop).toHaveBeenCalled();
      vi.unstubAllGlobals();
    }
  });
});

describe('WarmEdgeSocketPool (persistent 2-socket WS lifecycle & prosody guard)', () => {
  function encodeAudioFrame(payload: Uint8Array, pathHeader = 'Path:audio\r\nContent-Type:audio/mpeg\r\n'): Uint8Array {
    const hdr = new TextEncoder().encode(pathHeader);
    const out = new Uint8Array(2 + hdr.byteLength + payload.byteLength);
    out[0] = (hdr.byteLength >> 8) & 0xff;
    out[1] = hdr.byteLength & 0xff;
    out.set(hdr, 2);
    out.set(payload, 2 + hdr.byteLength);
    return out;
  }

  function createFakeSocketClass() {
    const created: Array<{ url: string; headers: Record<string, string>; sent: string[]; closed: boolean }> = [];

    const factory = (url: string, headers: Record<string, string>): EdgeWebSocketLike => {
      const listeners = new Map<string, Set<(ev: any) => void>>();
      const emit = (type: string, ev: any) => {
        for (const fn of listeners.get(type) ?? []) fn(ev);
      };
      const record = { url, headers, sent: [] as string[], closed: false };
      created.push(record);

      const sock: EdgeWebSocketLike = {
        readyState: 1,
        binaryType: 'arraybuffer',
        addEventListener(type, fn) {
          if (!listeners.has(type)) listeners.set(type, new Set());
          listeners.get(type)!.add(fn);
        },
        removeEventListener(type, fn) {
          listeners.get(type)?.delete(fn);
        },
        send(data) {
          const str = typeof data === 'string' ? data : '';
          record.sent.push(str);
          if (str.includes('Path:ssml')) {
            queueMicrotask(() => {
              emit('message', {
                data: encodeAudioFrame(new Uint8Array([0xff, 0xfb, 0x90, 0x00])).buffer,
              });
              queueMicrotask(() => {
                emit('message', { data: 'X-RequestId:1\r\nPath:turn.end\r\n\r\n{}' });
              });
            });
          }
        },
        close() {
          record.closed = true;
          emit('close', {});
        },
      };

      queueMicrotask(() => emit('open', {}));
      return sock;
    };

    return { factory, created };
  }

  it('reuses 2 warm Sec-MS-GEC v2 sockets across turns and never emits mstts:express-as', async () => {
    const { factory, created } = createFakeSocketClass();
    const pool = new WarmEdgeSocketPool({ poolSize: 2, socketFactory: factory });

    const warmStats = await pool.warm();
    expect(warmStats.idleSockets).toBe(2);
    expect(created.length).toBe(2);
    expect(created[0]!.url).toContain('Ocp-Apim-Subscription-Key=');

    const chunks1: Uint8Array[] = [];
    const res1 = await pool.synthesizeStream({
      text: '第一句测试',
      voice: 'zh-CN-XiaoyiNeural',
      pitch: '+18Hz',
      rate: '+8%',
      volume: '+5%',
      onChunk: (c) => {
        chunks1.push(c);
      },
    });
    expect(res1.warmHit).toBe(true);
    expect(res1.totalBytes).toBe(4);

    // Second turn should still hit the warm pool with zero extra socket connects
    const chunks2: Uint8Array[] = [];
    const res2 = await pool.synthesizeStream({
      text: '第二句复用',
      onChunk: (c) => {
        chunks2.push(c);
      },
    });
    expect(res2.warmHit).toBe(true);
    expect(created.length).toBe(2);

    // Verify zero <mstts:express-as> in transmitted SSML
    const ssmlPayloads = created.flatMap((s) => s.sent).filter((s) => s.includes('Path:ssml'));
    expect(ssmlPayloads.length).toBe(2);
    for (const ssml of ssmlPayloads) {
      expect(ssml).toContain('<prosody ');
      expect(ssml).not.toContain('mstts:express-as');
    }

    const stats = pool.getStats();
    expect(stats.totalWarmHits).toBe(2);
    expect(stats.totalColdMisses).toBe(0);

    pool.dispose();
  });
});


describe('Live-Mic AGC Room Noise, Punctuation Finalization & AudioContext Suspend Recovery', () => {
  it('releases inSpeech despite AGC room noise, surpasses 4-probe cap, finalizes punctuation on recognized, and replaces refined tail without duplication', async () => {
    const listeners = new Map<string, Array<(payload: any) => void>>();
    const emit = (event: string, payload: any) => {
      for (const fn of listeners.get(event) ?? []) fn(payload);
    };
    const fakeRec = {
      isReady: true,
      on(event: string, fn: (payload: any) => void) {
        if (!listeners.has(event)) listeners.set(event, []);
        listeners.get(event)!.push(fn);
      },
      async init() {},
      feed() {},
      reset() {},
      destroy() {},
    };

    const probes: Array<{ probeIndex: number; pauseMs: number; fullText: string }> = [];
    const transcripts: Array<{ fullText: string; isFinal: boolean }> = [];
    const ear = new DuplexEar({
      enableAsr: true,
      speechThresholdDb: -42,
      recognizerFactory: () => fakeRec,
      onTurnProbe: (ev) => probes.push({ probeIndex: ev.probeIndex, pauseMs: ev.pauseMs, fullText: ev.fullText }),
      onTranscript: (ev) => transcripts.push({ fullText: ev.fullText, isFinal: ev.isFinal }),
    });

    await ear.initAsr();
    // Simulate live microphone Worklet active with -52 dBFS noise floor
    (ear as unknown as { running: boolean; micActive: boolean; ambientFloorDb: number }).running = true;
    (ear as unknown as { micActive: boolean; ambientFloorDb: number }).micActive = true;
    (ear as unknown as { ambientFloorDb: number }).ambientFloorDb = -52;

    // 400ms real speech with neural VAD=1
    const speechFrame = makeSine16k(20, 0.15);
    for (let i = 0; i < 20; i++) {
      if (i === 2) emit('vad_state_change', { state: 1 });
      ear.feedSimulatedPcm16k(speechFrame);
    }
    emit('recognizing', { text: '哈哈哈。oh,我把橄榄树倒', isFinal: false });
    expect(ear.getState().inSpeech).toBe(true);

    // Neural VAD drops to 0 while AGC room noise stays at ~-34 dBFS (above -42 dBFS threshold)
    emit('vad_state_change', { state: 0 });
    const agcNoiseFrame = makeSine16k(20, 0.028);
    for (let i = 0; i < 95; i++) {
      ear.feedSimulatedPcm16k(agcNoiseFrame);
    }

    // Old 4-probe cap stopped at 860ms; new 14-probe cap continues past 1400ms
    expect(probes.length).toBeGreaterThanOrEqual(8);
    expect(probes[probes.length - 1]!.pauseMs).toBeGreaterThanOrEqual(1400);

    // StreamRecognizer emits recognizing(isFinal=true) then recognized
    emit('recognizing', { text: '哈哈哈。oh,我把橄榄树倒', isFinal: true });
    emit('recognized', { text: '哈哈哈。oh,我把橄榄树倒', isRefined: false });

    const latestTranscript = transcripts[transcripts.length - 1]!;
    expect(latestTranscript.isFinal).toBe(true);
    expect(latestTranscript.fullText).toBe('哈哈哈。oh,我把橄榄树倒。');
    expect(ear.getState().inSpeech).toBe(false);
    expect(ear.getState().vadState).toBe(0);

    const lastProbe = probes[probes.length - 1]!;
    expect(lastProbe.pauseMs).toBeGreaterThanOrEqual(1500);
    expect(lastProbe.fullText).toBe('哈哈哈。oh,我把橄榄树倒。');

    // Second-pass refiner replaces the segment in-place without concatenating twice
    emit('recognized', { text: '哈哈哈。oh，我把橄榄树倒了', isRefined: true });
    const refinedState = ear.getState();
    expect(refinedState.stableText).toBe('哈哈哈。oh，我把橄榄树倒了。');

    await ear.dispose();
  });

  it('drains LiveSpeechPlayer via wall-clock fallback when AudioContext is suspended and currentTime freezes (even if onClockTick checks isPlaying)', async () => {
    const mock = createMockAudioContext(() => 1.0);
    (mock.ctx as unknown as { state: string }).state = 'suspended';

    let drained = false;
    let clockTicks = 0;
    const player = new LiveSpeechPlayer({
      audioContext: mock.ctx,
      autoTick: true,
      onClockTick: () => {
        clockTicks += 1;
        // Re-entrant isPlaying() check (as in LiveStudioController.onClockTick) must not overflow the call stack.
        expect(typeof player.isPlaying()).toBe('boolean');
      },
      onDrain: () => {
        drained = true;
      },
    });

    await player.enqueueClause({
      seq: 0,
      text: '挂起时钟恢复测试。',
      pcm24k: makeTone24k(0.08),
    });

    expect(player.isPlaying()).toBe(true);
    await new Promise((r) => setTimeout(r, 150));

    expect(player.isPlaying()).toBe(false);
    expect(clockTicks).toBeGreaterThan(0);
    expect(drained).toBe(true);
    player.dispose();
  });
});
