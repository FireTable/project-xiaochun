/**
 * liveSpeechPlayer.ts — Single-stream sample-accurate 24 kHz WebAudio speech player.
 *
 * Schedules TTS audio clauses back-to-back onto one continuous AudioContext clock
 * (`nextStartTime`) with zero inter-clause clicks or gaps. Tracks `{ seq, clauseText,
 * startSample, endSample }` for every queued clause so barge-in yields:
 * - Instant `45 ms` cosine gain ramp-down + source cancellation (`abortAndFade`)
 * - Exact sample-accurate heard transcript (`getHeardTranscript()`)
 * - Real-time mouth envelope RMS & chunk/clock telemetry (`onPcmChunk`, `onClockTick`,
 *   `onClauseStart`, `onDrain`) for 3D lip-sync and EMAGE streaming.
 */

import type { LiveEmotionTag } from '../tts/types';

export const LIVE_SPEECH_SAMPLE_RATE = 24_000;
export const DEFAULT_FADE_OUT_MS = 45;
export const DEFAULT_PCM_SLICE_SAMPLES = 960; // 40 ms @ 24 kHz

export interface AudioParamLike {
  value: number;
  setValueAtTime?(value: number, startTime: number): void;
  linearRampToValueAtTime?(value: number, endTime: number): void;
  setValueCurveAtTime?(values: Float32Array | number[], startTime: number, duration: number): void;
  cancelScheduledValues?(cancelTime: number): void;
}

export interface GainNodeLike {
  readonly gain: AudioParamLike;
  connect(destination: unknown): void;
  disconnect(): void;
}

export interface AudioBufferLike {
  readonly length: number;
  readonly sampleRate: number;
  getChannelData(channel: number): Float32Array;
}

export interface AudioBufferSourceNodeLike {
  buffer: AudioBufferLike | null;
  onended: (() => void) | null;
  connect(destination: unknown): void;
  disconnect(): void;
  start(when?: number, offset?: number, duration?: number): void;
  stop(when?: number): void;
}

export interface AudioContextLike {
  readonly currentTime: number;
  readonly sampleRate: number;
  readonly state?: string;
  readonly destination: unknown;
  resume?(): Promise<void>;
  close?(): Promise<void>;
  createGain(): GainNodeLike;
  createBuffer(numberOfChannels: number, length: number, sampleRate: number): AudioBufferLike;
  createBufferSource(): AudioBufferSourceNodeLike;
}

export interface QueuedClause {
  seq: number;
  clauseText: string;
  startSample: number;
  endSample: number;
  startTimeSec: number;
  endTimeSec: number;
  emotion?: LiveEmotionTag;
}

export interface EnqueueClauseInput {
  seq: number;
  text: string;
  pcm24k: Float32Array;
  emotion?: LiveEmotionTag;
}

export interface SpeechPcmChunkEvent {
  seq: number;
  chunk: Float32Array;
  sampleRate: 24000;
  startSample: number;
  startTimeSec: number;
  isFirstOfClause: boolean;
  isLastOfClause: boolean;
  emotion?: LiveEmotionTag;
}

export interface SpeechClockTickEvent {
  currentTimeSec: number;
  sessionStartTimeSec: number;
  sessionOffsetSec: number;
  sampleOffset: number;
  rms: number;
  activeSeq: number | null;
  activeEmotion: LiveEmotionTag | null;
  heardText: string;
}

export interface SpeechClauseStartEvent {
  seq: number;
  clauseText: string;
  startSample: number;
  endSample: number;
  startTimeSec: number;
  durationSec: number;
  emotion?: LiveEmotionTag;
}

export interface SpeechDrainEvent {
  heardText: string;
  totalSamples: number;
  durationSec: number;
}

export interface SpeechAbortResult {
  heardText: string;
  sampleOffset: number;
  fadeMs: number;
}

export interface LiveSpeechPlayerState {
  isPlaying: boolean;
  aborted: boolean;
  queuedCount: number;
  sessionStartTimeSec: number | null;
  sampleOffset: number;
  rms: number;
  activeSeq: number | null;
}

export interface LiveSpeechPlayerOptions {
  /** Inject custom or mocked AudioContext (helpful in tests or shared master mixer). */
  audioContext?: AudioContextLike;
  /** External deterministic clock (seconds), overrides AudioContext time when headless or injected. */
  clock?: () => number;
  /** Run purely via clock + PCM buffers without creating a WebAudio AudioContext. */
  headless?: boolean;
  /** Scheduling safety lookahead in seconds for first clause when using native AudioContext (default 0.015). */
  scheduleLookaheadSec?: number;
  /** Slice size for `onPcmChunk` telemetry in 24 kHz samples (default 960 = 40 ms). */
  pcmSliceSamples?: number;
  /** Run automatic RAF / 16ms tick loop during playback (default true unless disabled). */
  autoTick?: boolean;
  onPcmChunk?: (event: SpeechPcmChunkEvent) => void;
  onClockTick?: (event: SpeechClockTickEvent) => void;
  onClauseStart?: (event: SpeechClauseStartEvent) => void;
  onDrain?: (event: SpeechDrainEvent) => void;
  onAbort?: (result: SpeechAbortResult) => void;
}

interface InternalClause extends QueuedClause {
  pcm24k: Float32Array;
  source: AudioBufferSourceNodeLike | null;
  startedEmitted: boolean;
}

function buildCosineFadeCurve(startGain: number, steps = 32): Float32Array {
  const curve = new Float32Array(steps);
  const denom = Math.max(1, steps - 1);
  for (let i = 0; i < steps; i++) {
    const phase = (Math.PI * i) / denom;
    curve[i] = startGain * 0.5 * (1 + Math.cos(phase));
  }
  curve[steps - 1] = 0;
  return curve;
}

function computeRmsWindow(pcm: Float32Array, centerSample: number, windowSamples = 600): number {
  if (pcm.length === 0) return 0;
  const half = Math.floor(windowSamples / 2);
  const start = Math.max(0, centerSample - half);
  const end = Math.min(pcm.length, Math.max(start + 1, centerSample + half));
  let sumSq = 0;
  for (let i = start; i < end; i++) {
    const v = pcm[i] ?? 0;
    sumSq += v * v;
  }
  return Math.sqrt(sumSq / Math.max(1, end - start));
}

function sliceClauseProportional(clause: Pick<QueuedClause, 'clauseText' | 'startSample' | 'endSample'>, sampleOffset: number): string {
  if (sampleOffset <= clause.startSample) return '';
  if (sampleOffset >= clause.endSample) return clause.clauseText;
  const totalSamples = Math.max(1, clause.endSample - clause.startSample);
  const ratio = Math.min(1, Math.max(0, (sampleOffset - clause.startSample) / totalSamples));
  const chars = Array.from(clause.clauseText);
  if (chars.length === 0) return '';
  const count = Math.min(chars.length, Math.floor(chars.length * ratio + 1e-6));
  return chars.slice(0, count).join('');
}

export class LiveSpeechPlayer {
  static readonly SAMPLE_RATE = LIVE_SPEECH_SAMPLE_RATE;

  private ctx: AudioContextLike | null;
  private readonly ownsCtx: boolean;
  private readonly headless: boolean;
  private readonly clockFn: (() => number) | null;
  private readonly scheduleLookaheadSec: number;
  private readonly pcmSliceSamples: number;
  private readonly autoTick: boolean;

  private masterGain: GainNodeLike | null = null;
  private sessionGain: GainNodeLike | null = null;

  private onPcmChunk?: (event: SpeechPcmChunkEvent) => void;
  private onClockTick?: (event: SpeechClockTickEvent) => void;
  private onClauseStart?: (event: SpeechClauseStartEvent) => void;
  private onDrain?: (event: SpeechDrainEvent) => void;
  private onAbort?: (result: SpeechAbortResult) => void;

  private clauses: InternalClause[] = [];
  private snapshotClauses: QueuedClause[] = [];
  private sessionStartTimeSec: number | null = null;
  private nextStartTimeSec = 0;
  private lastPcmEndSample = 0;
  private playing = false;
  private ticking = false;
  private aborted = false;
  private frozenSampleOffset: number | null = null;
  private lastHeardTranscript = '';

  private rafId: number | null = null;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private lastObservedCtxTimeSec = 0;
  private lastObservedPerfMs: number | null = null;
  private cleanupTimers = new Set<ReturnType<typeof setTimeout>>();

  constructor(options: LiveSpeechPlayerOptions = {}) {
    this.clockFn = options.clock ?? null;
    this.headless = options.headless ?? (this.clockFn !== null && !options.audioContext);
    this.onPcmChunk = options.onPcmChunk;
    this.onClockTick = options.onClockTick;
    this.onClauseStart = options.onClauseStart;
    this.onDrain = options.onDrain;
    this.onAbort = options.onAbort;
    this.pcmSliceSamples = Math.max(120, options.pcmSliceSamples ?? DEFAULT_PCM_SLICE_SAMPLES);
    this.autoTick = options.autoTick ?? true;

    if (options.audioContext) {
      this.ctx = options.audioContext;
      this.ownsCtx = false;
      this.scheduleLookaheadSec = options.scheduleLookaheadSec ?? 0;
    } else if (this.headless) {
      this.ctx = null;
      this.ownsCtx = false;
      this.scheduleLookaheadSec = options.scheduleLookaheadSec ?? 0;
    } else {
      const Ctx = (globalThis as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
        ?? (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (Ctx) {
        this.ctx = new Ctx({ sampleRate: LIVE_SPEECH_SAMPLE_RATE }) as unknown as AudioContextLike;
        this.ownsCtx = true;
        this.scheduleLookaheadSec = options.scheduleLookaheadSec ?? 0.015;
      } else {
        this.ctx = null;
        this.ownsCtx = false;
        this.scheduleLookaheadSec = options.scheduleLookaheadSec ?? 0;
      }
    }

    if (this.ctx) {
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = 1;
      this.masterGain.connect(this.ctx.destination);
    }
  }

  getCurrentTimeSec(): number {
    if (this.clockFn) return this.clockFn();
    if (this.ctx) {
      const ctxTime = this.ctx.currentTime;
      if (!this.playing) {
        this.lastObservedCtxTimeSec = ctxTime;
        this.lastObservedPerfMs = null;
        return ctxTime;
      }
      if (this.ctx.state && this.ctx.state !== 'running') {
        const nowPerfMs = performance.now();
        if (this.lastObservedPerfMs !== null && ctxTime <= this.lastObservedCtxTimeSec + 1e-6) {
          return ctxTime + Math.max(0, (nowPerfMs - this.lastObservedPerfMs) / 1000);
        }
        this.lastObservedCtxTimeSec = ctxTime;
        this.lastObservedPerfMs = nowPerfMs;
        return ctxTime;
      }
      this.lastObservedCtxTimeSec = ctxTime;
      this.lastObservedPerfMs = performance.now();
      return ctxTime;
    }
    return performance.now() / 1000;
  }

  async ensureRunning(): Promise<void> {
    if (this.ctx?.state === 'suspended' && typeof this.ctx.resume === 'function') {
      await this.ctx.resume().catch(() => {});
    }
  }

  setCallbacks(callbacks: {
    onPcmChunk?: (event: SpeechPcmChunkEvent) => void;
    onClockTick?: (event: SpeechClockTickEvent) => void;
    onClauseStart?: (event: SpeechClauseStartEvent) => void;
    onDrain?: (event: SpeechDrainEvent) => void;
    onAbort?: (result: SpeechAbortResult) => void;
  }): void {
    if ('onPcmChunk' in callbacks) this.onPcmChunk = callbacks.onPcmChunk;
    if ('onClockTick' in callbacks) this.onClockTick = callbacks.onClockTick;
    if ('onClauseStart' in callbacks) this.onClauseStart = callbacks.onClauseStart;
    if ('onDrain' in callbacks) this.onDrain = callbacks.onDrain;
    if ('onAbort' in callbacks) this.onAbort = callbacks.onAbort;
  }

  enqueueClause(input: EnqueueClauseInput): QueuedClause {
    const now = this.getCurrentTimeSec();
    const pcm24k = input.pcm24k;

    if (this.ctx?.state === 'suspended' && typeof this.ctx.resume === 'function') {
      void this.ctx.resume().catch(() => {});
    }

    // Start a fresh speech turn if idle / previously drained / previously aborted.
    if (!this.playing && (this.clauses.length === 0 || now >= this.nextStartTimeSec - 0.001)) {
      this.clauses = [];
      this.snapshotClauses = [];
      this.sessionStartTimeSec = null;
      this.nextStartTimeSec = 0;
      this.lastPcmEndSample = 0;
      this.aborted = false;
      this.frozenSampleOffset = null;
      this.lastHeardTranscript = '';
    }

    if (this.sessionStartTimeSec === null) {
      this.sessionStartTimeSec = now + this.scheduleLookaheadSec;
      this.nextStartTimeSec = this.sessionStartTimeSec;
    }

    const startTimeSec = Math.max(now, this.nextStartTimeSec);
    const alignedSampleStart = Math.max(
      this.lastPcmEndSample,
      Math.round((startTimeSec - this.sessionStartTimeSec) * LIVE_SPEECH_SAMPLE_RATE),
    );
    const startSample = alignedSampleStart;
    const endSample = startSample + pcm24k.length;
    const durationSec = pcm24k.length / LIVE_SPEECH_SAMPLE_RATE;
    const endTimeSec = startTimeSec + durationSec;

    let source: AudioBufferSourceNodeLike | null = null;
    if (this.ctx && pcm24k.length > 0) {
      const sessionGain = this.ensureSessionGain();
      const buffer = this.ctx.createBuffer(1, pcm24k.length, LIVE_SPEECH_SAMPLE_RATE);
      buffer.getChannelData(0).set(pcm24k);
      source = this.ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(sessionGain);
      source.start(startTimeSec);
    }

    const internal: InternalClause = {
      seq: input.seq,
      clauseText: input.text,
      startSample,
      endSample,
      startTimeSec,
      endTimeSec,
      emotion: input.emotion,
      pcm24k,
      source,
      startedEmitted: false,
    };

    this.clauses.push(internal);
    this.snapshotClauses.push(this.toPublicClause(internal));
    this.nextStartTimeSec = endTimeSec;
    this.lastPcmEndSample = endSample;

    if (pcm24k.length > 0) {
      this.playing = true;
      this.emitPcmChunks(internal);
      this.maybeEmitClauseStarts(now);
      if (this.autoTick) {
        this.startTickLoop();
      }
    }

    return this.toPublicClause(internal);
  }

  /**
   * Smoothly fades out live audio with a `fadeMs` (default 45 ms) cosine gain ramp,
   * cancels queued WebAudio sources without clicks, freezes `getHeardTranscript()`
   * at the exact abort sample offset, and resets active playback state.
   */
  abortAndFade(fadeMs = DEFAULT_FADE_OUT_MS): SpeechAbortResult {
    const now = this.getCurrentTimeSec();
    const safeFadeMs = Math.max(0, fadeMs);
    const fadeSec = safeFadeMs / 1000;

    const sampleOffset = this.computeCurrentSampleOffset(now);
    const heardText = this.computeHeardTranscript(sampleOffset);

    if (this.ctx && this.sessionGain) {
      const dyingGain = this.sessionGain;
      this.sessionGain = null;

      const currentVal = typeof dyingGain.gain.value === 'number' ? dyingGain.gain.value : 1;
      dyingGain.gain.cancelScheduledValues?.(now);
      dyingGain.gain.setValueAtTime?.(currentVal, now);

      if (fadeSec > 0) {
        const curve = buildCosineFadeCurve(currentVal, 32);
        if (typeof dyingGain.gain.setValueCurveAtTime === 'function') {
          dyingGain.gain.setValueCurveAtTime(curve, now, fadeSec);
        } else {
          dyingGain.gain.linearRampToValueAtTime?.(0, now + fadeSec);
        }
      } else {
        dyingGain.gain.setValueAtTime?.(0, now);
      }

      const dyingSources: AudioBufferSourceNodeLike[] = [];
      for (const clause of this.clauses) {
        const src = clause.source;
        if (!src) continue;
        clause.source = null;
        if (clause.startTimeSec > now + 0.001) {
          try {
            src.stop(now);
            src.disconnect();
          } catch {
            // already stopped
          }
        } else {
          try {
            src.stop(fadeSec > 0 ? now + fadeSec : now);
          } catch {
            // already stopped
          }
          dyingSources.push(src);
        }
      }

      const cleanupDelay = Math.ceil(safeFadeMs) + 25;
      const timer = setTimeout(() => {
        this.cleanupTimers.delete(timer);
        for (const src of dyingSources) {
          try {
            src.disconnect();
          } catch {
            // ignore
          }
        }
        try {
          dyingGain.disconnect();
        } catch {
          // ignore
        }
      }, cleanupDelay);
      if (typeof (timer as { unref?: () => void }).unref === 'function') {
        (timer as { unref: () => void }).unref();
      }
      this.cleanupTimers.add(timer);
    } else {
      for (const clause of this.clauses) {
        clause.source = null;
      }
    }

    this.stopTickLoop();
    this.playing = false;
    this.aborted = true;
    this.frozenSampleOffset = sampleOffset;
    this.lastHeardTranscript = heardText;
    this.clauses = [];
    this.sessionStartTimeSec = null;
    this.nextStartTimeSec = 0;
    this.lastPcmEndSample = 0;
    this.lastObservedPerfMs = null;

    const result: SpeechAbortResult = {
      heardText,
      sampleOffset,
      fadeMs: safeFadeMs,
    };
    this.onAbort?.(result);
    return result;
  }

  /**
   * Computes exact sample offset `(currentTime - sessionStartTime) * 24000`
   * across queued/played clauses and returns the exact heard substring.
   */
  getHeardTranscript(): string {
    if (this.aborted || (!this.playing && this.frozenSampleOffset !== null)) {
      return this.lastHeardTranscript;
    }
    const sampleOffset = this.computeCurrentSampleOffset(this.getCurrentTimeSec());
    return this.computeHeardTranscript(sampleOffset);
  }

  getQueuedClauses(): QueuedClause[] {
    return this.clauses.map((c) => this.toPublicClause(c));
  }

  getAllSessionClauses(): QueuedClause[] {
    return this.snapshotClauses.map((c) => ({ ...c }));
  }

  getSampleOffset(): number {
    if (this.frozenSampleOffset !== null) return this.frozenSampleOffset;
    return this.computeCurrentSampleOffset(this.getCurrentTimeSec());
  }

  getSessionTimeSec(): number {
    if (this.sessionStartTimeSec === null) return 0;
    return Math.max(0, this.getCurrentTimeSec() - this.sessionStartTimeSec);
  }

  isPlaying(): boolean {
    if (this.playing && !this.ticking && this.clauses.length > 0) {
      const lastClause = this.clauses[this.clauses.length - 1]!;
      const nowSec = this.getCurrentTimeSec();
      if (nowSec >= lastClause.endTimeSec) {
        this.tick(nowSec);
      }
    }
    return this.playing;
  }

  getCurrentPlaybackRms(): number {
    if (!this.playing || this.clauses.length === 0) return 0;
    const now = this.getCurrentTimeSec();
    const active = this.findClauseAtTime(now);
    if (!active) return 0;
    const localSample = Math.floor((now - active.startTimeSec) * LIVE_SPEECH_SAMPLE_RATE);
    return computeRmsWindow(active.pcm24k, localSample, 600);
  }

  getState(): LiveSpeechPlayerState {
    const now = this.getCurrentTimeSec();
    const active = this.playing ? this.findClauseAtTime(now) : null;
    return {
      isPlaying: this.playing,
      aborted: this.aborted,
      queuedCount: this.clauses.length,
      sessionStartTimeSec: this.sessionStartTimeSec,
      sampleOffset: this.getSampleOffset(),
      rms: this.getCurrentPlaybackRms(),
      activeSeq: active?.seq ?? null,
    };
  }

  /**
   * Advances playback telemetry explicitly to `nowSec` (optional; called automatically
   * by RAF/interval ticker when `autoTick` is enabled).
   */
  tick(nowSec = this.getCurrentTimeSec()): void {
    if (!this.playing || this.clauses.length === 0 || this.ticking) return;
    this.ticking = true;
    try {
      this.maybeEmitClauseStarts(nowSec);
      if (!this.playing || this.clauses.length === 0) return;

      const active = this.findClauseAtTime(nowSec);
      const sampleOffset = this.computeCurrentSampleOffset(nowSec);
      const rms = active
        ? computeRmsWindow(
            active.pcm24k,
            Math.floor((nowSec - active.startTimeSec) * LIVE_SPEECH_SAMPLE_RATE),
            600,
          )
        : 0;
      const heardText = this.computeHeardTranscript(sampleOffset);

      this.onClockTick?.({
        currentTimeSec: nowSec,
        sessionStartTimeSec: this.sessionStartTimeSec ?? nowSec,
        sessionOffsetSec:
          this.sessionStartTimeSec === null ? 0 : Math.max(0, nowSec - this.sessionStartTimeSec),
        sampleOffset,
        rms,
        activeSeq: active?.seq ?? null,
        activeEmotion: active?.emotion ?? null,
        heardText,
      });

      if (!this.playing || this.clauses.length === 0) return;
      const lastClause = this.clauses[this.clauses.length - 1]!;
      if (nowSec >= lastClause.endTimeSec) {
        const totalSamples = lastClause.endSample;
        const durationSec =
          this.sessionStartTimeSec === null
            ? 0
            : Math.max(0, lastClause.endTimeSec - this.sessionStartTimeSec);

        this.playing = false;
        this.frozenSampleOffset = sampleOffset;
        this.lastHeardTranscript = heardText;
        this.clauses = [];
        this.stopTickLoop();
        this.onDrain?.({
          heardText,
          totalSamples,
          durationSec,
        });
      }
    } finally {
      this.ticking = false;
    }
  }

  reset(): void {
    this.stopTickLoop();
    for (const clause of this.clauses) {
      if (clause.source) {
        try {
          clause.source.stop(this.getCurrentTimeSec());
          clause.source.disconnect();
        } catch {
          // ignore
        }
        clause.source = null;
      }
    }
    this.clauses = [];
    this.snapshotClauses = [];
    this.sessionStartTimeSec = null;
    this.nextStartTimeSec = 0;
    this.lastPcmEndSample = 0;
    this.lastObservedPerfMs = null;
    this.playing = false;
    this.ticking = false;
    this.aborted = false;
    this.frozenSampleOffset = null;
    this.lastHeardTranscript = '';
  }

  dispose(): void {
    this.reset();
    for (const timer of this.cleanupTimers) {
      clearTimeout(timer);
    }
    this.cleanupTimers.clear();
    try {
      this.sessionGain?.disconnect();
      this.masterGain?.disconnect();
    } catch {
      // ignore
    }
    this.sessionGain = null;
    this.masterGain = null;
    if (this.ownsCtx && typeof this.ctx?.close === 'function') {
      void this.ctx.close().catch(() => {});
    }
    this.ctx = null;
  }

  private ensureSessionGain(): GainNodeLike {
    if (!this.ctx || !this.masterGain) {
      throw new Error('LiveSpeechPlayer WebAudio context unavailable');
    }
    if (!this.sessionGain) {
      this.sessionGain = this.ctx.createGain();
      this.sessionGain.gain.value = 1;
      this.sessionGain.connect(this.masterGain);
    }
    return this.sessionGain;
  }

  private toPublicClause(clause: InternalClause): QueuedClause {
    return {
      seq: clause.seq,
      clauseText: clause.clauseText,
      startSample: clause.startSample,
      endSample: clause.endSample,
      startTimeSec: clause.startTimeSec,
      endTimeSec: clause.endTimeSec,
      emotion: clause.emotion,
    };
  }

  private computeCurrentSampleOffset(nowSec: number): number {
    if (this.sessionStartTimeSec === null) {
      return this.frozenSampleOffset ?? 0;
    }
    return Math.max(0, (nowSec - this.sessionStartTimeSec) * LIVE_SPEECH_SAMPLE_RATE);
  }

  private computeHeardTranscript(sampleOffset: number): string {
    const clauses = this.clauses.length > 0 ? this.clauses : this.snapshotClauses;
    if (clauses.length === 0) return '';
    let out = '';
    for (const clause of clauses) {
      if (sampleOffset <= clause.startSample) break;
      out += sliceClauseProportional(clause, sampleOffset);
    }
    return out;
  }

  private findClauseAtTime(nowSec: number): InternalClause | null {
    for (const clause of this.clauses) {
      if (nowSec >= clause.startTimeSec && nowSec < clause.endTimeSec) {
        return clause;
      }
    }
    return null;
  }

  private maybeEmitClauseStarts(nowSec: number): void {
    for (const clause of this.clauses) {
      if (!clause.startedEmitted && nowSec >= clause.startTimeSec - 0.002) {
        clause.startedEmitted = true;
        this.onClauseStart?.({
          seq: clause.seq,
          clauseText: clause.clauseText,
          startSample: clause.startSample,
          endSample: clause.endSample,
          startTimeSec: clause.startTimeSec,
          durationSec: clause.endTimeSec - clause.startTimeSec,
          emotion: clause.emotion,
        });
      }
    }
  }

  private emitPcmChunks(clause: InternalClause): void {
    if (!this.onPcmChunk) return;
    const pcm = clause.pcm24k;
    for (let offset = 0; offset < pcm.length; offset += this.pcmSliceSamples) {
      const end = Math.min(pcm.length, offset + this.pcmSliceSamples);
      const chunk = pcm.subarray(offset, end);
      this.onPcmChunk({
        seq: clause.seq,
        chunk,
        sampleRate: 24000,
        startSample: clause.startSample + offset,
        startTimeSec: clause.startTimeSec + offset / LIVE_SPEECH_SAMPLE_RATE,
        isFirstOfClause: offset === 0,
        isLastOfClause: end >= pcm.length,
        emotion: clause.emotion,
      });
    }
  }

  private startTickLoop(): void {
    if (this.rafId !== null || this.intervalId !== null) return;
    if (typeof requestAnimationFrame === 'function') {
      const step = () => {
        this.rafId = null;
        if (!this.playing) return;
        this.tick();
        if (this.playing && typeof requestAnimationFrame === 'function') {
          this.rafId = requestAnimationFrame(step);
        }
      };
      this.rafId = requestAnimationFrame(step);
    }

    const pollMs = typeof requestAnimationFrame === 'function' ? 100 : 16;
    this.intervalId = setInterval(() => {
      if (!this.playing) {
        this.stopTickLoop();
        return;
      }
      this.tick();
    }, pollMs);
    if (typeof (this.intervalId as { unref?: () => void }).unref === 'function') {
      (this.intervalId as { unref: () => void }).unref();
    }
  }

  private stopTickLoop(): void {
    if (this.rafId !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }
}
