/**
 * duplexTurnClient.ts — Main-thread async RPC client for Layer 1B DuplexTurn WASM Worker.
 * Runs Whisper-tiny encoder + attention pooling turn classifier completely off the main thread.
 */

import { isLoopbackHost } from '@/lib/loopback';
import { resolveOrtWasmPaths } from '@/lib/ortWasm';
import type { DuplexTurnClientOptions, DuplexTurnPrediction } from './types';

interface PendingCall<T> {
  resolve: (value: T) => void;
  reject: (err: Error) => void;
}

type WorkerOutMessage =
  | { type: 'ready'; id: number; temperature: number }
  | { type: 'warmed'; id: number; inferMs: number }
  | { type: 'prediction'; id: number; result: DuplexTurnPrediction }
  | { type: 'disposed'; id: number }
  | { type: 'error'; id: number; message: string };

export class DuplexTurnClient {
  private worker: Worker | null = null;
  private nextId = 1;
  private ready = false;
  private initPromise: Promise<void> | null = null;
  private pending = new Map<number, PendingCall<unknown>>();
  private readonly options: DuplexTurnClientOptions;

  constructor(options: DuplexTurnClientOptions = {}) {
    this.options = options;
  }

  isReady(): boolean {
    return this.ready && this.worker !== null;
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const worker = new Worker(new URL('./duplexTurnWorker.ts', import.meta.url), {
      type: 'module',
    });
    worker.onmessage = (ev: MessageEvent<WorkerOutMessage>) => {
      const msg = ev.data;
      const entry = this.pending.get(msg.id);
      if (!entry) return;
      this.pending.delete(msg.id);
      if (msg.type === 'error') {
        entry.reject(new Error(msg.message));
      } else if (msg.type === 'prediction') {
        entry.resolve(msg.result);
      } else if (msg.type === 'warmed') {
        entry.resolve(msg.inferMs);
      } else {
        entry.resolve(undefined);
      }
    };
    worker.onerror = (ev) => {
      const err = new Error(ev.message || 'DuplexTurnWorker error');
      for (const [, p] of this.pending) {
        p.reject(err);
      }
      this.pending.clear();
      this.ready = false;
    };
    this.worker = worker;
    return worker;
  }

  private call<T>(payload: Record<string, unknown>, transfer?: Transferable[]): Promise<T> {
    const worker = this.ensureWorker();
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
      });
      if (transfer && transfer.length > 0) {
        worker.postMessage({ ...payload, id }, transfer);
      } else {
        worker.postMessage({ ...payload, id });
      }
    });
  }

  async init(overrides: Partial<DuplexTurnClientOptions> = {}): Promise<void> {
    if (this.ready && this.worker) return;
    if (this.initPromise) return this.initPromise;

    const merged = { ...this.options, ...overrides };
    const loopback = merged.loopback ?? isLoopbackHost();
    const wasmPaths = merged.wasmPaths ?? resolveOrtWasmPaths(loopback);
    const hw = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 2;
    const numThreads = merged.numThreads ?? Math.min(2, Math.max(1, hw));

    this.initPromise = this.call<void>({
      type: 'init',
      modelUrl: merged.modelUrl,
      manifestUrl: merged.manifestUrl,
      wasmPaths,
      loopback,
      numThreads,
      temperature: merged.temperature,
    }).then(() => {
      this.ready = true;
    });

    try {
      await this.initPromise;
    } catch (err) {
      this.initPromise = null;
      this.ready = false;
      throw err;
    }
  }

  async warmup(): Promise<number> {
    if (!this.ready) {
      await this.init();
    }
    return this.call<number>({ type: 'warmup' });
  }

  async predict(pcm16k: Float32Array): Promise<DuplexTurnPrediction> {
    if (!this.ready) {
      await this.init();
    }
    // Copy caller view so we never detach a reusable ring buffer via Transferable
    const copy = new Float32Array(pcm16k);
    return this.call<DuplexTurnPrediction>(
      { type: 'predict', pcm16k: copy },
      [copy.buffer],
    );
  }

  async dispose(): Promise<void> {
    const w = this.worker;
    this.ready = false;
    this.initPromise = null;
    if (!w) return;
    try {
      await this.call<void>({ type: 'dispose' });
    } catch {
      // Ignore worker error during teardown
    }
    for (const [, p] of this.pending) {
      p.reject(new Error('DuplexTurnClient disposed'));
    }
    this.pending.clear();
    w.terminate();
    this.worker = null;
  }
}
