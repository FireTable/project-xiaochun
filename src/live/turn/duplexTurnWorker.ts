/**
 * duplexTurnWorker.ts — Dedicated Web Worker for Layer 1B Bilingual Full-Duplex
 * Acoustic Turn & Backchannel Prediction (0 MB WebGPU VRAM; CPU WASM SIMD only).
 *
 * Uses `onnxruntime-web/wasm` (NOT JSEP) to stay under Cloudflare Pages 25 MiB limit
 * per `vite/dropDockerfatAssets.ts` and `src/lib/ortWasm.ts`.
 */

import * as ort from 'onnxruntime-web/wasm';
import { resolveOrtWasmPaths } from '@/lib/ortWasm';
import {
  DUPLEX_TURN_CLASSES,
  type DuplexTurnClass,
  type DuplexTurnManifest,
  type DuplexTurnPrediction,
  type DuplexTurnProbs,
} from './types';
import {
  WHISPER_N_FRAMES,
  WHISPER_N_MELS,
  WhisperMel80Extractor,
} from './whisperMel80';

const DEFAULT_MODEL_URL = '/models/duplex-turn/duplex-turn-zh-en-v1.int8.onnx';
const DEFAULT_MANIFEST_URL = '/models/duplex-turn/manifest.json';
const CACHE_NAME = 'duplex-turn-models-v1';

interface WorkerInitMsg {
  type: 'init';
  id: number;
  modelUrl?: string;
  manifestUrl?: string;
  wasmPaths?: string;
  loopback?: boolean;
  numThreads?: number;
  temperature?: number;
}

interface WorkerPredictMsg {
  type: 'predict';
  id: number;
  pcm16k: Float32Array;
}

interface WorkerWarmupMsg {
  type: 'warmup';
  id: number;
}

interface WorkerDisposeMsg {
  type: 'dispose';
  id: number;
}

type WorkerInboundMsg =
  | WorkerInitMsg
  | WorkerPredictMsg
  | WorkerWarmupMsg
  | WorkerDisposeMsg;

let session: ort.InferenceSession | null = null;
let initPromise: Promise<void> | null = null;
let temperature = 1.0;
let inputName = 'input_features';
let outputName = 'logits';
const melExtractor = new WhisperMel80Extractor();

function applyTemperatureSoftmax(logits: Float32Array, temp: number): {
  label: DuplexTurnClass;
  probs: DuplexTurnProbs;
  confidence: number;
} {
  const safeT = temp > 1e-4 ? temp : 1.0;
  let maxScaled = -Infinity;
  const scaled = [0, 0, 0, 0];
  for (let i = 0; i < 4; i++) {
    const v = (logits[i] ?? 0) / safeT;
    scaled[i] = v;
    if (v > maxScaled) maxScaled = v;
  }

  let sumExp = 0;
  const exps = [0, 0, 0, 0];
  for (let i = 0; i < 4; i++) {
    const e = Math.exp(scaled[i]! - maxScaled);
    exps[i] = e;
    sumExp += e;
  }

  const invSum = sumExp > 0 ? 1 / sumExp : 0.25;
  const probs: DuplexTurnProbs = {
    COMPLETE: exps[0]! * invSum,
    INCOMPLETE: exps[1]! * invSum,
    BACKCHANNEL: exps[2]! * invSum,
    WAIT_INTERRUPT: exps[3]! * invSum,
  };

  let bestIdx = 0;
  let bestProb = -1;
  for (let i = 0; i < 4; i++) {
    const cls = DUPLEX_TURN_CLASSES[i]!;
    const p = probs[cls];
    if (p > bestProb) {
      bestProb = p;
      bestIdx = i;
    }
  }

  return {
    label: DUPLEX_TURN_CLASSES[bestIdx]!,
    probs,
    confidence: bestProb,
  };
}

async function fetchBufferWithCache(url: string): Promise<ArrayBuffer> {
  if (typeof caches !== 'undefined') {
    try {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(url);
      if (cached && cached.ok) {
        return await cached.arrayBuffer();
      }
      const resp = await fetch(url);
      if (!resp.ok) {
        throw new Error(`Failed to fetch ${url}: HTTP ${resp.status}`);
      }
      const copy = resp.clone();
      await cache.put(url, copy).catch(() => undefined);
      return await resp.arrayBuffer();
    } catch {
      // Fallback to direct fetch when CacheStorage is restricted
    }
  }
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`Failed to fetch ${url}: HTTP ${resp.status}`);
  }
  return await resp.arrayBuffer();
}

async function loadManifestTemperature(manifestUrl: string): Promise<number | null> {
  try {
    const resp = await fetch(manifestUrl);
    if (!resp.ok) return null;
    const data = (await resp.json()) as Partial<DuplexTurnManifest>;
    if (typeof data.temperature === 'number' && Number.isFinite(data.temperature) && data.temperature > 0) {
      return data.temperature;
    }
  } catch {
    // Manifest optional if temperature explicitly overridden
  }
  return null;
}

async function initSession(msg: WorkerInitMsg): Promise<void> {
  if (session) return;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const wasmPaths = msg.wasmPaths ?? resolveOrtWasmPaths(Boolean(msg.loopback));
    ort.env.wasm.wasmPaths = wasmPaths;

    const sabOk =
      typeof SharedArrayBuffer !== 'undefined' &&
      Boolean((self as unknown as { crossOriginIsolated?: boolean }).crossOriginIsolated);
    const hw = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 2;
    const requested = msg.numThreads ?? Math.min(2, Math.max(1, hw));
    ort.env.wasm.numThreads = sabOk ? Math.min(2, Math.max(1, requested)) : 1;
    (ort.env.wasm as { simd?: boolean }).simd = true;

    const manifestUrl = msg.manifestUrl ?? DEFAULT_MANIFEST_URL;
    const modelUrl = msg.modelUrl ?? DEFAULT_MODEL_URL;

    const [manifestTemp, modelBuf] = await Promise.all([
      msg.temperature != null ? Promise.resolve(msg.temperature) : loadManifestTemperature(manifestUrl),
      fetchBufferWithCache(modelUrl),
    ]);
    if (manifestTemp != null) {
      temperature = manifestTemp;
    }

    session = await ort.InferenceSession.create(new Uint8Array(modelBuf), {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
    });

    if (session.inputNames.length > 0) {
      inputName = session.inputNames[0]!;
    }
    if (session.outputNames.length > 0) {
      outputName = session.outputNames[0]!;
    }
  })();

  try {
    await initPromise;
  } catch (err) {
    initPromise = null;
    throw err;
  }
}

async function runPredict(pcm16k: Float32Array): Promise<DuplexTurnPrediction> {
  if (!session) {
    throw new Error('DuplexTurnWorker not initialized');
  }
  const t0 = performance.now();
  const mel = melExtractor.extract(pcm16k);
  const inputTensor = new ort.Tensor('float32', mel, [1, WHISPER_N_MELS, WHISPER_N_FRAMES]);
  const outputs = await session.run({ [inputName]: inputTensor });
  const outTensor = outputs[outputName] ?? Object.values(outputs)[0];
  if (!outTensor) {
    throw new Error('DuplexTurnWorker produced no output tensor');
  }
  const logits = outTensor.data as Float32Array;
  const { label, probs, confidence } = applyTemperatureSoftmax(logits, temperature);
  const inferMs = Number((performance.now() - t0).toFixed(2));
  return {
    label,
    probs,
    confidence,
    inferMs,
    backend: 'wasm-simd',
  };
}

self.onmessage = async (ev: MessageEvent<WorkerInboundMsg>) => {
  const msg = ev.data;
  try {
    if (msg.type === 'init') {
      await initSession(msg);
      self.postMessage({ type: 'ready', id: msg.id, temperature });
      return;
    }

    if (msg.type === 'warmup') {
      if (!session) {
        throw new Error('DuplexTurnWorker warmup called before init');
      }
      const silent = new Float32Array(16000);
      const pred = await runPredict(silent);
      self.postMessage({ type: 'warmed', id: msg.id, inferMs: pred.inferMs });
      return;
    }

    if (msg.type === 'predict') {
      const result = await runPredict(msg.pcm16k);
      self.postMessage({ type: 'prediction', id: msg.id, result });
      return;
    }

    if (msg.type === 'dispose') {
      const s = session;
      session = null;
      initPromise = null;
      if (s && typeof (s as { release?: () => Promise<void> }).release === 'function') {
        await (s as { release: () => Promise<void> }).release();
      }
      self.postMessage({ type: 'disposed', id: msg.id });
    }
  } catch (err) {
    self.postMessage({
      type: 'error',
      id: msg.id,
      message: err instanceof Error ? err.message : String(err),
    });
  }
};
