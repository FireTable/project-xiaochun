/**
 * duplexEar.ts — Off-main-thread continuous 16 kHz full-duplex acoustic ear (Layer 1A).
 *
 * Features:
 * - Captures microphone audio via WebAudio AudioWorklet (`duplexAudioWorklet.ts`) with
 *   `SharedArrayBuffer` lock-free ring buffer (8.0s / 128,000 samples @ 16 kHz) and
 *   automatic `MessagePort` fallback when `crossOriginIsolated` is false.
 * - Accepts headless deterministic PCM streams (`feedSimulatedPcm16k`) using sample-clock
 *   timestamps so automated browser/Vitest suites exercise identical VAD, ducking, pause
 *   probing, and 8s end-aligned PCM windows without a physical microphone.
 * - Integrates `@firetable/stream-asr` WASM in continuous streaming mode (`mode: 3`).
 * - Runs echo-aware double-talk ducking (`0.56×` / `-5 dB` gain scaling during playback)
 *   and computes an adaptive double-talk threshold from live playback RMS instead of a
 *   static `-22 dBFS` bleed gate, emitting instantaneous `onBargeInCandidate` events.
 * - Emits `~260 ms` micro-pause speculative probes (`onMicroPauseProbe`) and
 *   `350–550 ms` turn-prediction probes (`onTurnProbe`) carrying an end-aligned 8s
 *   (`128,000`-sample) left-zero-padded PCM window for `DuplexTurnClient`.
 */

import { StreamRecognizer } from '@firetable/stream-asr';
import { APP_CONFIG } from '@/config';
import { finalizePunctuation, formatDraftPunctuation } from '@/stt/punctuation';
import {
  DUPLEX_RING_SAMPLES,
  DUPLEX_SAMPLE_RATE,
  DUPLEX_WORKLET_NAME,
  DuplexRingBuffer16k,
  StreamingLinearResampler,
  createDuplexWorkletBlobUrl,
} from './duplexAudioWorklet';

export const ECHO_DUCKING_GAIN = 0.56; // -5 dB double-talk attenuation
export const DEFAULT_MICRO_PAUSE_MS = 260;
export const DEFAULT_TURN_PROBE_MS = 380; // inside 350–550 ms probe window
export const DEFAULT_TURN_PROBE_REPEAT_MS = 160;
export const DEFAULT_SPEECH_THRESHOLD_DB = -42;
export const DEFAULT_AEC_SUPPRESSION_DB = 18;
export const DEFAULT_DOUBLE_TALK_MARGIN_DB = 6;
export const DEFAULT_TTS_COOLDOWN_MS = 160;
export const DEFAULT_SIMULATED_FRAME_SAMPLES = 320; // 20 ms @ 16 kHz

export interface StreamRecognizerLike {
  readonly isReady: boolean;
  on(event: string, listener: (payload: any) => void): unknown;
  off?(event: string, listener: (payload: any) => void): unknown;
  init(): Promise<void>;
  feed(inputPcm: Float32Array, inputSampleRate?: number, isFinal?: boolean): void;
  finish?(): void;
  reset(): void;
  destroy(): void;
}

export interface DuplexTranscriptEvent {
  stableText: string;
  tailText: string;
  fullText: string;
  isFinal: boolean;
  isRefined?: boolean;
  vadState: 0 | 1 | 2;
  audioTimeMs: number;
}

export interface DuplexPauseProbeEvent {
  probeIndex: number;
  pauseMs: number;
  speechDurationMs: number;
  audioTimeMs: number;
  stableText: string;
  tailText: string;
  fullText: string;
  rmsDb: number;
  assistantSpeaking: boolean;
  pcm16k: Float32Array;
}

export interface DuplexBargeInEvent {
  audioTimeMs: number;
  rmsDb: number;
  effectiveThresholdDb: number;
  playbackRms: number;
  playbackDb: number;
  duckingGain: number;
  partialText: string;
}

export interface DuplexRmsEvent {
  rms: number;
  rmsDb: number;
  duckedRms: number;
  effectiveThresholdDb: number;
  duckingActive: boolean;
  duckingGain: number;
  assistantSpeaking: boolean;
  vadState: 0 | 1 | 2;
  audioTimeMs: number;
}

export interface DuplexDuckingSnapshot {
  active: boolean;
  gain: number;
  playbackRms: number;
  playbackDb: number;
  effectiveThresholdDb: number;
  lastMicDb: number;
}

export interface DuplexEarState {
  running: boolean;
  micActive: boolean;
  asrReady: boolean;
  sharedRingActive: boolean;
  inSpeech: boolean;
  vadState: 0 | 1 | 2;
  audioTimeMs: number;
  speechDurationMs: number;
  silenceMs: number;
  stableText: string;
  tailText: string;
  ducking: DuplexDuckingSnapshot;
}

export interface DuplexEarOptions {
  enableAsr?: boolean;
  vadThreshold?: number;
  microPauseMs?: number;
  turnProbeMs?: number;
  turnProbeRepeatMs?: number;
  maxTurnProbesPerUtterance?: number;
  minUtteranceSpeechMs?: number;
  speechThresholdDb?: number;
  aecSuppressionDb?: number;
  doubleTalkMarginDb?: number;
  ttsCooldownMs?: number;
  bargeInMinMs?: number;
  playbackRmsProvider?: () => number;
  isAssistantSpeakingProvider?: () => boolean;
  recognizerFactory?: () => StreamRecognizerLike;
  onTranscript?: (event: DuplexTranscriptEvent) => void;
  onMicroPauseProbe?: (event: DuplexPauseProbeEvent) => void;
  onTurnProbe?: (event: DuplexPauseProbeEvent) => void;
  onBargeInCandidate?: (event: DuplexBargeInEvent) => void;
  onRms?: (event: DuplexRmsEvent) => void;
  onStateChange?: (state: DuplexEarState) => void;
  onAsrProgress?: (percent: number) => void;
  onError?: (error: Error) => void;
}

function rmsToDb(rms: number): number {
  return 20 * Math.log10(Math.max(rms, 1e-7));
}

function computeChunkRms(chunk: Float32Array): number {
  if (chunk.length === 0) return 0;
  let sumSq = 0;
  for (let i = 0; i < chunk.length; i++) {
    const v = chunk[i] ?? 0;
    sumSq += v * v;
  }
  return Math.sqrt(sumSq / chunk.length);
}

export class DuplexEar {
  static readonly SAMPLE_RATE = DUPLEX_SAMPLE_RATE;
  static readonly RING_SAMPLES = DUPLEX_RING_SAMPLES;
  static readonly ECHO_DUCKING_GAIN = ECHO_DUCKING_GAIN;

  private readonly enableAsr: boolean;
  private readonly vadThreshold: number;
  private readonly microPauseMs: number;
  private readonly turnProbeMs: number;
  private readonly turnProbeRepeatMs: number;
  private readonly maxTurnProbesPerUtterance: number;
  private readonly minUtteranceSpeechMs: number;
  private readonly speechThresholdDb: number;
  private readonly aecSuppressionDb: number;
  private readonly doubleTalkMarginDb: number;
  private readonly ttsCooldownMs: number;
  private readonly bargeInMinMs: number;

  private playbackRmsProvider?: () => number;
  private isAssistantSpeakingProvider?: () => boolean;
  private readonly recognizerFactory?: () => StreamRecognizerLike;

  private onTranscript?: (event: DuplexTranscriptEvent) => void;
  private onMicroPauseProbe?: (event: DuplexPauseProbeEvent) => void;
  private onTurnProbe?: (event: DuplexPauseProbeEvent) => void;
  private onBargeInCandidate?: (event: DuplexBargeInEvent) => void;
  private onRms?: (event: DuplexRmsEvent) => void;
  private onStateChange?: (state: DuplexEarState) => void;
  private onAsrProgress?: (percent: number) => void;
  private onError?: (error: Error) => void;

  private readonly ringBuffer: DuplexRingBuffer16k;
  private recognizer: StreamRecognizerLike | null = null;
  private asrInitPromise: Promise<void> | null = null;

  private micStream: MediaStream | null = null;
  private micCtx: AudioContext | null = null;
  private micSource: MediaStreamAudioSourceNode | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private micMuteGain: GainNode | null = null;
  private fallbackProcessor: ScriptProcessorNode | null = null;

  private running = false;
  private micActive = false;
  private manualAssistantSpeaking = false;
  private manualPlaybackRms = 0;
  private wasAssistantSpeaking = false;
  private ttsCooldownUntilMs = -1;

  private sampleClockSamples = 0;
  private vadState: 0 | 1 | 2 = 0;
  private recognizerVadState: 0 | 1 | 2 = 0;
  private lastNeuralSpeechAtMs = -10_000;
  private inSpeech = false;
  private lastVoiceActiveMs = 0;
  private speechAccumulatedMs = 0;
  private consecutiveDoubleTalkMs = 0;
  private bargeInEmittedThisPlayback = false;
  private microPauseFired = false;
  private turnProbeCount = 0;
  private lastTurnProbeMs = 0;
  private hasUncommittedAsrText = false;

  private committedTranscript = '';
  private draftTranscript = '';
  private lastRecognizedSegment = '';
  private lastCommittedUtteranceText = '';
  private lastCommittedAtMs = -10_000;

  private lastMicDb = -100;
  private ambientFloorDb = -52;
  private lastPlaybackRms = 0;
  private lastPlaybackDb = -100;
  private lastEffectiveThresholdDb: number;
  private lastDuckingActive = false;
  private lastDuckingGain = 1;

  constructor(options: DuplexEarOptions = {}) {
    this.enableAsr = options.enableAsr ?? true;
    this.vadThreshold = options.vadThreshold ?? APP_CONFIG.stt.vadThreshold ?? 0.5;
    this.microPauseMs = options.microPauseMs ?? DEFAULT_MICRO_PAUSE_MS;
    this.turnProbeMs = options.turnProbeMs ?? DEFAULT_TURN_PROBE_MS;
    this.turnProbeRepeatMs = options.turnProbeRepeatMs ?? DEFAULT_TURN_PROBE_REPEAT_MS;
    this.maxTurnProbesPerUtterance = options.maxTurnProbesPerUtterance ?? 14;
    this.minUtteranceSpeechMs = options.minUtteranceSpeechMs ?? 120;
    this.speechThresholdDb = options.speechThresholdDb ?? DEFAULT_SPEECH_THRESHOLD_DB;
    this.aecSuppressionDb = options.aecSuppressionDb ?? DEFAULT_AEC_SUPPRESSION_DB;
    this.doubleTalkMarginDb = options.doubleTalkMarginDb ?? DEFAULT_DOUBLE_TALK_MARGIN_DB;
    this.ttsCooldownMs = options.ttsCooldownMs ?? DEFAULT_TTS_COOLDOWN_MS;
    this.bargeInMinMs = options.bargeInMinMs ?? 20;

    this.playbackRmsProvider = options.playbackRmsProvider;
    this.isAssistantSpeakingProvider = options.isAssistantSpeakingProvider;
    this.recognizerFactory = options.recognizerFactory;

    this.onTranscript = options.onTranscript;
    this.onMicroPauseProbe = options.onMicroPauseProbe;
    this.onTurnProbe = options.onTurnProbe;
    this.onBargeInCandidate = options.onBargeInCandidate;
    this.onRms = options.onRms;
    this.onStateChange = options.onStateChange;
    this.onAsrProgress = options.onAsrProgress;
    this.onError = options.onError;

    this.lastEffectiveThresholdDb = this.speechThresholdDb;

    const sabSupported =
      typeof crossOriginIsolated !== 'undefined' &&
      crossOriginIsolated === true &&
      typeof SharedArrayBuffer !== 'undefined';

    this.ringBuffer = new DuplexRingBuffer16k({
      capacity: DUPLEX_RING_SAMPLES,
      shared: sabSupported,
    });
  }

  setPlaybackReferenceProviders(providers: {
    playbackRmsProvider?: () => number;
    isAssistantSpeakingProvider?: () => boolean;
  }): void {
    if ('playbackRmsProvider' in providers) {
      this.playbackRmsProvider = providers.playbackRmsProvider;
    }
    if ('isAssistantSpeakingProvider' in providers) {
      this.isAssistantSpeakingProvider = providers.isAssistantSpeakingProvider;
    }
  }

  setCallbacks(callbacks: {
    onTranscript?: (event: DuplexTranscriptEvent) => void;
    onMicroPauseProbe?: (event: DuplexPauseProbeEvent) => void;
    onTurnProbe?: (event: DuplexPauseProbeEvent) => void;
    onBargeInCandidate?: (event: DuplexBargeInEvent) => void;
    onRms?: (event: DuplexRmsEvent) => void;
    onStateChange?: (state: DuplexEarState) => void;
  }): void {
    if ('onTranscript' in callbacks) this.onTranscript = callbacks.onTranscript;
    if ('onMicroPauseProbe' in callbacks) this.onMicroPauseProbe = callbacks.onMicroPauseProbe;
    if ('onTurnProbe' in callbacks) this.onTurnProbe = callbacks.onTurnProbe;
    if ('onBargeInCandidate' in callbacks) this.onBargeInCandidate = callbacks.onBargeInCandidate;
    if ('onRms' in callbacks) this.onRms = callbacks.onRms;
    if ('onStateChange' in callbacks) this.onStateChange = callbacks.onStateChange;
  }

  /**
   * Optional manual playback state override (convenient in tests or when no LiveSpeechPlayer
   * provider callback is attached).
   */
  setAssistantPlaybackState(speaking: boolean, playbackRms = 0): void {
    if (this.manualAssistantSpeaking && !speaking) {
      this.ttsCooldownUntilMs = this.getAudioTimeMs() + this.ttsCooldownMs;
    }
    if (!this.manualAssistantSpeaking && speaking) {
      this.bargeInEmittedThisPlayback = false;
      this.consecutiveDoubleTalkMs = 0;
    }
    this.manualAssistantSpeaking = speaking;
    this.manualPlaybackRms = Math.max(0, playbackRms);
  }

  async initAsr(): Promise<void> {
    if (!this.enableAsr) return;
    if (this.recognizer?.isReady) return;
    if (this.asrInitPromise) return this.asrInitPromise;

    this.asrInitPromise = (async () => {
      const rec = this.recognizerFactory
        ? this.recognizerFactory()
        : (new StreamRecognizer({
            modelUrl: APP_CONFIG.stt.modelUrl,
            wasmBaseUrl: APP_CONFIG.stt.wasmBaseUrl,
            modelVersion: APP_CONFIG.stt.modelVersion ?? '1.0.0',
            mode: 3,
            vadThreshold: this.vadThreshold,
            minSpeechDurationMs: 240,
            maxPauseDurationMs: 1200,
            sampleRate: DUPLEX_SAMPLE_RATE,
            numThreads: 'auto',
            debug: false,
          }) as unknown as StreamRecognizerLike);

      rec.on('download_progress', (ev: { percent?: number }) => {
        if (typeof ev?.percent === 'number') {
          this.onAsrProgress?.(ev.percent);
        }
      });

      rec.on('vad_state_change', (ev: { state?: 0 | 1 | 2 }) => {
        if (ev?.state === 0 || ev?.state === 1 || ev?.state === 2) {
          this.vadState = ev.state;
          this.recognizerVadState = ev.state;
          if (ev.state === 1) {
            this.lastNeuralSpeechAtMs = this.getAudioTimeMs();
          }
        }
      });

      rec.on('recognizing', (ev: { text?: string; isFinal?: boolean; isRefined?: boolean }) => {
        if (ev?.isFinal || ev?.isRefined) {
          // Final/refined results arrive on `recognized` right after; commit with terminal punctuation there.
          return;
        }
        const formatted = formatDraftPunctuation(ev?.text ?? '');
        this.draftTranscript = formatted;
        if (this.getFullTranscript().trim().length > 0) {
          this.hasUncommittedAsrText = true;
        }
        this.emitTranscript(false, ev?.isRefined);
      });

      rec.on('recognized', (ev: { text?: string; isRefined?: boolean }) => {
        const rawText = (ev?.text ?? '').trim();

        const normRaw = rawText.replace(/[\s,，。？！?!、.．…~～]+/g, '');
        const normCommitted = this.lastCommittedUtteranceText.replace(
          /[\s,，。？！?!、.．…~～]+/g,
          '',
        );
        const duplicateOfRecentTurn =
          !this.inSpeech &&
          normRaw.length > 0 &&
          normRaw === normCommitted &&
          this.getAudioTimeMs() - this.lastCommittedAtMs < 2500;
        if (duplicateOfRecentTurn) {
          return;
        }

        const cleanedRaw = rawText.replace(/[,，、;；]+$/u, '').trim();
        const text = cleanedRaw ? finalizePunctuation(cleanedRaw) || cleanedRaw : '';
        if (text) {
          if (
            ev?.isRefined &&
            this.lastRecognizedSegment &&
            this.committedTranscript.endsWith(this.lastRecognizedSegment)
          ) {
            const prefix = this.committedTranscript
              .slice(0, this.committedTranscript.length - this.lastRecognizedSegment.length)
              .trim();
            this.committedTranscript = this.joinTranscripts(prefix, text);
          } else {
            this.committedTranscript = this.joinTranscripts(this.committedTranscript, text);
          }
          this.lastRecognizedSegment = text;
        }
        this.draftTranscript = '';
        const combined = this.getFullTranscript().trim();
        if (combined.length > 0) {
          this.hasUncommittedAsrText = true;
        }
        if (rawText.length > 0) {
          this.inSpeech = false;
          this.vadState = 0;
          this.recognizerVadState = 0;
        }
        this.emitTranscript(true, ev?.isRefined);
        this.emitState();

        if (this.micActive && this.hasUncommittedAsrText && combined.length > 0) {
          const audioTimeMs = this.getAudioTimeMs();
          const rawSpeaking =
            (this.isAssistantSpeakingProvider?.() ?? false) ||
            this.manualAssistantSpeaking ||
            audioTimeMs <= this.ttsCooldownUntilMs;
          const silenceMs = Math.max(
            audioTimeMs - this.lastVoiceActiveMs,
            this.turnProbeMs,
            1500,
          );
          const probe = this.buildPauseProbe(
            this.turnProbeCount++,
            silenceMs,
            audioTimeMs,
            rawSpeaking,
            this.lastMicDb,
          );
          probe.speechDurationMs = Math.max(probe.speechDurationMs, 420);
          this.onTurnProbe?.(probe);
        }
      });

      rec.on('error', (err: Error) => {
        this.onError?.(err instanceof Error ? err : new Error(String(err)));
      });

      this.recognizer = rec;
      await rec.init();
      this.emitState();
    })();

    try {
      await this.asrInitPromise;
    } catch (err) {
      this.asrInitPromise = null;
      this.recognizer = null;
      throw err;
    }
  }

  /**
   * Starts continuous browser microphone capture with hardware AEC (`echoCancellation: true`)
   * and off-main-thread 16 kHz resampling AudioWorklet.
   */
  async startMic(opts?: { awaitAsr?: boolean }): Promise<void> {
    if (this.micActive) return;

    if (typeof window !== 'undefined' && 'isSecureContext' in window && !window.isSecureContext) {
      throw new Error('Microphone requires HTTPS or localhost secure context');
    }

    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      throw new Error('Microphone getUserMedia API is unavailable in this environment');
    }

    let asrTask: Promise<void> | null = null;
    if (this.enableAsr && !this.recognizer?.isReady) {
      asrTask = this.initAsr().catch((err) => {
        this.onError?.(err instanceof Error ? err : new Error(String(err)));
      });
      if (opts?.awaitAsr) {
        await asrTask;
      }
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    });

    const AudioCtx =
      (globalThis as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext ??
      (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) {
      stream.getTracks().forEach((t) => t.stop());
      throw new Error('WebAudio AudioContext is unavailable');
    }

    let ctx: AudioContext | null = null;
    try {
      ctx = new AudioCtx();
      if (ctx.state === 'suspended') {
        await ctx.resume().catch(() => {});
      }

      const source = ctx.createMediaStreamSource(stream);
      const muteGain = ctx.createGain();
      muteGain.gain.value = 0;
      muteGain.connect(ctx.destination);

      let worklet: AudioWorkletNode | null = null;
      let fallbackProcessor: ScriptProcessorNode | null = null;

      try {
        if (!ctx.audioWorklet || typeof ctx.audioWorklet.addModule !== 'function') {
          throw new Error('AudioWorklet unavailable');
        }
        const blobUrl = createDuplexWorkletBlobUrl();
        try {
          await ctx.audioWorklet.addModule(blobUrl);
        } finally {
          setTimeout(() => {
            try {
              URL.revokeObjectURL(blobUrl);
            } catch {
              // ignore
            }
          }, 1000);
        }

        const sab = this.ringBuffer.getSharedArrayBuffer();
        worklet = new AudioWorkletNode(ctx, DUPLEX_WORKLET_NAME, {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          channelCount: 1,
          outputChannelCount: [1],
          processorOptions: sab ? { sab } : undefined,
        });

        worklet.port.onmessage = (ev: MessageEvent<{ type?: string; pcm?: Float32Array }>) => {
          if (ev.data?.type === 'pcm' && ev.data.pcm instanceof Float32Array) {
            this.ingestFrame16k(ev.data.pcm, !sab);
          }
        };

        source.connect(worklet);
        worklet.connect(muteGain);
      } catch {
        // Fallback to ScriptProcessorNode if AudioWorklet blob is blocked or unsupported
        const processor = ctx.createScriptProcessor(2048, 1, 1);
        const resampler = new StreamingLinearResampler(DUPLEX_SAMPLE_RATE);
        processor.onaudioprocess = (e: AudioProcessingEvent) => {
          const input = e.inputBuffer.getChannelData(0);
          const resampled = resampler.resample(input, ctx!.sampleRate);
          if (resampled.length > 0) {
            this.ingestFrame16k(resampled, true);
          }
        };
        source.connect(processor);
        processor.connect(muteGain);
        fallbackProcessor = processor;
      }

      this.micStream = stream;
      this.micCtx = ctx;
      this.micSource = source;
      this.micMuteGain = muteGain;
      this.workletNode = worklet;
      this.fallbackProcessor = fallbackProcessor;
      this.ambientFloorDb = -52;
      this.lastNeuralSpeechAtMs = -10_000;
      this.micActive = true;
      this.running = true;
      this.emitState();
    } catch (err) {
      stream.getTracks().forEach((t) => {
        try {
          t.stop();
        } catch {
          // ignore
        }
      });
      if (ctx) {
        await ctx.close().catch(() => {});
      }
      throw err;
    }
  }

  /**
   * Stops active microphone capture and AudioWorklet processing cleanly.
   */
  async stop(): Promise<void> {
    if (this.workletNode) {
      try {
        this.workletNode.port.postMessage({ type: 'stop' });
        this.workletNode.port.onmessage = null;
        this.workletNode.disconnect();
      } catch {
        // ignore
      }
      this.workletNode = null;
    }

    if (this.fallbackProcessor) {
      try {
        this.fallbackProcessor.onaudioprocess = null;
        this.fallbackProcessor.disconnect();
      } catch {
        // ignore
      }
      this.fallbackProcessor = null;
    }

    if (this.micMuteGain) {
      try {
        this.micMuteGain.disconnect();
      } catch {
        // ignore
      }
      this.micMuteGain = null;
    }

    if (this.micSource) {
      try {
        this.micSource.disconnect();
      } catch {
        // ignore
      }
      this.micSource = null;
    }

    if (this.micStream) {
      for (const track of this.micStream.getTracks()) {
        try {
          track.stop();
        } catch {
          // ignore
        }
      }
      this.micStream = null;
    }

    if (this.micCtx) {
      await this.micCtx.close().catch(() => {});
      this.micCtx = null;
    }

    this.micActive = false;
    this.running = false;
    this.emitState();
  }

  /**
   * Feeds deterministic 16 kHz PCM into the acoustic pipeline for headless Chromium
   * / automated Vitest verification (identical VAD, ducking, pause probe, and 8s ring
   * window code paths as live mic).
   */
  feedSimulatedPcm16k(
    pcm16k: Float32Array,
    opts?: {
      transcriptHint?: string;
      isFinalHint?: boolean;
      frameSamples?: number;
    },
  ): void {
    this.running = true;
    if (pcm16k.length === 0) return;

    const frameSize = Math.max(80, opts?.frameSamples ?? DEFAULT_SIMULATED_FRAME_SAMPLES);
    for (let offset = 0; offset < pcm16k.length; offset += frameSize) {
      const end = Math.min(pcm16k.length, offset + frameSize);
      const slice = pcm16k.subarray(offset, end);

      if (opts?.transcriptHint && offset === 0) {
        if (opts.isFinalHint) {
          this.committedTranscript = opts.transcriptHint.trim();
          this.draftTranscript = '';
        } else {
          this.draftTranscript = opts.transcriptHint.trim();
        }
      }

      this.ingestFrame16k(slice, true);

      if (opts?.transcriptHint && end >= pcm16k.length) {
        this.emitTranscript(Boolean(opts.isFinalHint), opts.isFinalHint);
      }
    }
  }

  /**
   * Returns an exact `128,000`-sample (8.0s @ 16 kHz) end-aligned left-zero-padded window.
   */
  getRollingWindow16k(out?: Float32Array): Float32Array {
    return this.ringBuffer.readEndAlignedWindow(out);
  }

  getSharedArrayBuffer(): SharedArrayBuffer | null {
    return this.ringBuffer.getSharedArrayBuffer();
  }

  getAudioTimeMs(): number {
    return (this.sampleClockSamples / DUPLEX_SAMPLE_RATE) * 1000;
  }

  getDuckingState(): DuplexDuckingSnapshot {
    return {
      active: this.lastDuckingActive,
      gain: this.lastDuckingGain,
      playbackRms: this.lastPlaybackRms,
      playbackDb: this.lastPlaybackDb,
      effectiveThresholdDb: this.lastEffectiveThresholdDb,
      lastMicDb: this.lastMicDb,
    };
  }

  getState(): DuplexEarState {
    const audioTimeMs = this.getAudioTimeMs();
    const silenceMs = this.inSpeech ? Math.max(0, audioTimeMs - this.lastVoiceActiveMs) : 0;
    return {
      running: this.running,
      micActive: this.micActive,
      asrReady: Boolean(this.recognizer?.isReady),
      sharedRingActive: this.ringBuffer.shared,
      inSpeech: this.inSpeech,
      vadState: this.vadState,
      audioTimeMs,
      speechDurationMs: this.inSpeech ? this.speechAccumulatedMs : 0,
      silenceMs,
      stableText: this.committedTranscript,
      tailText: this.draftTranscript,
      ducking: this.getDuckingState(),
    };
  }

  /**
   * Called by Turn Manager / Studio once a turn is committed so lingering pause probes
   * do not re-trigger for the already-submitted utterance.
   */
  markTurnCommitted(clearTranscript = true): void {
    const committedText = this.getFullTranscript().trim();
    if (clearTranscript && committedText) {
      this.lastCommittedUtteranceText = committedText;
      this.lastCommittedAtMs = this.getAudioTimeMs();
    }
    this.inSpeech = false;
    this.speechAccumulatedMs = 0;
    this.microPauseFired = false;
    this.turnProbeCount = 0;
    this.vadState = 0;
    this.recognizerVadState = 0;
    this.hasUncommittedAsrText = false;
    this.lastRecognizedSegment = '';
    if (clearTranscript) {
      this.committedTranscript = '';
      this.draftTranscript = '';
      try {
        this.recognizer?.reset();
      } catch {
        // ignore
      }
    }
    this.emitState();
  }

  resetUtterance(): void {
    this.markTurnCommitted(true);
  }

  clearAudioBuffer(): void {
    this.ringBuffer.clear();
    this.resetUtterance();
  }

  async dispose(): Promise<void> {
    await this.stop();
    if (this.recognizer) {
      try {
        this.recognizer.destroy();
      } catch {
        // ignore
      }
      this.recognizer = null;
    }
    this.asrInitPromise = null;
  }

  private ingestFrame16k(chunk: Float32Array, writeToRing: boolean): void {
    if (chunk.length === 0) return;

    const frameMs = (chunk.length / DUPLEX_SAMPLE_RATE) * 1000;
    const prevTimeMs = this.getAudioTimeMs();
    this.sampleClockSamples += chunk.length;
    const audioTimeMs = this.getAudioTimeMs();

    const rawProviderSpeaking = this.isAssistantSpeakingProvider?.() ?? false;
    const rawSpeakingNow = rawProviderSpeaking || this.manualAssistantSpeaking;

    if (this.wasAssistantSpeaking && !rawSpeakingNow) {
      this.ttsCooldownUntilMs = prevTimeMs + this.ttsCooldownMs;
    }
    if (!this.wasAssistantSpeaking && rawSpeakingNow) {
      this.bargeInEmittedThisPlayback = false;
      this.consecutiveDoubleTalkMs = 0;
    }
    this.wasAssistantSpeaking = rawSpeakingNow;

    const assistantSpeaking = rawSpeakingNow || audioTimeMs <= this.ttsCooldownUntilMs;
    const providerPlaybackRms = this.playbackRmsProvider?.() ?? 0;
    const playbackRms = assistantSpeaking
      ? Math.max(providerPlaybackRms, this.manualPlaybackRms)
      : 0;
    const playbackDb = rmsToDb(playbackRms);

    const rawRms = computeChunkRms(chunk);
    const rawDb = rmsToDb(rawRms);

    // Echo-aware double-talk threshold adapts to current playback speaker energy
    // instead of gating out real soft user speech with a static -22 dBFS cutoff.
    const expectedResidualEchoDb = playbackRms > 1e-5 ? playbackDb - this.aecSuppressionDb : -55;
    const effectiveThresholdDb = assistantSpeaking
      ? Math.max(this.speechThresholdDb, expectedResidualEchoDb + this.doubleTalkMarginDb)
      : this.speechThresholdDb;

    const duckingActive = assistantSpeaking;
    const duckingGain = duckingActive ? ECHO_DUCKING_GAIN : 1.0;

    this.lastMicDb = rawDb;
    this.lastPlaybackRms = playbackRms;
    this.lastPlaybackDb = playbackDb;
    this.lastEffectiveThresholdDb = effectiveThresholdDb;
    this.lastDuckingActive = duckingActive;
    this.lastDuckingGain = duckingGain;

    let frameForProcessing: Float32Array;
    if (duckingActive) {
      frameForProcessing = new Float32Array(chunk.length);
      for (let i = 0; i < chunk.length; i++) {
        frameForProcessing[i] = chunk[i]! * duckingGain;
      }
    } else {
      frameForProcessing = chunk;
    }

    if (writeToRing) {
      this.ringBuffer.write(frameForProcessing);
    }

    if (this.recognizer?.isReady) {
      try {
        const copy = new Float32Array(frameForProcessing);
        this.recognizer.feed(copy, DUPLEX_SAMPLE_RATE, false);
      } catch {
        // ignore transient worker reset error
      }
    }

    let voiceDetected = rawDb >= effectiveThresholdDb;
    if (this.micActive) {
      if (!assistantSpeaking && (!this.recognizer?.isReady || this.recognizerVadState === 0) && rawDb < -26) {
        const alpha = rawDb < this.ambientFloorDb ? 0.18 : 0.025;
        this.ambientFloorDb = Math.max(
          -58,
          Math.min(-28, this.ambientFloorDb + alpha * (rawDb - this.ambientFloorDb)),
        );
      }
      const liveThresholdDb = assistantSpeaking
        ? Math.max(effectiveThresholdDb, this.ambientFloorDb + 9)
        : Math.max(this.speechThresholdDb, this.ambientFloorDb + 7);
      const withinOnsetGrace =
        !this.inSpeech ||
        this.speechAccumulatedMs < 260 ||
        audioTimeMs - this.lastNeuralSpeechAtMs <= 260;
      voiceDetected =
        !assistantSpeaking && this.recognizer?.isReady
          ? (this.recognizerVadState === 1 && rawDb >= this.ambientFloorDb + 3) ||
            (withinOnsetGrace && rawDb >= liveThresholdDb)
          : rawDb >= liveThresholdDb;
    }

    this.onRms?.({
      rms: rawRms,
      rmsDb: rawDb,
      duckedRms: rawRms * duckingGain,
      effectiveThresholdDb,
      duckingActive,
      duckingGain,
      assistantSpeaking,
      vadState: this.vadState,
      audioTimeMs,
    });

    if (assistantSpeaking) {
      if (voiceDetected) {
        this.consecutiveDoubleTalkMs += frameMs;
        if (!this.bargeInEmittedThisPlayback && this.consecutiveDoubleTalkMs >= this.bargeInMinMs) {
          this.bargeInEmittedThisPlayback = true;
          this.onBargeInCandidate?.({
            audioTimeMs,
            rmsDb: rawDb,
            effectiveThresholdDb,
            playbackRms,
            playbackDb,
            duckingGain,
            partialText: this.getFullTranscript(),
          });
        }
      } else {
        this.consecutiveDoubleTalkMs = 0;
      }
    } else {
      this.consecutiveDoubleTalkMs = 0;
    }

    // Continuous turn / pause tracking
    if (voiceDetected) {
      if (!this.inSpeech) {
        this.inSpeech = true;
        this.speechAccumulatedMs = frameMs;
        this.microPauseFired = false;
        this.turnProbeCount = 0;
      } else {
        this.speechAccumulatedMs += frameMs;
      }
      this.lastVoiceActiveMs = audioTimeMs;
      this.vadState = 1;
      return;
    }

    if (!this.inSpeech) {
      this.vadState = 0;
      return;
    }

    const silenceMs = Math.max(0, audioTimeMs - this.lastVoiceActiveMs);
    this.vadState = 2;

    if (this.speechAccumulatedMs < this.minUtteranceSpeechMs) {
      return;
    }

    if (!this.microPauseFired && silenceMs >= this.microPauseMs) {
      this.microPauseFired = true;
      const probe = this.buildPauseProbe(0, silenceMs, audioTimeMs, assistantSpeaking, rawDb);
      this.onMicroPauseProbe?.(probe);
    }

    const readyToProbe =
      !this.micActive ||
      !this.recognizer?.isReady ||
      this.getFullTranscript().trim().length > 0 ||
      silenceMs >= 1100;

    if (readyToProbe && silenceMs >= this.turnProbeMs && this.turnProbeCount < this.maxTurnProbesPerUtterance) {
      const canEmitFirst = this.turnProbeCount === 0;
      const canRepeat = audioTimeMs - this.lastTurnProbeMs >= this.turnProbeRepeatMs;
      if (canEmitFirst || canRepeat) {
        const probeIndex = this.turnProbeCount;
        this.turnProbeCount += 1;
        this.lastTurnProbeMs = audioTimeMs;
        const probe = this.buildPauseProbe(probeIndex, silenceMs, audioTimeMs, assistantSpeaking, rawDb);
        this.onTurnProbe?.(probe);
      }
    }

    if (
      this.micActive &&
      this.recognizer?.isReady &&
      !this.hasUncommittedAsrText &&
      !this.getFullTranscript().trim() &&
      silenceMs >= 1800
    ) {
      this.inSpeech = false;
      this.speechAccumulatedMs = 0;
      this.microPauseFired = false;
      this.turnProbeCount = 0;
      this.vadState = 0;
    }
  }

  private buildPauseProbe(
    probeIndex: number,
    pauseMs: number,
    audioTimeMs: number,
    assistantSpeaking: boolean,
    rmsDb: number,
  ): DuplexPauseProbeEvent {
    return {
      probeIndex,
      pauseMs: Math.round(pauseMs),
      speechDurationMs: Math.round(this.speechAccumulatedMs),
      audioTimeMs: Math.round(audioTimeMs),
      stableText: this.committedTranscript,
      tailText: this.draftTranscript,
      fullText: this.getFullTranscript(),
      rmsDb,
      assistantSpeaking,
      pcm16k: this.ringBuffer.readEndAlignedWindow(),
    };
  }

  private getFullTranscript(): string {
    return this.joinTranscripts(this.committedTranscript, this.draftTranscript);
  }

  private joinTranscripts(a: string, b: string): string {
    const left = a.trim();
    const right = b.trim();
    if (!left) return right;
    if (!right) return left;
    const needsSpace = /[A-Za-z0-9]$/.test(left) && /^[A-Za-z0-9]/.test(right);
    return needsSpace ? `${left} ${right}` : `${left}${right}`;
  }

  private emitTranscript(isFinal: boolean, isRefined?: boolean): void {
    this.onTranscript?.({
      stableText: this.committedTranscript,
      tailText: this.draftTranscript,
      fullText: this.getFullTranscript(),
      isFinal,
      isRefined,
      vadState: this.vadState,
      audioTimeMs: this.getAudioTimeMs(),
    });
  }

  private emitState(): void {
    this.onStateChange?.(this.getState());
  }
}
