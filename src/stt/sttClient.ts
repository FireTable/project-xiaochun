/**
 * sttClient.ts — main-thread mic capture + energy VAD + worker bridge for ChatBar.
 *
 * States: idle | loading | listening | recognizing | error
 * Click mic: toggle start/stop. Stop mid-utterance flushes VAD → recognize.
 */
import { APP_CONFIG } from '@/config';
import { EnergyVad } from './energyVad';
import {
  isFillerOrUnreadable,
  richTranscriptionPostprocess,
} from './transcriptFilter';

export type SttUiState = 'idle' | 'loading' | 'listening' | 'recognizing' | 'error';

export type SttClientEvent =
  | { type: 'state'; state: SttUiState }
  | { type: 'progress'; phase: 'download' | 'init' | 'ready'; percent: number }
  | { type: 'partial_rms'; rms: number }
  | { type: 'text'; text: string }
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
  private vad: EnergyVad | null = null;
  private recogId = 0;
  private loadStarted = false;
  /** True while a segment is in-flight; speech_end queues one pending utterance. */
  private recognizingBusy = false;
  private pendingUtterance: Float32Array | null = null;
  private lastProgressPercent = 0;

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
        this.setState('loading');
        this.emit({ type: 'progress', phase, percent });
        if (phase === 'ready') {
          // stay loading until mic starts, or idle if not listening
          if (this.state === 'loading' && !this.stream) this.setState('idle');
        }
        return;
      }
      if (msg.type === 'ready') {
        this.lastProgressPercent = 100;
        this.emit({ type: 'progress', phase: 'ready', percent: 100 });
        if (!this.stream) this.setState('idle');
        return;
      }
      if (msg.type === 'result') {
        const cleaned = richTranscriptionPostprocess(String(msg.text ?? ''));
        this.recognizingBusy = false;
        // Continuous dictation: stay listening if mic still open; user toggles mic to stop.
        if (this.stream) this.setState('listening');
        else this.setState('idle');
        if (cleaned && !isFillerOrUnreadable(cleaned)) {
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
    this.setState('loading');
    this.ensureWorker().postMessage({ type: 'load' });
  }

  /** Toggle listening. */
  async toggle(): Promise<void> {
    if (this.state === 'listening') {
      await this.stop(true);
      return;
    }
    if (this.state === 'recognizing' || this.state === 'loading') {
      // Allow cancel while loading? keep simple: ignore during recognizing
      if (this.state === 'recognizing') return;
    }
    await this.start();
  }

  async start(): Promise<void> {
    try {
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
      this.stream = stream;

      const ctx = new AudioContext();
      this.audioCtx = ctx;
      if (ctx.state === 'suspended') await ctx.resume();

      const sr = APP_CONFIG.stt.sampleRate;
      this.vad = new EnergyVad({
        sampleRate: sr,
        silenceMs: APP_CONFIG.stt.vadSilenceMs,
        maxMs: APP_CONFIG.stt.vadMaxMs,
        startThreshold: APP_CONFIG.stt.vadStartThreshold,
        silenceThreshold: APP_CONFIG.stt.vadSilenceThreshold,
        startMs: APP_CONFIG.stt.vadStartMs,
        prerollMs: APP_CONFIG.stt.vadPrerollMs,
      });

      const source = ctx.createMediaStreamSource(stream);
      this.source = source;
      // ScriptProcessor: widely supported in Safari/Chromium/Tauri WKWebView.
      const processor = ctx.createScriptProcessor(4096, 1, 1);
      this.processor = processor;
      processor.onaudioprocess = (e) => {
        const input = e.inputBuffer.getChannelData(0);
        const copy = new Float32Array(input.length);
        copy.set(input);
        const pcm = resampleTo(sr, copy, ctx.sampleRate);
        this.vad?.push(pcm, (ev) => {
          if (ev.type === 'frame') {
            this.emit({ type: 'partial_rms', rms: ev.rms });
          } else if (ev.type === 'speech_start') {
            // stay listening
          } else if (ev.type === 'speech_end') {
            if (this.shouldSkipUtterance(ev.pcm, ev.durationMs)) {
              return; // stay listening; no decode / no insert
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
      this.setState('listening');
    } catch (e) {
      this.teardownAudio();
      const message = classifyMediaError(e);
      this.setState('error');
      this.emit({ type: 'error', message });
    }
  }

  /** Stop mic; if flushUtterance, send leftover speech to recognizer. */
  async stop(flushUtterance = true): Promise<void> {
    const leftover = flushUtterance ? this.vad?.flush() ?? null : null;
    this.teardownAudio();
    if (leftover) {
      const ms = (leftover.length / APP_CONFIG.stt.sampleRate) * 1000;
      if (!this.shouldSkipUtterance(leftover, ms)) this.submitUtterance(leftover);
      else if (this.state === 'listening' || this.state === 'recognizing') this.setState('idle');
    } else if (this.state === 'listening') {
      this.setState('idle');
    }
  }

  /** otoji-style: min duration + short/quiet → skip decode. */
  private shouldSkipUtterance(pcm: Float32Array, durationMs: number): boolean {
    const stt = APP_CONFIG.stt;
    if (pcm.length === 0) return true;
    // Only skip ultra-short; do not drop quiet short speech.
    if (durationMs < stt.minUtteranceMs) return true;
    return false;
  }

  private submitUtterance(pcm: Float32Array): void {
    // Keep mic/VAD running so dictation continues after this segment.
    this.recognizingBusy = true;
    this.setState('recognizing');
    const id = ++this.recogId;
    const w = this.ensureWorker();
    // Copy before transfer — VAD buffer may still be referenced.
    const copy = pcm.slice();
    w.postMessage({ type: 'recognize', id, pcm: copy, sampleRate: APP_CONFIG.stt.sampleRate }, [
      copy.buffer,
    ]);
  }

  private teardownAudio(): void {
    try {
      this.processor?.disconnect();
      this.source?.disconnect();
    } catch {
      /* ignore */
    }
    this.processor = null;
    this.source = null;
    if (this.audioCtx) {
      void this.audioCtx.close();
      this.audioCtx = null;
    }
    if (this.stream) {
      for (const t of this.stream.getTracks()) t.stop();
      this.stream = null;
    }
    this.vad?.reset();
    this.vad = null;
  }

  dispose(): void {
    void this.stop(false);
    this.worker?.terminate();
    this.worker = null;
    this.listeners.clear();
    this.loadStarted = false;
    this.setState('idle');
  }
}

/** Insert text at caret of input/textarea (does not replace whole field). */
export function insertAtCursor(
  el: HTMLInputElement | HTMLTextAreaElement,
  text: string,
): void {
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? el.value.length;
  const before = el.value.slice(0, start);
  const after = el.value.slice(end);
  // SenseVoice often returns no trailing space; add a space if inserting mid-sentence.
  const needsLead =
    before.length > 0 && !/\s$/.test(before) && !/^[\s,.;:!?，。！？、]/.test(text);
  const piece = (needsLead ? ' ' : '') + text;
  el.value = before + piece + after;
  const pos = before.length + piece.length;
  // Do not focus — continuous dictation must not steal focus from the user.
  try {
    el.setSelectionRange(pos, pos);
  } catch {
    /* unfocused textarea may throw in some WebKits; value still updated */
  }
  el.dispatchEvent(new Event('input', { bubbles: true }));
}
