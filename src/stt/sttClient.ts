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

export type SttUiState = 'idle' | 'loading' | 'listening' | 'recognizing' | 'error';

export type SttClientEvent =
  | { type: 'state'; state: SttUiState }
  | { type: 'progress'; phase: 'download' | 'init' | 'ready'; percent: number }
  | { type: 'partial_rms'; rms: number }
  | { type: 'speech_prob'; prob: number }
  | { type: 'speech_start' }
  | { type: 'text'; text: string }
  | {
      type: 'utterance_result';
      id: number;
      text: string;
      pcm: Float32Array;
      sampleRate: number;
      durationMs: number;
      inferenceMs: number;
      rms: number;
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
  /** True while a segment is in-flight; speech_end queues one pending utterance. */
  private recognizingBusy = false;
  private pendingUtterance: Float32Array | null = null;
  private inFlightUtterance: {
    id: number;
    pcm: Float32Array;
    sampleRate: number;
    durationMs: number;
    startTime: number;
    rms: number;
  } | null = null;
  private adhocRequests = new Map<
    number,
    {
      resolve: (res: { text: string; inferenceMs: number }) => void;
      reject: (err: Error) => void;
      startTime: number;
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
      if (msg.type === 'result') {
        const cleaned = richTranscriptionPostprocess(String(msg.text ?? ''));
        const reqId = Number(msg.id);
        const adhoc = this.adhocRequests.get(reqId);
        if (adhoc) {
          this.adhocRequests.delete(reqId);
          const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
          const inferenceMs = Math.round(now - adhoc.startTime);
          adhoc.resolve({ text: cleaned, inferenceMs });
          return;
        }

        this.recognizingBusy = false;
        // Continuous dictation: stay listening if mic still open; user toggles mic to stop.
        if (this.stream) this.setState('listening');
        else this.setState('idle');

        const inFlight = this.inFlightUtterance;
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
          });
        }

        if (cleaned) {
          this.emit({ type: 'text', text: cleaned });
        } else {
          this.emit({ type: 'error', message: 'empty_transcript' });
        }
        const pending = this.pendingUtterance;
        this.pendingUtterance = null;
        if (pending && this.stream) {
          const ms = (pending.length / APP_CONFIG.stt.sampleRate) * 1000;
          if (!this.shouldSkipUtterance(pending, ms)) this.submitUtterance(pending);
        }
        return;
      }
      if (msg.type === 'error') {
        const reqId = Number(msg.id);
        const adhoc = this.adhocRequests.get(reqId);
        if (adhoc) {
          this.adhocRequests.delete(reqId);
          adhoc.reject(new Error(String(msg.message || 'STT recognition error')));
          return;
        }

        this.inFlightUtterance = null;
        const message = String(msg.message ?? 'STT error');
        this.recognizingBusy = false;
        this.pendingUtterance = null;
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
            this.emit({ type: 'speech_start' });
          } else if (ev.type === 'speech_end') {
            if (this.shouldSkipUtterance(ev.pcm, ev.durationMs)) {
              return;
            }
            if (this.recognizingBusy) {
              this.pendingUtterance = ev.pcm.slice();
            } else {
              this.submitUtterance(ev.pcm);
            }
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

  /** Stop mic; if flushUtterance, send leftover speech to recognizer. */
  async stop(flushUtterance = true): Promise<void> {
    this.desiredActive = false;
    this.startSessionId++;
    const leftover = flushUtterance ? this.vad?.flush() ?? null : null;
    this.teardownAudio();
    if (leftover) {
      const ms = (leftover.length / APP_CONFIG.stt.sampleRate) * 1000;
      if (!this.shouldSkipUtterance(leftover, ms)) {
        this.submitUtterance(leftover);
        return;
      }
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

  private submitUtterance(pcm: Float32Array): void {
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
    };

    const w = this.ensureWorker();
    const copy = pcm.slice();
    w.postMessage({ type: 'recognize', id, pcm: copy, sampleRate: sr }, [
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
    this.preload();
    const w = this.ensureWorker();
    const id = ++this.recogId;
    const copy = pcm.slice();
    const startTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
    return new Promise((resolve, reject) => {
      this.adhocRequests.set(id, { resolve, reject, startTime });
      w.postMessage({ type: 'recognize', id, pcm: copy, sampleRate }, [copy.buffer]);
    });
  }

  dispose(): void {
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

/** Insert text at caret of input/textarea (does not replace whole field). */
export function insertAtCursor(
  el: HTMLInputElement | HTMLTextAreaElement,
  text: string,
): void {
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

  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? el.value.length;
  const before = el.value.slice(0, start);
  const after = el.value.slice(end);
  const isLatinOrDigit = /[a-zA-Z0-9]$/;
  const startsWithLatinOrDigit = /^[a-zA-Z0-9]/;
  const needsLead = isLatinOrDigit.test(before) && startsWithLatinOrDigit.test(text);
  const piece = (needsLead ? ' ' : '') + text;
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

  const pos = before.length + piece.length;
  try {
    el.setSelectionRange(pos, pos);
  } catch {
    /* unfocused textarea may throw in some WebKits; value still updated */
  }
  try {
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  } catch {
    /* ignore in non-DOM environments */
  }
}
