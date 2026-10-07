import {
  ARDY_HISTORY_FRAMES,
  ARDY_MODEL_FAMILY_URL,
  ARDY_PROMPT_MAX_CHARS,
  ARDY_STREAM_WINDOWS,
} from './model';
import type { RuntimeGenerationChunk, RuntimeGenerationResult } from './vendor/runtime/engine';
import {
  modelVariantBaseUrl,
  preferredModelVariant,
} from './vendor/runtime/model-variant';
import type { GenerationMode, WorkerEvent } from './vendor/runtime/protocol';

export type ArdyProgress = (message: string) => void;

export class ArdyCancelled extends Error {
  constructor() {
    super('ARDY generation was cancelled');
    this.name = 'ArdyCancelled';
  }
}

export function isArdyCancelled(error: unknown): boolean {
  return error instanceof ArdyCancelled;
}

export interface ArdyModelLimits {
  fps: number;
  generationFrames: number;
  maxFrames: number;
  historyFrames: number;
}

export interface ArdyGenerateOptions {
  prompt: string;
  mode: Exclude<GenerationMode, 'branch'>;
  durationFrames: number;
  seed: number;
  historyFrames: number;
  onChunk?: (chunk: RuntimeGenerationChunk) => void;
  onProgress?: ArdyProgress;
}

interface Pending {
  terminal: WorkerEvent['type'];
  resolve: (event: WorkerEvent) => void;
  reject: (error: Error) => void;
  onProgress?: ArdyProgress;
  onChunk?: (chunk: RuntimeGenerationChunk) => void;
}

let worker: Worker | null = null;
let ready: Promise<void> | null = null;
let limits: ArdyModelLimits | null = null;
let loadPromise: Promise<ArdyModelLimits> | null = null;
let activeRequestId: string | null = null;
let chain: Promise<unknown> = Promise.resolve();
const pending = new Map<string, Pending>();
let requestSerial = 0;

function nextRequestId(): string {
  requestSerial += 1;
  return `ardy-${requestSerial}`;
}

function failAll(error: Error): void {
  activeRequestId = null;
  for (const entry of pending.values()) entry.reject(error);
  pending.clear();
}

function ensureWorker(): Worker {
  if (worker) return worker;
  const created = new Worker(new URL('./vendor/inference.worker.ts', import.meta.url), { type: 'module' });
  worker = created;
  ready = new Promise<void>((resolve, reject) => {
    const onReady = (event: MessageEvent<WorkerEvent>) => {
      if (event.data?.type !== 'workerReady') return;
      created.removeEventListener('message', onReady);
      resolve();
    };
    created.addEventListener('message', onReady);
    created.addEventListener('error', () => {
      reject(new Error('ARDY worker failed to start'));
    }, { once: true });
  });
  created.addEventListener('message', (event: MessageEvent<WorkerEvent>) => {
    const data = event.data;
    if (!data || typeof data !== 'object' || !('type' in data)) return;
    if (data.type === 'workerReady') return;
    if (data.type === 'cancelled') {
      const target = pending.get(data.targetRequestId);
      if (target) {
        pending.delete(data.targetRequestId);
        if (activeRequestId === data.targetRequestId) activeRequestId = null;
        target.reject(new ArdyCancelled());
      }
      const cancelEntry = pending.get(data.requestId);
      if (cancelEntry) {
        pending.delete(data.requestId);
        cancelEntry.resolve(data);
      }
      return;
    }
    const requestId = 'requestId' in data ? data.requestId : undefined;
    if (!requestId) return;
    const entry = pending.get(requestId);
    if (!entry) return;
    if (data.type === 'progress') {
      const detail = data.message ? ` ${data.message}` : '';
      entry.onProgress?.(`${data.stage} ${data.completed}/${data.total}${detail}`);
      return;
    }
    if (data.type === 'error') {
      pending.delete(requestId);
      if (activeRequestId === requestId) activeRequestId = null;
      entry.reject(new Error(data.error.message));
      return;
    }
    if (data.type === 'generationChunk') {
      entry.onChunk?.(data.chunk);
      return;
    }
    if (data.type !== entry.terminal) return;
    pending.delete(requestId);
    if (activeRequestId === requestId) activeRequestId = null;
    entry.resolve(data);
  });
  created.addEventListener('error', (event) => {
    failAll(new Error(event.message || 'ARDY worker failed'));
  });
  return created;
}

function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const run = chain.then(job, job);
  chain = run.then(() => undefined, () => undefined);
  return run;
}

function request(
  command: Record<string, unknown> & { type: string },
  terminal: WorkerEvent['type'],
  onProgress?: ArdyProgress,
  onChunk?: (chunk: RuntimeGenerationChunk) => void,
): Promise<WorkerEvent> {
  const port = ensureWorker();
  const requestId = nextRequestId();
  if (command.type === 'generate' || command.type === 'loadModel') {
    activeRequestId = requestId;
  }
  return new Promise<WorkerEvent>((resolve, reject) => {
    pending.set(requestId, {
      terminal,
      resolve,
      reject,
      onProgress,
      onChunk,
    });
    void ready?.then(() => {
      if (!pending.has(requestId)) return;
      port.postMessage({ ...command, requestId });
    }).catch((error: unknown) => {
      pending.delete(requestId);
      if (activeRequestId === requestId) activeRequestId = null;
      reject(error instanceof Error ? error : new Error(String(error)));
    });
  });
}

/** Abort the load or generate currently running in the worker. Does not wait. */
export function cancelActiveArdy(): void {
  const targetRequestId = activeRequestId;
  const port = worker;
  if (!targetRequestId || !port) return;
  const requestId = nextRequestId();
  port.postMessage({ type: 'cancel', requestId, targetRequestId });
}

async function loadModel(onProgress?: ArdyProgress): Promise<ArdyModelLimits> {
  await ready;
  const caps = await request({ type: 'getWebGpuCapabilities' }, 'webGpuCapabilities', onProgress);
  if (caps.type !== 'webGpuCapabilities') {
    throw new Error('ARDY WebGPU capabilities were not returned');
  }
  const baseUrl = modelVariantBaseUrl(
    ARDY_MODEL_FAMILY_URL,
    preferredModelVariant(caps.shaderF16),
  );
  const loaded = await request({ type: 'loadModel', baseUrl }, 'modelLoaded', onProgress);
  if (loaded.type !== 'modelLoaded') {
    throw new Error('ARDY model did not finish loading');
  }
  limits = {
    fps: loaded.model.fps,
    generationFrames: loaded.model.generationFrames,
    maxFrames: loaded.model.maxFrames,
    historyFrames: loaded.model.manifest.dimensions.history_frames,
  };
  return limits;
}

export function ensureArdyLoaded(onProgress?: ArdyProgress): Promise<ArdyModelLimits> {
  if (limits) return Promise.resolve(limits);
  if (!loadPromise) {
    loadPromise = loadModel(onProgress).catch((error: unknown) => {
      loadPromise = null;
      throw error;
    });
  }
  return loadPromise;
}

/** Whole windows that fit in one generate. Two windows when the 10s cap allows. */
export function ardyStreamFrameCount(model: ArdyModelLimits): number {
  const window = model.generationFrames;
  const wanted = window * ARDY_STREAM_WINDOWS;
  if (wanted <= model.maxFrames) return wanted;
  const whole = model.maxFrames - (model.maxFrames % window);
  return Math.max(window, whole);
}

export function ardyHistoryFrames(model: ArdyModelLimits): number {
  return Math.min(ARDY_HISTORY_FRAMES, model.historyFrames);
}

/**
 * One generate on the live session. `replace` starts over. `append` continues
 * from the previous window's hybrid tokens. Chunks arrive before the call resolves.
 */
export function generateArdy(options: ArdyGenerateOptions): Promise<RuntimeGenerationResult> {
  const text = options.prompt.trim();
  if (!text) throw new Error('ARDY prompt is empty');
  if (text.length > ARDY_PROMPT_MAX_CHARS) {
    throw new Error(`ARDY prompt is longer than ${ARDY_PROMPT_MAX_CHARS} characters`);
  }
  return enqueue(async () => {
    const done = await request({
      type: 'generate',
      mode: options.mode,
      prompt: text,
      seed: options.seed,
      durationFrames: options.durationFrames,
      historyFrames: options.historyFrames,
    }, 'generationComplete', options.onProgress, options.onChunk);
    if (done.type !== 'generationComplete') {
      throw new Error('ARDY did not return a motion');
    }
    return done.result;
  });
}

export function releaseArdyRuntime(): Promise<void> {
  return enqueue(async () => {
    const current = worker;
    limits = null;
    loadPromise = null;
    activeRequestId = null;
    if (!current) return;
    try {
      await request({ type: 'dispose' }, 'disposed');
    } catch {
      // The session may already be gone. Terminating the worker is the release.
    }
    current.terminate();
    if (worker === current) {
      worker = null;
      ready = null;
    }
  });
}
