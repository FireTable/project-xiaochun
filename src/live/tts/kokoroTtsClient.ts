/**
 * kokoroTtsClient.ts — Main-thread async RPC client for `kokoroWorker.ts`.
 *
 * Provides 100% local offline bilingual ZH+EN TTS at 24 kHz with 0 MB WebGPU VRAM usage.
 * Supports `init()`, `preload()`, `synthesize()`, `isReady()`, `dispose()`, and `AbortSignal`.
 */

import { isLoopbackHost } from '@/lib/loopback';
import { mapEmotionToProsody, stripAffectiveTags } from './affectiveClauseSlicer';
import type { TtsAudioResult, TtsSynthesisRequest } from './types';

export interface KokoroTtsClientOptions {
  modelBaseUrl?: string;
}

interface PendingCall {
  resolve: (value: any) => void;
  reject: (err: Error) => void;
  cleanup?: () => void;
}

export class KokoroTtsClient {
  private readonly modelBaseUrl: string;
  private worker: Worker | null = null;
  private ready = false;
  private initPromise: Promise<void> | null = null;
  private nextMsgId = 1;
  private nextReqId = 1;
  private pending = new Map<number, PendingCall>();

  constructor(options: KokoroTtsClientOptions = {}) {
    this.modelBaseUrl = options.modelBaseUrl ?? '/models/kokoro-zh';
  }

  isReady(): boolean {
    return this.ready;
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const w = new Worker(new URL('./kokoroWorker.ts', import.meta.url), {
      type: 'module',
    });
    w.addEventListener('message', (ev: MessageEvent<any>) => {
      const msg = ev.data;
      if (!msg || typeof msg.id !== 'number') return;
      const entry = this.pending.get(msg.id);
      if (!entry) return;
      this.pending.delete(msg.id);
      entry.cleanup?.();

      if (msg.type === 'ready' || msg.type === 'disposed') {
        entry.resolve(undefined);
      } else if (msg.type === 'result') {
        entry.resolve({
          pcm24k: msg.pcm24k,
          sampleRate: 24000,
          durationMs: msg.durationMs,
          ttfaMs: msg.ttfaMs,
          engine: 'kokoro-local',
        } satisfies TtsAudioResult);
      } else if (msg.type === 'aborted') {
        entry.reject(new DOMException('Aborted', 'AbortError') as unknown as Error);
      } else if (msg.type === 'error') {
        entry.reject(new Error(msg.error || 'Kokoro worker error'));
      }
    });
    w.addEventListener('error', (err) => {
      const e = new Error(`Kokoro worker crashed: ${err.message || 'unknown error'}`);
      for (const [, p] of this.pending) {
        p.cleanup?.();
        p.reject(e);
      }
      this.pending.clear();
      this.ready = false;
      this.initPromise = null;
    });
    this.worker = w;
    return w;
  }

  init(): Promise<void> {
    if (this.ready) return Promise.resolve();
    if (this.initPromise) return this.initPromise;

    const w = this.ensureWorker();
    const id = this.nextMsgId++;
    this.initPromise = new Promise<void>((resolve, reject) => {
      this.pending.set(id, {
        resolve: () => {
          this.ready = true;
          resolve();
        },
        reject: (err) => {
          this.initPromise = null;
          reject(err);
        },
      });
      w.postMessage({
        type: 'init',
        id,
        loopback: isLoopbackHost(),
        modelBaseUrl: this.modelBaseUrl,
      });
    });

    return this.initPromise;
  }

  preload(): void {
    void this.init().catch(() => {});
  }

  async synthesize(req: TtsSynthesisRequest): Promise<TtsAudioResult> {
    if (req.signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }
    await this.init();
    if (req.signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    const stripped = stripAffectiveTags(req.text);
    const cleanText = stripped.cleanText;
    if (!cleanText) {
      return {
        pcm24k: new Float32Array(0),
        sampleRate: 24000,
        durationMs: 0,
        ttfaMs: 0,
        engine: 'kokoro-local',
      };
    }

    const emotion = req.emotion ?? stripped.emotion;
    const { kokoroProsody } = mapEmotionToProsody(emotion, req.languageHint ?? 'mixed');
    const speed = req.speed ?? kokoroProsody.speed;
    const voicePreset =
      req.voicePreset &&
      ['blended', 'zf_001', 'zf_002', 'af_maple'].includes(req.voicePreset)
        ? req.voicePreset
        : kokoroProsody.voicePreset;

    const w = this.ensureWorker();
    const id = this.nextMsgId++;
    const requestId = this.nextReqId++;

    return new Promise<TtsAudioResult>((resolve, reject) => {
      const onAbort = () => {
        w.postMessage({ type: 'cancel', requestId });
        const entry = this.pending.get(id);
        if (entry) {
          this.pending.delete(id);
          entry.cleanup?.();
        }
        reject(new DOMException('Aborted', 'AbortError'));
      };

      const cleanup = () => {
        req.signal?.removeEventListener('abort', onAbort);
      };

      req.signal?.addEventListener('abort', onAbort, { once: true });
      this.pending.set(id, { resolve, reject, cleanup });
      w.postMessage({
        type: 'synthesize',
        id,
        requestId,
        text: cleanText,
        speed,
        voicePreset,
        usePhonemizer: true,
      });
    });
  }

  dispose(): void {
    for (const [, p] of this.pending) {
      p.cleanup?.();
      p.reject(new Error('KokoroTtsClient disposed'));
    }
    this.pending.clear();
    if (this.worker) {
      try {
        this.worker.postMessage({ type: 'dispose' });
        this.worker.terminate();
      } catch {
        /* ignore */
      }
      this.worker = null;
    }
    this.ready = false;
    this.initPromise = null;
  }
}
