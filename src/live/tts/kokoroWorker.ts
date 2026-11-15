/**
 * kokoroWorker.ts — Dedicated Web Worker for 100% local Kokoro-82M-v1.1-zh ONNX TTS.
 *
 * Uses `onnxruntime-web/wasm` ONLY (never JSEP — 0 MB WebGPU VRAM, respects dropDockerfatAssets).
 * Supports local `/models/kokoro-zh/` artifacts with CacheStorage persistence and automatic
 * HuggingFace / hf-mirror.com fallback.
 */

import * as ort from 'onnxruntime-web/wasm';
import { isLoopbackHost } from '@/lib/loopback';
import { resolveOrtWasmPaths } from '@/lib/ortWasm';
import { textToKokoroTokens } from './kokoroBilingualG2P';
import type { KokoroVoicePreset } from './types';

const KOKORO_CACHE_NAME = 'kokoro-zh-models-v1';
const STYLE_ROWS = 510;
const STYLE_DIM = 256;

const HF_MODEL_FALLBACKS = [
  'https://huggingface.co/onnx-community/Kokoro-82M-v1.1-zh-ONNX/resolve/main/onnx/model_quantized.onnx',
  'https://hf-mirror.com/onnx-community/Kokoro-82M-v1.1-zh-ONNX/resolve/main/onnx/model_quantized.onnx',
];

function voiceFallbackUrls(fileName: string): string[] {
  return [
    `https://huggingface.co/onnx-community/Kokoro-82M-v1.1-zh-ONNX/resolve/main/voices/${fileName}`,
    `https://hf-mirror.com/onnx-community/Kokoro-82M-v1.1-zh-ONNX/resolve/main/voices/${fileName}`,
  ];
}

let loopbackMode = isLoopbackHost();
let modelBaseUrl = '/models/kokoro-zh';
let session: ort.InferenceSession | null = null;
let voices: Record<'zf_001' | 'zf_002' | 'af_maple', Float32Array> | null = null;
let loadPromise: Promise<void> | null = null;
let inferenceChain: Promise<void> = Promise.resolve();
const cancelledRequests = new Set<number>();

async function fetchWithFallbackAndCache(urls: string[]): Promise<ArrayBuffer> {
  let cache: Cache | null = null;
  if (typeof caches !== 'undefined') {
    try {
      cache = await caches.open(KOKORO_CACHE_NAME);
      for (const url of urls) {
        const hit = await cache.match(url);
        if (hit && hit.ok) {
          return await hit.arrayBuffer();
        }
      }
    } catch {
      cache = null;
    }
  }

  let lastErr: unknown = null;
  for (const url of urls) {
    try {
      const res = await fetch(url);
      if (!res.ok) {
        lastErr = new Error(`HTTP ${res.status} for ${url}`);
        continue;
      }
      const cloneForCache = res.clone();
      const buf = await res.arrayBuffer();
      if (buf.byteLength < 1024) {
        lastErr = new Error(`Empty response for ${url}`);
        continue;
      }
      if (cache) {
        void cache.put(url, cloneForCache).catch(() => {});
      }
      return buf;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(`Failed to fetch Kokoro asset: ${urls[0]}`);
}

async function ensureReady(): Promise<void> {
  if (session && voices) return;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    ort.env.wasm.wasmPaths = resolveOrtWasmPaths(loopbackMode);
    const sabOk = typeof SharedArrayBuffer !== 'undefined';
    const hw = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 2;
    ort.env.wasm.numThreads = sabOk ? Math.min(3, Math.max(1, hw)) : 1;
    (ort.env.wasm as any).simd = true;

    const cleanBase = modelBaseUrl.replace(/\/+$/, '');
    const [modelBuf, zf001Buf, afMapleBuf, zf002Buf] = await Promise.all([
      fetchWithFallbackAndCache([`${cleanBase}/model_quantized.onnx`, ...HF_MODEL_FALLBACKS]),
      fetchWithFallbackAndCache([`${cleanBase}/voices/zf_001.bin`, ...voiceFallbackUrls('zf_001.bin')]),
      fetchWithFallbackAndCache([`${cleanBase}/voices/af_maple.bin`, ...voiceFallbackUrls('af_maple.bin')]),
      fetchWithFallbackAndCache([`${cleanBase}/voices/zf_002.bin`, ...voiceFallbackUrls('zf_002.bin')]),
    ]);

    session = await ort.InferenceSession.create(new Uint8Array(modelBuf) as any, {
      executionProviders: ['wasm'],
    });

    voices = {
      zf_001: new Float32Array(zf001Buf),
      af_maple: new Float32Array(afMapleBuf),
      zf_002: new Float32Array(zf002Buf),
    };
  })().catch((err) => {
    loadPromise = null;
    throw err;
  });

  return loadPromise;
}

function buildStyleVector(
  preset: KokoroVoicePreset | string | undefined,
  tokenCount: number,
): Float32Array {
  if (!voices) throw new Error('Voices not loaded');
  const row = Math.min(Math.max(tokenCount - 2, 0), STYLE_ROWS - 1);
  const offset = row * STYLE_DIM;
  const out = new Float32Array(STYLE_DIM);

  if (preset === 'zf_001' || preset === 'zf_002' || preset === 'af_maple') {
    const src = voices[preset];
    for (let i = 0; i < STYLE_DIM; i++) {
      out[i] = src[offset + i] ?? 0;
    }
    return out;
  }

  // Default 'blended': 0.78 * zf_001 + 0.22 * af_maple for natural bilingual ZH+EN timbre
  const zf = voices.zf_001;
  const af = voices.af_maple;
  for (let i = 0; i < STYLE_DIM; i++) {
    out[i] = 0.78 * (zf[offset + i] ?? 0) + 0.22 * (af[offset + i] ?? 0);
  }
  return out;
}

type WorkerIncomingMsg =
  | { type: 'init'; id: number; loopback?: boolean; modelBaseUrl?: string }
  | {
      type: 'synthesize';
      id: number;
      requestId: number;
      text: string;
      speed?: number;
      voicePreset?: string;
      usePhonemizer?: boolean;
    }
  | { type: 'cancel'; requestId: number }
  | { type: 'dispose'; id?: number };

self.addEventListener('message', (ev: MessageEvent<WorkerIncomingMsg>) => {
  const msg = ev.data;
  if (!msg) return;

  if (msg.type === 'cancel') {
    cancelledRequests.add(msg.requestId);
    return;
  }

  if (msg.type === 'dispose') {
    try {
      void session?.release?.();
    } catch {
      /* ignore */
    }
    session = null;
    voices = null;
    loadPromise = null;
    if (msg.id !== undefined) {
      self.postMessage({ type: 'disposed', id: msg.id });
    }
    return;
  }

  if (msg.type === 'init') {
    if (typeof msg.loopback === 'boolean') loopbackMode = msg.loopback;
    if (msg.modelBaseUrl) modelBaseUrl = msg.modelBaseUrl;
    ensureReady()
      .then(() => {
        self.postMessage({ type: 'ready', id: msg.id });
      })
      .catch((err) => {
        self.postMessage({
          type: 'error',
          id: msg.id,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    return;
  }

  if (msg.type === 'synthesize') {
    const runTask = inferenceChain.then(async () => {
      if (cancelledRequests.has(msg.requestId)) {
        cancelledRequests.delete(msg.requestId);
        self.postMessage({ type: 'aborted', id: msg.id, requestId: msg.requestId });
        return;
      }

      const t0 = performance.now();
      await ensureReady();

      if (cancelledRequests.has(msg.requestId)) {
        cancelledRequests.delete(msg.requestId);
        self.postMessage({ type: 'aborted', id: msg.id, requestId: msg.requestId });
        return;
      }

      const tok = await textToKokoroTokens(msg.text, {
        usePhonemizer: msg.usePhonemizer !== false,
      });

      if (tok.tokenIds.length <= 2) {
        const empty = new Float32Array(0);
        self.postMessage(
          {
            type: 'result',
            id: msg.id,
            requestId: msg.requestId,
            pcm24k: empty,
            sampleRate: 24000,
            durationMs: 0,
            ttfaMs: Math.round(performance.now() - t0),
          },
          [empty.buffer],
        );
        return;
      }

      const styleVec = buildStyleVector(msg.voicePreset, tok.tokenIds.length);
      const speed = Math.max(0.5, Math.min(2.0, msg.speed ?? 1.0));

      const outputs = await session!.run({
        input_ids: new ort.Tensor('int64', tok.inputIds, [1, tok.inputIds.length]),
        style: new ort.Tensor('float32', styleVec, [1, STYLE_DIM]),
        speed: new ort.Tensor('float32', Float32Array.from([speed]), [1]),
      });

      if (cancelledRequests.has(msg.requestId)) {
        cancelledRequests.delete(msg.requestId);
        self.postMessage({ type: 'aborted', id: msg.id, requestId: msg.requestId });
        return;
      }

      const waveformTensor = outputs.waveform ?? Object.values(outputs)[0];
      const rawData = waveformTensor?.data as Float32Array | undefined;
      const pcm24k = rawData ? new Float32Array(rawData) : new Float32Array(0);
      const ttfaMs = Math.round(performance.now() - t0);
      const durationMs = Math.round((pcm24k.length / 24000) * 1000);

      self.postMessage(
        {
          type: 'result',
          id: msg.id,
          requestId: msg.requestId,
          pcm24k,
          sampleRate: 24000,
          durationMs,
          ttfaMs,
        },
        [pcm24k.buffer],
      );
    });

    inferenceChain = runTask.catch((err) => {
      cancelledRequests.delete(msg.requestId);
      self.postMessage({
        type: 'error',
        id: msg.id,
        requestId: msg.requestId,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }
});
