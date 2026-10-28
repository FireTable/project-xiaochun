/**
 * sttClient.ts — main-thread mic capture + Silero neural VAD + worker bridge for ChatBar.
 *
 * States: idle | loading | listening | recognizing | error
 * Dual Mode:
 *  - Click to Toggle continuous dictation
 *  - Hold to Talk (Push-to-talk)
 * Stop mid-utterance flushes VAD → recognize.
 */
import { APP_CONFIG } from '@/config';
import { SileroVad } from './sileroVad';
import { richTranscriptionPostprocess } from './transcriptFilter';
import { formatDraftPunctuation, finalizePunctuation } from './punctuation';

export type SttUiState = 'idle' | 'loading' | 'listening' | 'recognizing' | 'error';

export type SttClientEvent =
  | { type: 'state'; state: SttUiState }
  | { type: 'progress'; phase: 'download' | 'init' | 'ready'; percent: number }
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

function resampleTo(targetRate: number, input: Float32Array, fromRate: number): Float32Array {
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
  private worker: Worker | null = null;
  private listeners = new Set<Listener>();
  private state: SttUiState = 'idle';
  private stream: MediaStream | null = null;
  private audioCtx: AudioContext | null = null;
  private processor: ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private analyser: AnalyserNode | null = null;
  private vad: SileroVad | null = null;
  private recogId = 0;
  private loadStarted = false;
  /** True while a segment is in-flight. */
  private recognizingBusy = false;
  /** Session audio accumulator: chunks of Float32Array for the current continuous turn. */
  private sessionPcmChunks: Float32Array[] = [];
  /** Timer to finalize (commit) the current session after a long silence. */
  private commitTimer: ReturnType<typeof setTimeout> | null = null;
  /** Cached latest text and rawText from the session for finalize without re-inference. */
  private lastSessionText = '';
  private lastSessionRawText = '';
  /** Total samples of PCM that was sent in the last recognize call. */
  private lastSubmittedPcmSamples = 0;
  private inFlightUtterance: {
    id: number;
    pcm: Float32Array;
    sampleRate: number;
    durationMs: number;
    startTime: number;
    rms: number;
    isFinal: boolean;
  } | null = null;
  private adhocRequests = new Map<
    number,
    {
      resolve: (res: { text: string; inferenceMs: number }) => void;
      reject: (err: Error) => void;
      startTime: number;
    }
  >();
  private punctuateRequests = new Map<
    number,
    {
      resolve: (text: string) => void;
      reject: (err: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private lastProgressPercent = 0;
  private isModelReady = false;
  private startSessionId = 0;
  private desiredActive = false;

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

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const w = new Worker(new URL('./sttWorker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (ev: MessageEvent<Record<string, unknown>>) => {
      const msg = ev.data;
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'progress') {
        const phase = msg.phase as 'download' | 'init' | 'ready';
        const percent = Number(msg.percent ?? 0);
        this.lastProgressPercent = percent;
        this.emit({ type: 'progress', phase, percent });
        if (phase === 'ready') {
          this.isModelReady = true;
          if (this.desiredActive || this.stream) this.setState('listening');
          else if (this.state === 'loading') this.setState('idle');
        } else if (!this.isModelReady && !this.stream && !this.desiredActive && this.state !== 'listening') {
          this.setState('loading');
        }
        return;
      }
      if (msg.type === 'ready') {
        this.isModelReady = true;
        this.lastProgressPercent = 100;
        this.emit({ type: 'progress', phase: 'ready', percent: 100 });
        if (this.desiredActive || this.stream) this.setState('listening');
        else if (this.state === 'loading') this.setState('idle');
        return;
      }
      if (msg.type === 'punctuate_result') {
        const reqId = Number(msg.id);
        const req = this.punctuateRequests.get(reqId);
        if (req) {
          this.punctuateRequests.delete(reqId);
          clearTimeout(req.timer);
          req.resolve(String(msg.text ?? ''));
        }
        return;
      }
      if (msg.type === 'result') {
        const inFlight = this.inFlightUtterance;
        const isFinal = Boolean(msg.isFinal ?? inFlight?.isFinal ?? false);
        const rawText = String(msg.rawText ?? '');
        const baseText = richTranscriptionPostprocess(String(msg.text ?? ''));

        const reqId = Number(msg.id);
        const adhoc = this.adhocRequests.get(reqId);
        if (adhoc) {
          this.adhocRequests.delete(reqId);
          const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
          const inferenceMs = Math.round(now - adhoc.startTime);
          const adhocText = finalizePunctuation(baseText);
          adhoc.resolve({ text: adhocText, inferenceMs });
          return;
        }

        void (async () => {
          let cleaned: string;
          if (isFinal) {
            cleaned = msg.isFinal
              ? finalizePunctuation(baseText)
              : await this.punctuateText(baseText);
          } else {
            cleaned = formatDraftPunctuation(baseText);
          }

          if (typeof console !== 'undefined' && typeof console.log === 'function' && cleaned) {
            console.log(
              `%c[STT Client]%c 识别文本就绪 [${isFinal ? '定稿' : '草稿'}]: "${cleaned}"${rawText ? ` (原始音素字流: "${rawText}")` : ''}`,
              isFinal ? 'color: #10b981; font-weight: bold;' : 'color: #94a3b8; font-weight: bold;',
              'color: inherit;',
            );
          }

          this.recognizingBusy = false;
          // Continuous dictation: stay listening if mic still open; user toggles mic to stop.
          if (this.stream) this.setState('listening');
          else this.setState('idle');

          this.inFlightUtterance = null;
          if (inFlight && (msg.id === undefined || inFlight.id === Number(msg.id))) {
            const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
            const inferenceMs = Math.round(now - inFlight.startTime);
            this.emit({
              type: 'utterance_result',
              id: inFlight.id,
              text: cleaned || String(msg.text ?? ''),
              pcm: inFlight.pcm,
              sampleRate: inFlight.sampleRate,
              durationMs: inFlight.durationMs,
              inferenceMs,
              rms: inFlight.rms,
              isFinal,
            });
          }

          if (cleaned) {
            this.lastSessionText = cleaned;
            this.lastSessionRawText = rawText;
            this.emit({ type: 'text', text: cleaned, isFinal, rawText });
          } else if (isFinal && !this.lastSessionText) {
            this.emit({ type: 'error', message: 'empty_transcript' });
          }

          if (isFinal) {
            this.sessionPcmChunks = [];
            this.lastSessionText = '';
            this.lastSessionRawText = '';
            this.lastSubmittedPcmSamples = 0;
          } else {
            // Check if more chunks arrived while in flight
            let currentTotal = 0;
            for (const c of this.sessionPcmChunks) currentTotal += c.length;
            if (currentTotal > this.lastSubmittedPcmSamples && this.stream) {
              const combined = this.concatSessionPcm();
              this.submitUtterance(combined, false);
            }
          }
        })();
        return;
      }
      if (msg.type === 'error') {
        const reqId = Number(msg.id);
        const puncReq = this.punctuateRequests.get(reqId);
        if (puncReq) {
          this.punctuateRequests.delete(reqId);
          clearTimeout(puncReq.timer);
          puncReq.reject(new Error(String(msg.message || 'Punctuation error')));
          return;
        }

        const adhoc = this.adhocRequests.get(reqId);
        if (adhoc) {
          this.adhocRequests.delete(reqId);
          adhoc.reject(new Error(String(msg.message || 'STT recognition error')));
          return;
        }

        this.inFlightUtterance = null;
        const message = String(msg.message ?? 'STT error');
        this.recognizingBusy = false;
        // Soft: too-short / empty decode should not kill the listening session.
        if (/too short|Not enough frames/i.test(message)) {
          if (this.stream) this.setState('listening');
          else this.setState('idle');
          this.emit({ type: 'error', message: 'empty_transcript' });
          return;
        }
        this.setState('error');
        this.emit({ type: 'error', message });
      }
    };
    w.onerror = (e) => {
      this.setState('error');
      this.emit({ type: 'error', message: e.message || 'STT worker error' });
    };
    this.worker = w;
    return w;
  }

  /** Prefetch model (download + ORT init). Safe to call early. */
  preload(): void {
    if (this.loadStarted) return;
    this.loadStarted = true;
    if (!this.isModelReady && !this.stream && !this.desiredActive) {
      this.setState('loading');
    }
    this.ensureWorker().postMessage({ type: 'load' });
    if (!this.vad) {
      this.vad = new SileroVad({
        sampleRate: APP_CONFIG.stt.sampleRate,
        silenceMs: APP_CONFIG.stt.vadSilenceMs ?? 450,
        maxMs: APP_CONFIG.stt.vadMaxMs ?? 20000,
        startThreshold: 0.50,
        silenceThreshold: 0.35,
        prerollMs: APP_CONFIG.stt.vadPrerollMs ?? 300,
        modelPath: (APP_CONFIG.stt as { sileroModelPath?: string }).sileroModelPath ?? '/models/silero_vad_v5.onnx',
      });
    }
    void this.vad.init().catch(() => {});
  }

  /** Toggle listening. */
  async toggle(): Promise<void> {
    if (this.stream || this.desiredActive || this.state === 'listening' || this.state === 'recognizing') {
      await this.stop(true);
      return;
    }
    await this.start();
  }

  async start(): Promise<void> {
    this.desiredActive = true;
    const sessionId = ++this.startSessionId;
    try {
      // Immediate visual feedback: activate edge glow without hardware wait
      this.setState('listening');
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

      // User stopped/cancelled while awaiting getUserMedia
      if (sessionId !== this.startSessionId || !this.desiredActive) {
        for (const t of stream.getTracks()) t.stop();
        return;
      }
      this.stream = stream;

      const ctx = new AudioContext();
      this.audioCtx = ctx;
      if (ctx.state === 'suspended') await ctx.resume();

      const sr = APP_CONFIG.stt.sampleRate;
      if (!this.vad) {
        this.vad = new SileroVad({
          sampleRate: sr,
          silenceMs: APP_CONFIG.stt.vadSilenceMs ?? 450,
          maxMs: APP_CONFIG.stt.vadMaxMs ?? 20000,
          startThreshold: 0.50,
          silenceThreshold: 0.35,
          prerollMs: APP_CONFIG.stt.vadPrerollMs ?? 300,
          modelPath: (APP_CONFIG.stt as { sileroModelPath?: string }).sileroModelPath ?? '/models/silero_vad_v5.onnx',
        });
      }
      void this.vad.init().catch(() => {});

      const source = ctx.createMediaStreamSource(stream);
      this.source = source;

      // Real-time microphone frequency analyser for VoicePill waveform
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0;
      source.connect(analyser);
      this.analyser = analyser;

      // ScriptProcessor: widely supported in Safari/Chromium/Tauri WKWebView.
      const processor = ctx.createScriptProcessor(4096, 1, 1);
      this.processor = processor;
      processor.onaudioprocess = (e) => {
        const input = e.inputBuffer.getChannelData(0);
        const copy = new Float32Array(input.length);
        copy.set(input);
        const pcm = resampleTo(sr, copy, ctx.sampleRate);
        void this.vad?.processChunk(pcm, (ev) => {
          if (ev.type === 'frame') {
            this.emit({ type: 'partial_rms', rms: ev.rms });
            this.emit({ type: 'speech_prob', prob: ev.prob });
          } else if (ev.type === 'speech_start') {
            if (this.commitTimer) {
              clearTimeout(this.commitTimer);
              this.commitTimer = null;
            }
            this.emit({ type: 'speech_start' });
          } else if (ev.type === 'speech_end') {
            if (this.shouldSkipUtterance(ev.pcm, ev.durationMs)) {
              return;
            }
            this.handleSpeechChunk(ev.pcm);
          }
        });
      };
      // Must be in the graph to fire; mute so we do not echo mic to speakers.
      const mute = ctx.createGain();
      mute.gain.value = 0;
      source.connect(processor);
      processor.connect(mute);
      mute.connect(ctx.destination);
      if (this.state === 'listening') {
        this.emit({ type: 'state', state: 'listening' });
      }
    } catch (e) {
      this.teardownAudio();
      const message = classifyMediaError(e);
      this.setState('error');
      this.emit({ type: 'error', message });
    }
  }

  private handleSpeechChunk(chunkPcm: Float32Array): void {
    this.sessionPcmChunks.push(chunkPcm);

    const sr = APP_CONFIG.stt.sampleRate;
    let totalSamples = 0;
    for (const c of this.sessionPcmChunks) totalSamples += c.length;
    const totalMs = (totalSamples / sr) * 1000;

    const maxMs = APP_CONFIG.stt.maxAccumulateMs ?? 15_000;
    const isOverLimit = totalMs >= maxMs;

    if (this.commitTimer) {
      clearTimeout(this.commitTimer);
      this.commitTimer = null;
    }

    if (!isOverLimit) {
      this.commitTimer = setTimeout(() => {
        void this.commitSession();
      }, APP_CONFIG.stt.commitSilenceMs ?? 1200);
    }

    if (this.recognizingBusy) {
      return;
    }

    const combined = this.concatSessionPcm();
    this.submitUtterance(combined, isOverLimit);
  }

  private concatSessionPcm(): Float32Array {
    let total = 0;
    for (const c of this.sessionPcmChunks) total += c.length;
    const combined = new Float32Array(total);
    let offset = 0;
    for (const c of this.sessionPcmChunks) {
      combined.set(c, offset);
      offset += c.length;
    }
    return combined;
  }

  /**
   * Commits and finalizes the active continuous speech session.
   * Clears the audio accumulator and delegates to CT-Transformer for final punctuation.
   */
  async commitSession(): Promise<void> {
    if (this.commitTimer) {
      clearTimeout(this.commitTimer);
      this.commitTimer = null;
    }

    if (this.sessionPcmChunks.length === 0 && !this.inFlightUtterance && !this.lastSessionText) {
      return;
    }

    if (this.inFlightUtterance) {
      this.inFlightUtterance.isFinal = true;
      return;
    }

    const textToCommit = this.lastSessionText;
    const rawToCommit = this.lastSessionRawText;

    this.sessionPcmChunks = [];
    this.lastSessionText = '';
    this.lastSessionRawText = '';
    this.lastSubmittedPcmSamples = 0;

    if (textToCommit) {
      const finalized = await this.punctuateText(textToCommit);
      if (typeof console !== 'undefined' && typeof console.log === 'function') {
        console.log(
          `%c[STT Client]%c 长停顿定稿固化: "${finalized}"`,
          'color: #0ea5e9; font-weight: bold;',
          'color: inherit;',
        );
      }
      this.emit({ type: 'text', text: finalized, isFinal: true, rawText: rawToCommit });
    }
  }

  /**
   * Resets active session state and pending chunks without emitting text.
   */
  resetSession(): void {
    if (this.commitTimer) {
      clearTimeout(this.commitTimer);
      this.commitTimer = null;
    }
    this.sessionPcmChunks = [];
    this.lastSessionText = '';
    this.lastSessionRawText = '';
    this.lastSubmittedPcmSamples = 0;
  }

  /**
   * Delegates final punctuation to CT-Transformer running in the STT Web Worker.
   * If the worker is unavailable or times out (>800ms), gracefully falls back to Stage 1 regex rules.
   */
  async punctuateText(text: string): Promise<string> {
    if (!text || !text.trim()) return '';
    const trimmed = text.trim();
    if (!this.worker || !this.isModelReady) {
      return finalizePunctuation(trimmed);
    }
    const id = ++this.recogId;
    return new Promise<string>((resolve) => {
      const timer = setTimeout(() => {
        this.punctuateRequests.delete(id);
        resolve(finalizePunctuation(trimmed));
      }, 800);

      this.punctuateRequests.set(id, {
        resolve,
        reject: () => resolve(finalizePunctuation(trimmed)),
        timer,
      });

      this.worker!.postMessage({ type: 'punctuate', id, text: trimmed });
    });
  }

  /** Stop mic; if flushUtterance, send leftover speech to recognizer and commit. */
  async stop(flushUtterance = true): Promise<void> {
    this.desiredActive = false;
    this.startSessionId++;
    if (this.commitTimer) {
      clearTimeout(this.commitTimer);
      this.commitTimer = null;
    }
    const leftover = flushUtterance ? this.vad?.flush() ?? null : null;
    this.teardownAudio();
    if (leftover) {
      const ms = (leftover.length / APP_CONFIG.stt.sampleRate) * 1000;
      if (!this.shouldSkipUtterance(leftover, ms)) {
        this.sessionPcmChunks.push(leftover);
      }
    }

    if (this.sessionPcmChunks.length > 0) {
      const combined = this.concatSessionPcm();
      this.submitUtterance(combined, true);
    } else {
      await this.commitSession();
    }
    this.setState('idle');
  }

  /** min duration check (200ms). */
  private shouldSkipUtterance(pcm: Float32Array, durationMs: number): boolean {
    const stt = APP_CONFIG.stt;
    if (pcm.length === 0) return true;
    if (durationMs < (stt.minUtteranceMs ?? 160)) return true;
    return false;
  }

  private submitUtterance(pcm: Float32Array, isFinal = false): void {
    this.recognizingBusy = true;
    this.setState('recognizing');
    const id = ++this.recogId;
    const sr = APP_CONFIG.stt.sampleRate;
    const durationMs = (pcm.length / sr) * 1000;
    let sumSq = 0;
    for (let i = 0; i < pcm.length; i++) {
      const v = pcm[i]!;
      sumSq += v * v;
    }
    const rms = Math.sqrt(sumSq / Math.max(1, pcm.length));

    this.inFlightUtterance = {
      id,
      pcm: pcm.slice(),
      sampleRate: sr,
      durationMs,
      startTime: typeof performance !== 'undefined' ? performance.now() : Date.now(),
      rms,
      isFinal,
    };
    this.lastSubmittedPcmSamples = pcm.length;

    const w = this.ensureWorker();
    const copy = pcm.slice();
    w.postMessage({ type: 'recognize', id, pcm: copy, sampleRate: sr, isFinal }, [
      copy.buffer,
    ]);
  }

  private teardownAudio(): void {
    try {
      this.analyser?.disconnect();
      this.processor?.disconnect();
      this.source?.disconnect();
    } catch {
      /* ignore */
    }
    this.analyser = null;
    this.processor = null;
    this.source = null;
    if (this.audioCtx) {
      try {
        void this.audioCtx.close();
      } catch {
        /* ignore */
      }
      this.audioCtx = null;
    }
    if (this.stream) {
      for (const t of this.stream.getTracks()) {
        try {
          t.stop();
        } catch {
          /* ignore */
        }
      }
      this.stream = null;
    }
    this.vad?.reset();
  }

  /**
   * Ad-hoc ASR inference on a raw PCM Float32Array buffer (e.g. for re-testing/benchmarking in DevDrawer).
   * Does NOT alter microphone capture, VAD state, or listening turn state.
   */
  async recognizePcm(
    pcm: Float32Array,
    sampleRate: number = APP_CONFIG.stt.sampleRate,
  ): Promise<{ text: string; inferenceMs: number }> {
    const w = this.ensureWorker();
    if (!this.loadStarted) {
      this.loadStarted = true;
      w.postMessage({ type: 'load' });
    }
    const id = ++this.recogId;
    const copy = pcm.slice();
    const startTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
    return new Promise((resolve, reject) => {
      this.adhocRequests.set(id, { resolve, reject, startTime });
      w.postMessage({ type: 'recognize', id, pcm: copy, sampleRate, isFinal: true }, [copy.buffer]);
    });
  }

  dispose(): void {
    if (this.commitTimer) {
      clearTimeout(this.commitTimer);
      this.commitTimer = null;
    }
    for (const req of this.punctuateRequests.values()) {
      clearTimeout(req.timer);
    }
    this.punctuateRequests.clear();
    this.sessionPcmChunks = [];
    this.lastSessionText = '';
    this.lastSessionRawText = '';
    this.lastSubmittedPcmSamples = 0;
    void this.stop(false);
    this.inFlightUtterance = null;
    this.adhocRequests.clear();
    this.vad?.dispose();
    this.vad = null;
    this.worker?.terminate();
    this.worker = null;
    this.listeners.clear();
    this.loadStarted = false;
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
        : window.HTMLInputElement?.prototype;
    const setter = proto ? Object.getOwnPropertyDescriptor(proto, 'value')?.set : null;
    if (setter) {
      setter.call(el, newVal);
      applied = true;
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
