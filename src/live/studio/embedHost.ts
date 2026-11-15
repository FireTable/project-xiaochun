/**
 * embedHost.ts — Same-origin MessageChannel host controller for `/embed?scene=beach3d&preset=normal`.
 *
 * Streams live 24 kHz TTS PCM to the embed stage via `xc.audio.begin` + `xc.audio.chunk` (`live: true`),
 * keeps exact host audio clock synced (`xc.clock`), forwards inference pressure (`xc.inference.state`),
 * turn posture (`xc.turnState`), affective expressions (`xc.expression`), and head bubble captions (`xc.bubble`),
 * and monitors host/stage animation cadence (FPS, max frame time, jank >25ms / >50ms).
 */

import {
  XC_PROTOCOL_VERSION,
  isXcEnvelope,
  xcMessage,
  type XcEnvelope,
  type XcHostMessageType,
  type XcHostPayloadMap,
} from '@firetable/project-xiaochun/protocol';
import type { LiveEmotionTag } from '@/live/tts/types';
import type { StudioTurnState } from './types';

export interface EmbedHostCallbacks {
  onReady?: () => void;
  onState?: (phase: string) => void;
  onUtterance?: (phase: 'start' | 'end', text: string) => void;
  onError?: (code: string, message: string) => void;
}

export class FrameCadenceMonitor {
  private rafId: number | null = null;
  private lastTs = 0;
  private fpsWindow: number[] = [];
  private deltaWindow: number[] = [];
  private currentTurnMinFps = 60;
  private currentTurnJank25 = 0;
  private currentTurnJank50 = 0;
  private totalJank25 = 0;
  private totalJank50 = 0;
  private maxFrameMs = 0;
  private onTick?: () => void;

  start(onTick?: () => void): void {
    this.onTick = onTick;
    if (this.rafId !== null || typeof requestAnimationFrame === 'undefined') return;
    this.lastTs = performance.now();
    const step = (ts: number) => {
      const dt = ts - this.lastTs;
      this.lastTs = ts;
      if (dt > 0.5 && dt < 1000) {
        this.deltaWindow.push(dt);
        if (this.deltaWindow.length > 60) this.deltaWindow.shift();
        const instFps = 1000 / dt;
        this.fpsWindow.push(instFps);
        if (this.fpsWindow.length > 60) this.fpsWindow.shift();
        if (dt > this.maxFrameMs) this.maxFrameMs = dt;
        if (instFps < this.currentTurnMinFps) this.currentTurnMinFps = instFps;
        if (dt > 25) {
          this.currentTurnJank25++;
          this.totalJank25++;
        }
        if (dt > 50) {
          this.currentTurnJank50++;
          this.totalJank50++;
        }
      }
      this.onTick?.();
      this.rafId = requestAnimationFrame(step);
    };
    this.rafId = requestAnimationFrame(step);
  }

  stop(): void {
    if (this.rafId !== null && typeof cancelAnimationFrame !== 'undefined') {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  beginTurnWindow(): void {
    this.currentTurnMinFps = this.getCurrentFps() || 60;
    this.currentTurnJank25 = 0;
    this.currentTurnJank50 = 0;
  }

  snapshotTurnWindow(): { minFps: number; jank25: number; jank50: number } {
    return {
      minFps: Math.round(Math.min(120, Math.max(0, this.currentTurnMinFps)) * 10) / 10,
      jank25: this.currentTurnJank25,
      jank50: this.currentTurnJank50,
    };
  }

  getCurrentFps(): number {
    if (this.deltaWindow.length === 0) return 60;
    const sum = this.deltaWindow.reduce((a, b) => a + b, 0);
    const avg = sum / this.deltaWindow.length;
    return avg > 0 ? Math.round((1000 / avg) * 10) / 10 : 60;
  }

  getAvgFrameMs(): number {
    if (this.deltaWindow.length === 0) return 16.6;
    const sum = this.deltaWindow.reduce((a, b) => a + b, 0);
    return Math.round((sum / this.deltaWindow.length) * 10) / 10;
  }

  getMaxFrameMs(): number {
    return Math.round(this.maxFrameMs * 10) / 10;
  }

  getTotalJank(): { jank25: number; jank50: number } {
    return { jank25: this.totalJank25, jank50: this.totalJank50 };
  }
}

export class EmbedStageClient {
  private readonly iframe: HTMLIFrameElement;
  private readonly callbacks: EmbedHostCallbacks;
  private port: MessagePort | null = null;
  private ready = false;
  private readyPromise: Promise<void> | null = null;
  private resolveReady: (() => void) | null = null;
  private msgSeq = 0;
  private activeAudioStreamId: string | null = null;
  private windowHandler: ((ev: MessageEvent) => void) | null = null;

  constructor(iframe: HTMLIFrameElement, callbacks: EmbedHostCallbacks = {}) {
    this.iframe = iframe;
    this.callbacks = callbacks;
  }

  isReady(): boolean {
    return this.ready;
  }

  getActiveAudioStreamId(): string | null {
    return this.activeAudioStreamId;
  }

  connect(): Promise<void> {
    if (this.ready) return Promise.resolve();
    if (this.readyPromise) return this.readyPromise;

    this.readyPromise = new Promise<void>((resolve) => {
      this.resolveReady = resolve;
      const expectedOrigin = window.location.origin;

      this.windowHandler = (ev: MessageEvent) => {
        if (ev.origin !== expectedOrigin) return;
        if (ev.source !== this.iframe.contentWindow) return;
        const msg = ev.data;
        if (!isXcEnvelope(msg) || msg.type !== 'xc.ready') return;
        if (this.port) return;

        const ch = new MessageChannel();
        this.port = ch.port1;
        ch.port1.onmessage = (portEv: MessageEvent) => {
          this.handleFrameMessage(portEv.data);
        };
        ch.port1.start();

        const initMsg = xcMessage('xc.init', {
          protocol: XC_PROTOCOL_VERSION,
          config: { scene: 'beach3d', preset: 'normal', ui: [] },
        });
        this.iframe.contentWindow?.postMessage(initMsg, expectedOrigin, [ch.port2]);
      };

      window.addEventListener('message', this.windowHandler);
    });

    return this.readyPromise;
  }

  private handleFrameMessage(data: unknown): void {
    if (!isXcEnvelope(data)) return;
    const env = data as XcEnvelope;
    if (env.type === 'xc.loaded') {
      if (!this.ready) {
        this.ready = true;
        this.resolveReady?.();
        this.callbacks.onReady?.();
      }
      return;
    }
    if (env.type === 'xc.state') {
      const p = (env.payload ?? {}) as { phase?: string };
      if (p.phase) this.callbacks.onState?.(p.phase);
      return;
    }
    if (env.type === 'xc.utterance') {
      const p = (env.payload ?? {}) as { phase?: 'start' | 'end'; text?: string };
      if (p.phase === 'start' || p.phase === 'end') {
        this.callbacks.onUtterance?.(p.phase, p.text ?? '');
      }
      return;
    }
    if (env.type === 'xc.error') {
      const p = (env.payload ?? {}) as { code?: string; message?: string };
      this.callbacks.onError?.(p.code ?? 'error', p.message ?? 'Embed error');
    }
  }

  private send<K extends XcHostMessageType>(
    type: K,
    payload: XcHostPayloadMap[K],
    id?: string,
    transfer?: Transferable[],
  ): void {
    if (!this.port) return;
    const envelope = xcMessage(type, payload, id);
    if (transfer && transfer.length > 0) {
      this.port.postMessage(envelope, transfer);
    } else {
      this.port.postMessage(envelope);
    }
  }

  nextId(prefix = 'live'): string {
    return `${prefix}_${++this.msgSeq}`;
  }

  setTurnState(state: StudioTurnState): void {
    this.send('xc.turnState', { state });
  }

  setExpression(name: LiveEmotionTag | string, intensity = 0.85): void {
    this.send('xc.expression', { name, intensity });
  }

  setBubble(text: string, visible = true): void {
    this.send('xc.bubble', {
      visible: visible && text.trim().length > 0,
      text,
      statusKey: text.trim().length > 0 ? 'speaking' : '',
    });
  }

  setInferenceActive(active: boolean): void {
    this.send('xc.inference.state', { active });
  }

  beginAudioStream(opts: {
    sampleRate: number;
    text?: string;
    firstSliceSec?: number;
    hostClock?: boolean;
    audible?: boolean;
    motion?: boolean;
    lipsync?: boolean;
  }): string {
    const streamId = this.nextId('aud');
    this.activeAudioStreamId = streamId;
    this.send(
      'xc.audio.begin',
      {
        sampleRate: opts.sampleRate,
        format: 'float32',
        channels: 1,
        text: opts.text ?? '',
        motion: opts.motion ?? true,
        lipsync: opts.lipsync ?? true,
        audible: opts.audible ?? false,
        hostClock: opts.hostClock ?? true,
        live: true,
        firstSliceSec: opts.firstSliceSec ?? 0.32,
      },
      streamId,
    );
    return streamId;
  }

  pushAudioChunk(
    streamId: string,
    pcm: Float32Array,
    sampleRate: number,
    text?: string,
  ): void {
    if (pcm.length === 0) return;
    const copy = new Float32Array(pcm);
    this.send(
      'xc.audio.chunk',
      {
        data: copy.buffer,
        format: 'float32',
        sampleRate,
        channels: 1,
        text,
        motion: true,
        lipsync: true,
        audible: false,
        hostClock: true,
        live: true,
        firstSliceSec: 0.32,
      },
      streamId,
      [copy.buffer],
    );
  }

  endAudioStream(streamId?: string, abort = false): void {
    const targetId = streamId ?? this.activeAudioStreamId;
    if (!targetId) return;
    this.send('xc.audio.end', { abort }, targetId);
    if (this.activeAudioStreamId === targetId) {
      this.activeAudioStreamId = null;
    }
  }

  sendClock(time: number, playing: boolean, playbackRate = 1, seek = false): void {
    this.send('xc.clock', { time, playing, playbackRate, seek });
  }

  stopAll(): void {
    if (this.activeAudioStreamId) {
      this.endAudioStream(this.activeAudioStreamId, true);
    }
    this.send('xc.stop', undefined);
  }

  dispose(): void {
    if (this.windowHandler) {
      window.removeEventListener('message', this.windowHandler);
      this.windowHandler = null;
    }
    this.port?.close();
    this.port = null;
    this.ready = false;
    this.readyPromise = null;
  }
}
