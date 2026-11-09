/**
 * sttClient.ts — 100% on-device streaming speech recognition via @firetable/stream-asr.
 *
 * Capabilities:
 *  - 100% browser-native & offline WebAssembly SIMD runtime (zero cloud audio egress).
 *  - Mode 3: Continuous universal streaming with neural Silero VAD & auto-punctuation.
 *  - sub-50ms real-time interim drafts with atomic in-place caret/range replacement.
 *  - Acoustic bleed gating (TTS Self-Listening Guard) to prevent speaker audio loopback.
 *  - Full compatibility with ChatBar & Embed protocol.
 */
import {
  StreamRecognizer,
  type DownloadProgressEvent,
} from '@firetable/stream-asr';
import { APP_CONFIG } from '@/config';
import { formatDraftPunctuation, finalizePunctuation } from './punctuation';

export type SttUiState = 'idle' | 'loading' | 'listening' | 'recognizing' | 'error';

export type SttProgressPhase = 'download' | 'init' | 'ready';

export type SttClientEvent =
  | { type: 'state'; state: SttUiState }
  | {
      type: 'progress';
      phase: SttProgressPhase;
      percent: number;
      loaded?: number;
      total?: number;
    }
  | { type: 'partial_rms'; rms: number }
  | { type: 'speech_prob'; prob: number }
  | { type: 'speech_start' }
  | { type: 'text'; text: string; isFinal: boolean; rawText?: string }
  | {
      type: 'utterance_result';
      id: number;
      text: string;
      pcm: Float32Array;
      sampleRate: number;
      durationMs: number;
      inferenceMs: number;
      rms: number;
      isFinal?: boolean;
    }
  | { type: 'error'; message: string };

type Listener = (ev: SttClientEvent) => void;

export function resampleTo(targetRate: number, input: Float32Array, fromRate: number): Float32Array {
  if (fromRate === targetRate) return input;
  const ratio = fromRate / targetRate;
  const outLen = Math.max(1, Math.round(input.length / ratio));
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const src = i * ratio;
    const i0 = Math.floor(src);
    const i1 = Math.min(i0 + 1, input.length - 1);
    const t = src - i0;
    out[i] = input[i0]! * (1 - t) + input[i1]! * t;
  }
  return out;
}

export function meanRms(pcm: Float32Array): number {
  if (pcm.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < pcm.length; i++) {
    const v = pcm[i]!;
    sum += v * v;
  }
  return Math.sqrt(sum / pcm.length);
}

function classifyMediaError(e: unknown): string {
  if (typeof window !== 'undefined' && !window.isSecureContext) {
    return 'mic_insecure';
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    return 'mic_unsupported';
  }
  const name = e && typeof e === 'object' && 'name' in e ? String((e as { name: unknown }).name) : '';
  const msg = e instanceof Error ? e.message : String(e ?? '');
  if (
    name === 'NotAllowedError' ||
    name === 'PermissionDeniedError' ||
    /permission|Permissions policy|not allowed|denied/i.test(msg)
  ) {
    return 'mic_denied';
  }
  if (name === 'NotFoundError' || /Requested device not found/i.test(msg)) {
    return 'mic_not_found';
  }
  return msg || 'STT start failed';
}

export class SttClient {
  private recognizer: StreamRecognizer | null = null;
  private listeners = new Set<Listener>();
  private state: SttUiState = 'idle';
  private stream: MediaStream | null = null;
  private audioCtx: AudioContext | null = null;
  private processor: ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private analyser: AnalyserNode | null = null;
  private loadPromise: Promise<void> | null = null;
  private isModelReady = false;
  private lastProgressPercent = 0;
  private desiredActive = false;
  private startSessionId = 0;
  private isTtsSpeakingProvider: (() => boolean) | null = null;
  private lastTtsSpeakingTime = 0;
  private utteranceCounter = 0;
  private lastRms = 0;
  private speechPcmBuffer: Float32Array[] = [];
  private speechPcmSamples = 0;
  /** Cap buffered PCM (preroll while idle / per-utterance) to ~30s @16kHz to avoid unbounded growth. */
  private static readonly MAX_BUFFER_SAMPLES = 16000 * 30;
  /** While VAD reports silence before any speech in a turn, only keep ~0.5s of preroll. */
  private static readonly SILENCE_PREROLL_SAMPLES = 8000;
  private vadActive = false;
  private hasSpokenInTurn = false;
  /**
   * 1:1 FIFO sequence counters for StreamRecognizer's Worker messages:
   * Every feed()/finish() sends one FEED_AUDIO and yields one non-refined RESULT ('recognizing').
   * Setting ignoreResultsUntilCount = sentFeedCount discards all in-flight Worker results
   * produced before resetSession() / cancel / manual input deletion.
   */
  private sentFeedCount = 0;
  private receivedResultCount = 0;
  private ignoreResultsUntilCount = 0;
  private lastResultIgnored = false;
  private hasFedAudioInTurn = false;
  private lastEmittedRawText = '';

  constructor(options?: { isTtsSpeaking?: () => boolean }) {
    if (options?.isTtsSpeaking) {
      this.isTtsSpeakingProvider = options.isTtsSpeaking;
    }
  }

  setTtsSpeakingProvider(provider: (() => boolean) | null): void {
    this.isTtsSpeakingProvider = provider;
  }

  isAcousticGuardActive(): boolean {
    const now = performance.now();
    const isCurrentlySpeaking = this.isTtsSpeakingProvider ? this.isTtsSpeakingProvider() : false;
    const ttsCooldownMs = APP_CONFIG.stt.ttsCooldownMs ?? 250;
    return (
      isCurrentlySpeaking ||
      (this.lastTtsSpeakingTime > 0 && now - this.lastTtsSpeakingTime < ttsCooldownMs)
    );
  }

  on(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getState(): SttUiState {
    return this.state;
  }

  getProgressPercent(): number {
    return this.lastProgressPercent;
  }

  getAnalyser(): AnalyserNode | null {
    return this.analyser;
  }

  private emit(ev: SttClientEvent): void {
    for (const l of this.listeners) l(ev);
  }

  private setState(state: SttUiState): void {
    if (this.state === state) return;
    this.state = state;
    this.emit({ type: 'state', state });
  }

  private failSession(message: string): void {
    this.desiredActive = false;
    this.startSessionId++;
    this.vadActive = false;
    this.hasSpokenInTurn = false;
    this.hasFedAudioInTurn = false;
    this.lastEmittedRawText = '';
    this.speechPcmBuffer = [];
    this.speechPcmSamples = 0;
    this.teardownAudio();
    this.setState('error');
    this.emit({ type: 'error', message });
  }

  private initRecognizer(): Promise<void> {
    if (this.loadPromise) return this.loadPromise;

    const recognizer = new StreamRecognizer({
      modelUrl: APP_CONFIG.stt.modelUrl,
      wasmBaseUrl: APP_CONFIG.stt.wasmBaseUrl,
      modelVersion: APP_CONFIG.stt.modelVersion ?? '1.0.0',
      mode: 3,
      vadThreshold: APP_CONFIG.stt.vadThreshold ?? 0.5,
      sampleRate: APP_CONFIG.stt.sampleRate ?? 16000,
      numThreads: 'auto',
      debug: false,
    });

    this.recognizer = recognizer;
    this.lastProgressPercent = 0;
    this.emit({
      type: 'progress',
      phase: 'init',
      percent: 0,
      loaded: 0,
      total: 0,
    });

    recognizer.on('download_progress', (p: DownloadProgressEvent) => {
      const pct = p.total > 0 ? Math.min(100, (p.loaded / p.total) * 100) : p.percent;
      this.lastProgressPercent = Math.round(pct);
      const doneDownloading = p.total > 0 && p.loaded >= p.total;
      this.emit({
        type: 'progress',
        phase: doneDownloading ? 'init' : 'download',
        percent: pct,
        loaded: p.loaded,
        total: p.total,
      });
    });

    recognizer.on('ready', () => {
      this.isModelReady = true;
      this.lastProgressPercent = 100;
      this.emit({
        type: 'progress',
        phase: 'ready',
        percent: 100,
      });
      if (this.desiredActive && this.stream && this.state === 'loading') {
        this.setState('listening');
      }
    });

    recognizer.on('vad_state_change', ({ state }) => {
      this.vadActive = state === 1;
      if (state === 1) {
        this.hasSpokenInTurn = true;
        this.lastTtsSpeakingTime = 0;
        this.emit({ type: 'speech_start' });
        this.emit({ type: 'speech_prob', prob: 0.95 });
      } else if (state === 2) {
        this.emit({ type: 'speech_prob', prob: 0.1 });
      } else {
        this.emit({ type: 'speech_prob', prob: 0 });
      }
    });

    recognizer.on('recognizing', ({ text, isFinal, isRefined }) => {
      if (!isRefined) {
        this.receivedResultCount++;
        this.lastResultIgnored = this.receivedResultCount <= this.ignoreResultsUntilCount;
      }
      if (this.lastResultIgnored || isRefined || isFinal || !this.desiredActive) return;

      const raw = text?.trim() ?? '';
      if (!raw || raw === this.lastEmittedRawText) return;
      this.lastEmittedRawText = raw;

      const formatted = formatDraftPunctuation(raw);
      this.emit({ type: 'text', text: formatted, isFinal: false, rawText: text });
    });

    recognizer.on('recognized', ({ text, inferenceMs }) => {
      if (this.lastResultIgnored) return;
      this.lastEmittedRawText = '';

      const raw = text?.trim() ?? '';
      if (raw.length > 0) {
        const finalized = finalizePunctuation(raw);
        this.emit({ type: 'text', text: finalized, isFinal: true, rawText: text });

        const pcm = this.flushSpeechPcm();
        this.emit({
          type: 'utterance_result',
          id: ++this.utteranceCounter,
          text: finalized,
          pcm,
          sampleRate: 16000,
          durationMs: (pcm.length / 16000) * 1000,
          inferenceMs: inferenceMs || 0,
          rms: this.lastRms,
          isFinal: true,
        });
      }
      if (this.stream && this.desiredActive) {
        this.setState('listening');
      }
    });

    recognizer.on('error', (err) => {
      if (this.receivedResultCount < this.sentFeedCount) {
        this.receivedResultCount = this.sentFeedCount;
      }
      console.error('[SttClient] recognizer error:', err);
      this.failSession(err.message || 'Stream ASR error');
    });

    this.loadPromise = recognizer.init().catch((err) => {
      // Allow a fresh retry on next preload()/start() and immediately release any open mic stream.
      try { recognizer.destroy?.(); } catch {}
      if (this.recognizer === recognizer) this.recognizer = null;
      this.loadPromise = null;
      this.isModelReady = false;
      this.sentFeedCount = 0;
      this.receivedResultCount = 0;
      this.ignoreResultsUntilCount = 0;
      this.lastResultIgnored = false;
      this.failSession(err instanceof Error ? err.message : 'Stream ASR init failed');
      throw err;
    });
    return this.loadPromise;
  }

  preload(): void {
    if (this.loadPromise) return;
    if (!this.isModelReady && !this.stream && !this.desiredActive) {
      this.setState('loading');
    }
    this.initRecognizer().catch((err) => {
      console.warn('[SttClient] preload error:', err);
    });
  }

  async toggle(): Promise<void> {
    if (this.stream || this.desiredActive || this.state === 'listening' || this.state === 'recognizing') {
      await this.stop(true);
      return;
    }
    await this.start();
  }

  async start(): Promise<void> {
    this.resetSession();
    this.desiredActive = true;
    const sessionId = ++this.startSessionId;
    try {
      if (this.isModelReady) {
        this.setState('listening');
      } else {
        this.setState('loading');
      }
      this.preload();

      if (typeof window !== 'undefined' && !window.isSecureContext) {
        throw Object.assign(new Error('mic_insecure'), { name: 'SecurityError' });
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        throw Object.assign(new Error('mic_unsupported'), { name: 'NotSupportedError' });
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

      if (sessionId !== this.startSessionId || !this.desiredActive) {
        for (const t of stream.getTracks()) t.stop();
        return;
      }
      this.stream = stream;

      const ctx = new AudioContext();
      this.audioCtx = ctx;
      if (ctx.state === 'suspended') await ctx.resume();
      if (sessionId !== this.startSessionId || !this.desiredActive) {
        this.teardownAudio();
        return;
      }

      const source = ctx.createMediaStreamSource(stream);
      this.source = source;

      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0;
      source.connect(analyser);
      this.analyser = analyser;

      const processor = ctx.createScriptProcessor(4096, 1, 1);
      this.processor = processor;
      processor.onaudioprocess = (e) => {
        if (!this.desiredActive || this.processor !== processor) return;
        const input = e.inputBuffer.getChannelData(0);
        this.processPcmChunk(input, ctx.sampleRate);
      };

      const mute = ctx.createGain();
      mute.gain.value = 0;
      source.connect(processor);
      processor.connect(mute);
      mute.connect(ctx.destination);

      if (this.isModelReady && this.state !== 'recognizing') {
        this.setState('listening');
      }
    } catch (e) {
      this.failSession(classifyMediaError(e));
    }
  }

  private processPcmChunk(chunk: Float32Array, sampleRate: number): void {
    if (chunk.length === 0) return;

    const pcm16k = resampleTo(16000, chunk, sampleRate);
    const rms = meanRms(pcm16k);
    this.lastRms = rms;
    this.emit({ type: 'partial_rms', rms });

    const now = performance.now();
    const isCurrentlySpeaking = this.isTtsSpeakingProvider ? this.isTtsSpeakingProvider() : false;
    if (isCurrentlySpeaking) {
      this.lastTtsSpeakingTime = now;
    }
    const ttsCooldownMs = APP_CONFIG.stt.ttsCooldownMs ?? 250;
    const isGuardActive =
      isCurrentlySpeaking ||
      (this.lastTtsSpeakingTime > 0 && now - this.lastTtsSpeakingTime < ttsCooldownMs);

    const bargeInRms = APP_CONFIG.stt.bargeInRms ?? 0.08;

    if (isGuardActive && rms < bargeInRms) {
      this.emit({ type: 'speech_prob', prob: 0 });
      return;
    }

    if (isGuardActive && rms >= bargeInRms) {
      this.lastTtsSpeakingTime = 0;
    }

    if (this.recognizer && this.isModelReady) {
      const copy = new Float32Array(pcm16k.length);
      copy.set(pcm16k);
      try {
        this.recognizer.feed(copy, 16000);
        this.sentFeedCount++;
        this.hasFedAudioInTurn = true;
        this.bufferPcm(copy);
      } catch (err) {
        console.warn('[SttClient] feed error:', err);
      }
    }
  }

  private bufferPcm(chunk: Float32Array): void {
    this.speechPcmBuffer.push(chunk);
    this.speechPcmSamples += chunk.length;
    const limit =
      this.vadActive || this.hasSpokenInTurn
        ? SttClient.MAX_BUFFER_SAMPLES
        : SttClient.SILENCE_PREROLL_SAMPLES;
    while (this.speechPcmSamples > limit && this.speechPcmBuffer.length > 1) {
      this.speechPcmSamples -= this.speechPcmBuffer.shift()!.length;
    }
  }

  private flushSpeechPcm(): Float32Array {
    this.hasSpokenInTurn = false;
    if (this.speechPcmBuffer.length === 0) return new Float32Array(0);
    let totalLen = 0;
    for (const c of this.speechPcmBuffer) totalLen += c.length;
    const out = new Float32Array(totalLen);
    let offset = 0;
    for (const c of this.speechPcmBuffer) {
      out.set(c, offset);
      offset += c.length;
    }
    this.speechPcmBuffer = [];
    this.speechPcmSamples = 0;
    return out;
  }

  private teardownAudio(): void {
    if (this.processor) {
      try { this.processor.disconnect(); } catch {}
      this.processor = null;
    }
    if (this.source) {
      try { this.source.disconnect(); } catch {}
      this.source = null;
    }
    if (this.analyser) {
      try { this.analyser.disconnect(); } catch {}
      this.analyser = null;
    }
    if (this.stream) {
      for (const t of this.stream.getTracks()) {
        try { t.stop(); } catch {}
      }
      this.stream = null;
    }
    if (this.audioCtx) {
      try { void this.audioCtx.close(); } catch {}
      this.audioCtx = null;
    }
  }

  async stop(commit = true): Promise<void> {
    this.desiredActive = false;
    this.startSessionId++;
    this.vadActive = false;
    this.teardownAudio();
    if (commit && this.recognizer && this.isModelReady && this.hasFedAudioInTurn) {
      this.hasFedAudioInTurn = false;
      this.lastEmittedRawText = '';
      try {
        this.recognizer.finish();
        this.sentFeedCount++;
        // Immediately queue RESET behind finish() so WASM universalSegments/universalTranscript
        // never leak this turn's speech into subsequent sessions.
        this.recognizer.reset();
      } catch (err) {
        console.warn('[SttClient] finish error:', err);
      }
    } else {
      this.resetSession();
    }
    this.setState('idle');
  }

  resetSession(): void {
    this.ignoreResultsUntilCount = this.sentFeedCount;
    this.hasFedAudioInTurn = false;
    this.hasSpokenInTurn = false;
    this.lastEmittedRawText = '';
    this.vadActive = false;
    if (this.recognizer && this.isModelReady) {
      try {
        this.recognizer.reset();
      } catch {}
    }
    this.speechPcmBuffer = [];
    this.speechPcmSamples = 0;
  }

  dispose(): void {
    void this.stop(false);
    if (this.recognizer) {
      try {
        this.recognizer.destroy?.();
      } catch {}
      this.recognizer = null;
    }
    this.listeners.clear();
    this.loadPromise = null;
    this.isModelReady = false;
    this.sentFeedCount = 0;
    this.receivedResultCount = 0;
    this.ignoreResultsUntilCount = 0;
    this.lastResultIgnored = false;
    this.hasFedAudioInTurn = false;
    this.hasSpokenInTurn = false;
    this.lastEmittedRawText = '';
    this.speechPcmBuffer = [];
    this.speechPcmSamples = 0;
    this.vadActive = false;
    this.setState('idle');
  }
}

let sharedSttClient: SttClient | null = null;
export function getSharedSttClient(): SttClient {
  if (!sharedSttClient) {
    sharedSttClient = new SttClient();
  }
  return sharedSttClient;
}

export interface TextRange {
  start: number;
  end: number;
}

/**
 * Replaces or inserts text within a designated range of an input/textarea.
 * If range is null, inserts at caret (like insertAtCursor) and returns the new range.
 * If range is provided, replaces text within [range.start, range.end] and returns updated range.
 */
export function replaceOrInsertAtRange(
  el: HTMLInputElement | HTMLTextAreaElement,
  text: string,
  range: TextRange | null,
): TextRange {
  try {
    if (typeof document === 'undefined' || document.activeElement !== el) {
      el.focus?.({ preventScroll: true });
    }
  } catch {
    try {
      el.focus?.();
    } catch {
      /* ignore */
    }
  }

  const val = el.value;
  let start = range ? Math.min(range.start, val.length) : (el.selectionStart ?? val.length);
  let end = range ? Math.min(range.end, val.length) : (el.selectionEnd ?? val.length);
  if (start > end) {
    const tmp = start;
    start = end;
    end = tmp;
  }

  const before = val.slice(0, start);
  const after = val.slice(end);

  let piece = text;
  if (!range) {
    const isLatinOrDigit = /[a-zA-Z0-9]$/;
    const startsWithLatinOrDigit = /^[a-zA-Z0-9]/;
    if (isLatinOrDigit.test(before) && startsWithLatinOrDigit.test(text)) {
      piece = ' ' + text;
    }
  }

  const newVal = before + piece + after;
  let applied = false;
  if (typeof window !== 'undefined') {
    const proto =
      typeof HTMLTextAreaElement !== 'undefined' && el instanceof HTMLTextAreaElement
        ? window.HTMLTextAreaElement?.prototype
        : typeof HTMLInputElement !== 'undefined' && el instanceof HTMLInputElement
        ? window.HTMLInputElement?.prototype
        : null;
    const setter = proto ? Object.getOwnPropertyDescriptor(proto, 'value')?.set : null;
    if (setter) {
      try {
        setter.call(el, newVal);
        applied = true;
      } catch {
        /* fallback to direct value assignment on mock/cross-realm elements */
      }
    }
  }
  if (!applied) {
    el.value = newVal;
  }

  const newEnd = start + piece.length;
  try {
    el.setSelectionRange(newEnd, newEnd);
  } catch {
    /* unfocused textarea may throw in some WebKits; value still updated */
  }
  try {
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  } catch {
    /* ignore in non-DOM environments */
  }

  return { start, end: newEnd };
}

/** Insert text at caret of input/textarea (does not replace whole field). */
export function insertAtCursor(
  el: HTMLInputElement | HTMLTextAreaElement,
  text: string,
): void {
  replaceOrInsertAtRange(el, text, null);
}
