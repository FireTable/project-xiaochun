/**
 * src/live/router/intentRouterWorker.ts
 *
 * Dedicated Web Worker for Bilingual Intent Classification:
 * - Powered by onnxruntime-web/wasm (pure CPU WebAssembly with SIMD)
 * - Zero-VRAM guarantee: executionProviders: ['wasm'], absolutely NO WebGPU allocation
 * - Zero SharedArrayBuffer dependency: single-threaded numThreads: 1
 * - Sub-5ms inference latency
 */

import * as ort from 'onnxruntime-web/wasm';
import { resolveOrtWasmPaths } from '@/lib/ortWasm';
import { IntentTokenizer } from './tokenizer';
import { calibrateNeuralPrediction } from './guardrails';
import type {
  IntentManifest,
  IntentPrediction,
  WorkerInboundMsg,
  WorkerOutboundMsg,
} from './types';

const DEFAULT_MODEL_URL = '/models/intent-router/intent-router-bilingual-v1.int8.onnx';
const DEFAULT_MANIFEST_URL = '/models/intent-router/manifest.json';
const DEFAULT_VOCAB_URL = '/models/intent-router/vocab.json';
const CACHE_NAME = 'intent-router-models-v1';

let session: ort.InferenceSession | null = null;
let tokenizer: IntentTokenizer | null = null;
let manifest: IntentManifest | null = null;
let temperature = 1.0;
let confidenceThreshold = 0.5;
let initPromise: Promise<void> | null = null;

async function fetchBufferWithCache(url: string): Promise<ArrayBuffer> {
  if (typeof caches !== 'undefined') {
    try {
      const cache = await caches.open(CACHE_NAME);
      const matched = await cache.match(url);
      if (matched && matched.ok) {
        return await matched.arrayBuffer();
      }
      const resp = await fetch(url);
      if (!resp.ok) {
        throw new Error(`Failed to fetch ${url}: HTTP ${resp.status}`);
      }
      const cloned = resp.clone();
      try {
        await cache.put(url, cloned);
      } catch {
        // Cache quota exceeded or restricted; ignore
      }
      return await resp.arrayBuffer();
    } catch {
      // Fallback to plain fetch if cache API errors
    }
  }

  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`Failed to fetch ${url}: HTTP ${resp.status}`);
  }
  return await resp.arrayBuffer();
}

async function fetchJsonWithCache<T>(url: string): Promise<T> {
  const buf = await fetchBufferWithCache(url);
  const text = new TextDecoder('utf-8').decode(buf);
  return JSON.parse(text) as T;
}

async function initSession(msg: Extract<WorkerInboundMsg, { type: 'init' }>): Promise<void> {
  if (session && tokenizer) return;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const wasmPaths = msg.wasmPaths ?? resolveOrtWasmPaths(Boolean(msg.loopback));
    ort.env.wasm.wasmPaths = wasmPaths;
    ort.env.wasm.numThreads = msg.numThreads ?? 1;
    (ort.env.wasm as { simd?: boolean }).simd = true;

    const manifestUrl = msg.manifestUrl ?? DEFAULT_MANIFEST_URL;
    const modelUrl = msg.modelUrl ?? DEFAULT_MODEL_URL;
    const vocabUrl = msg.vocabUrl ?? DEFAULT_VOCAB_URL;

    const [loadedManifest, loadedVocab, modelBuf] = await Promise.all([
      fetchJsonWithCache<IntentManifest>(manifestUrl).catch(() => null),
      fetchJsonWithCache<Record<string, number>>(vocabUrl),
      fetchBufferWithCache(modelUrl),
    ]);

    manifest = loadedManifest;
    if (manifest?.temperature) {
      temperature = manifest.temperature;
    }
    if (msg.confidenceThreshold != null) {
      confidenceThreshold = msg.confidenceThreshold;
    } else if (manifest?.confidenceThreshold != null) {
      confidenceThreshold = manifest.confidenceThreshold;
    }

    tokenizer = new IntentTokenizer(loadedVocab, manifest?.maxSeqLen ?? 64);

    session = await ort.InferenceSession.create(new Uint8Array(modelBuf), {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
    });
  })();

  try {
    await initPromise;
  } catch (err) {
    initPromise = null;
    session = null;
    tokenizer = null;
    throw err;
  }
}

async function runInference(text: string): Promise<IntentPrediction> {
  if (!session || !tokenizer) {
    throw new Error('IntentRouterWorker session is not initialized');
  }

  const encoded = tokenizer.encode(text);
  const idsTensor = new ort.Tensor('int64', encoded.input_ids, [1, encoded.input_ids.length]);
  const maskTensor = new ort.Tensor('int64', encoded.attention_mask, [1, encoded.attention_mask.length]);

  const feeds: Record<string, ort.Tensor> = {
    input_ids: idsTensor,
    attention_mask: maskTensor,
  };

  const t0 = performance.now();
  const results = await session.run(feeds);
  const latencyMs = Number((performance.now() - t0).toFixed(2));

  const outputName = session.outputNames[0] ?? 'logits';
  const logitsTensor = results[outputName];
  if (!logitsTensor) {
    throw new Error(`Output tensor "${outputName}" not found in results`);
  }

  const logitsData = logitsTensor.data as Float32Array;
  const logits: [number, number] = [logitsData[0] ?? 0, logitsData[1] ?? 0];

  return calibrateNeuralPrediction(logits, temperature, confidenceThreshold, latencyMs);
}

self.onmessage = async (e: MessageEvent<WorkerInboundMsg>) => {
  const msg = e.data;
  if (!msg) return;

  try {
    switch (msg.type) {
      case 'init': {
        await initSession(msg);
        const reply: WorkerOutboundMsg = {
          type: 'ready',
          id: msg.id,
          manifest: manifest ?? {},
        };
        self.postMessage(reply);
        break;
      }

      case 'predict': {
        const pred = await runInference(msg.text);
        const reply: WorkerOutboundMsg = {
          type: 'prediction',
          id: msg.id,
          result: pred,
        };
        self.postMessage(reply);
        break;
      }

      case 'warmup': {
        const t0 = performance.now();
        await runInference('小春在吗？');
        const elapsed = Number((performance.now() - t0).toFixed(2));
        const reply: WorkerOutboundMsg = {
          type: 'warmed',
          id: msg.id,
          latencyMs: elapsed,
        };
        self.postMessage(reply);
        break;
      }

      case 'dispose': {
        session = null;
        tokenizer = null;
        initPromise = null;
        const reply: WorkerOutboundMsg = {
          type: 'disposed',
          id: msg.id,
        };
        self.postMessage(reply);
        break;
      }
    }
  } catch (err: unknown) {
    const errorMsg: WorkerOutboundMsg = {
      type: 'error',
      id: msg.id,
      message: err instanceof Error ? err.message : String(err),
    };
    self.postMessage(errorMsg);
  }
};
