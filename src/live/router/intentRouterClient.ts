/**
 * src/live/router/intentRouterClient.ts
 *
 * Dual-Engine RPC client for Bilingual Intent Classification:
 * - Browser: Dedicated Web Worker with onnxruntime-web/wasm (zero VRAM, zero UI thread stall)
 * - Node / Vitest: In-process ONNX Runtime session fallback for seamless zero-mock test runner compatibility
 * - Fast-path structural guardrails (< 0.05 ms) short-circuit explicit queries before neural dispatch
 * - Satisfies contracts from both PROJECT.md and SCOPE.md: predict(), classify(), probabilities, scores.
 */

import { IntentTokenizer } from './tokenizer';
import {
  evaluateGuardrail,
  buildGuardrailPrediction,
  calibrateNeuralPrediction,
} from './guardrails';
import type {
  IntentManifest,
  IntentPrediction,
  IntentRouterClient,
  IntentRouterClientOptions,
  WorkerInboundPayload,
  WorkerOutboundMsg,
} from './types';

const DEFAULT_MODEL_PATH = 'public/models/intent-router/intent-router-bilingual-v1.int8.onnx';
const DEFAULT_MANIFEST_PATH = 'public/models/intent-router/manifest.json';
const DEFAULT_VOCAB_PATH = 'public/models/intent-router/vocab.json';

interface PendingRpc<T> {
  resolve: (value: T) => void;
  reject: (err: Error) => void;
}

export class IntentRouterClientImpl implements IntentRouterClient {
  private readonly options: IntentRouterClientOptions;
  private worker: Worker | null = null;
  private nextId = 1;
  private pending = new Map<number, PendingRpc<unknown>>();
  private ready = false;
  private initPromise: Promise<void> | null = null;

  // Node fallback state
  private nodeSession: unknown | null = null;
  private nodeTokenizer: IntentTokenizer | null = null;
  private nodeOrt: typeof import('onnxruntime-web') | null = null;
  private nodeTemperature = 1.0;
  private nodeConfidenceThreshold = 0.5;

  constructor(options: Partial<IntentRouterClientOptions> = {}) {
    this.options = options;
  }

  isReady(): boolean {
    if (this.isNode()) {
      return this.ready && this.nodeSession !== null && this.nodeTokenizer !== null;
    }
    return this.ready && this.worker !== null;
  }

  private isNode(): boolean {
    return (
      Boolean(this.options.forceNodeFallback) ||
      typeof window === 'undefined' ||
      typeof Worker === 'undefined'
    );
  }

  async init(options?: Partial<IntentRouterClientOptions>): Promise<void> {
    if (options) {
      Object.assign(this.options, options);
    }
    if (this.ready) return;
    if (this.initPromise) return this.initPromise;

    if (this.isNode()) {
      this.initPromise = this.initNode();
    } else {
      this.initPromise = this.initWorker();
    }

    try {
      await this.initPromise;
      this.ready = true;
    } finally {
      this.initPromise = null;
    }
  }

  private async initWorker(): Promise<void> {
    const worker = new Worker(new URL('./intentRouterWorker.ts', import.meta.url), {
      type: 'module',
    });

    worker.onmessage = (e: MessageEvent<WorkerOutboundMsg>) => {
      const msg = e.data;
      if (!msg) return;
      const call = this.pending.get(msg.id);
      if (!call) return;
      this.pending.delete(msg.id);

      if (msg.type === 'error') {
        call.reject(new Error(msg.message));
      } else if (msg.type === 'prediction') {
        call.resolve(msg.result);
      } else if (msg.type === 'warmed') {
        call.resolve(msg.latencyMs);
      } else {
        call.resolve(undefined);
      }
    };

    worker.onerror = (e) => {
      const err = new Error(e.message || 'IntentRouterWorker error');
      for (const [, call] of this.pending) {
        call.reject(err);
      }
      this.pending.clear();
    };

    this.worker = worker;

    await this.postWorkerRpc({
      type: 'init',
      modelUrl: this.options.modelUrl,
      manifestUrl: this.options.manifestUrl,
      vocabUrl: this.options.vocabUrl,
      wasmPaths: this.options.wasmPaths,
      loopback: this.options.loopback,
      numThreads: this.options.numThreads ?? 1,
      confidenceThreshold: this.options.confidenceThreshold,
    });
  }

  private async initNode(): Promise<void> {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const ort = await import('onnxruntime-web');
    this.nodeOrt = ort;

    // Resolve paths relative to process.cwd() or options
    const cwd = process.cwd();
    const modelFilePath = this.options.modelUrl ?? path.resolve(cwd, DEFAULT_MODEL_PATH);
    const manifestFilePath = this.options.manifestUrl ?? path.resolve(cwd, DEFAULT_MANIFEST_PATH);
    const vocabFilePath = this.options.vocabUrl ?? path.resolve(cwd, DEFAULT_VOCAB_PATH);

    let manifest: IntentManifest | null = null;
    if (fs.existsSync(manifestFilePath)) {
      manifest = JSON.parse(fs.readFileSync(manifestFilePath, 'utf-8')) as IntentManifest;
    }

    if (manifest?.temperature) {
      this.nodeTemperature = manifest.temperature;
    }
    if (this.options.confidenceThreshold != null) {
      this.nodeConfidenceThreshold = this.options.confidenceThreshold;
    } else if (manifest?.confidenceThreshold != null) {
      this.nodeConfidenceThreshold = manifest.confidenceThreshold;
    }

    const vocabJson = JSON.parse(fs.readFileSync(vocabFilePath, 'utf-8')) as Record<string, number>;
    this.nodeTokenizer = new IntentTokenizer(vocabJson, manifest?.maxSeqLen ?? 64);

    const modelBuffer = fs.readFileSync(modelFilePath);
    this.nodeSession = await ort.InferenceSession.create(new Uint8Array(modelBuffer), {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
    });
  }

  private postWorkerRpc<T>(msg: WorkerInboundPayload): Promise<T> {
    if (!this.worker) {
      throw new Error('IntentRouterWorker is not running');
    }
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (val: unknown) => void, reject });
      this.worker!.postMessage({ ...msg, id });
    });
  }

  async predict(text: string): Promise<IntentPrediction> {
    // 1. Fast-path structural guardrails (< 0.05 ms)
    const t0 = performance.now();
    const guardrail = evaluateGuardrail(text);
    if (guardrail) {
      const elapsed = Number((performance.now() - t0).toFixed(3));
      return buildGuardrailPrediction(guardrail, elapsed);
    }

    // 2. Ensure engine initialized
    if (!this.isReady()) {
      await this.init();
    }

    // 3. Delegate to active engine
    if (this.isNode()) {
      return this.predictNode(text);
    }
    return this.postWorkerRpc<IntentPrediction>({ type: 'predict', text });
  }

  private async predictNode(text: string): Promise<IntentPrediction> {
    const ort = this.nodeOrt ?? (await import('onnxruntime-web'));
    const session = this.nodeSession as {
      outputNames: string[];
      run: (feeds: Record<string, unknown>) => Promise<Record<string, { data: Float32Array }>>;
    };
    if (!session || !this.nodeTokenizer) {
      throw new Error('Node ORT session is not ready');
    }

    const encoded = this.nodeTokenizer.encode(text);
    const idsTensor = new ort.Tensor('int64', encoded.input_ids, [1, encoded.input_ids.length]);
    const maskTensor = new ort.Tensor('int64', encoded.attention_mask, [1, encoded.attention_mask.length]);

    const t0 = performance.now();
    const results = await session.run({
      input_ids: idsTensor,
      attention_mask: maskTensor,
    });
    const latencyMs = Number((performance.now() - t0).toFixed(2));

    const outputName = session.outputNames[0] ?? 'logits';
    const logitsData = results[outputName]?.data;
    if (!logitsData) {
      throw new Error(`Output tensor "${outputName}" not found in Node ORT results`);
    }

    const logits: [number, number] = [logitsData[0] ?? 0, logitsData[1] ?? 0];
    return calibrateNeuralPrediction(
      logits,
      this.nodeTemperature,
      this.nodeConfidenceThreshold,
      latencyMs,
    );
  }

  async classify(text: string): Promise<IntentPrediction> {
    return this.predict(text);
  }

  async warmup(): Promise<number> {
    if (!this.isReady()) {
      await this.init();
    }

    const t0 = performance.now();
    if (this.isNode()) {
      await this.predictNode('小春在吗？');
      return Number((performance.now() - t0).toFixed(2));
    }
    return this.postWorkerRpc<number>({ type: 'warmup' });
  }

  dispose(): void {
    if (this.worker) {
      this.worker.postMessage({ type: 'dispose', id: this.nextId++ });
      this.worker.terminate();
      this.worker = null;
    }
    this.nodeSession = null;
    this.nodeTokenizer = null;
    this.nodeOrt = null;
    this.ready = false;
    for (const [, call] of this.pending) {
      call.reject(new Error('IntentRouterClient disposed'));
    }
    this.pending.clear();
  }
}

export function createIntentRouterClient(
  options?: Partial<IntentRouterClientOptions>,
): IntentRouterClient {
  return new IntentRouterClientImpl(options);
}
