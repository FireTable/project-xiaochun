/**
 * sttWorker.ts — SenseVoice Small (int8) Dedicated Web Worker
 *
 * Pattern mirrors src/motion/sources/emageWorker.ts (onnxruntime-web + Cache API).
 *
 * Pipeline (sherpa-onnx sense-voice/test.py):
 *   PCM 16k → log-mel fbank → LFR(7,6) → CMVN(from ONNX meta) → ORT logits → CTC greedy
 *
 * Cache keys (Request URL path style):
 *   xiaochun-stt/v2024-07-17/model.int8.onnx
 *   xiaochun-stt/v2024-07-17/tokens.txt
 *
 * WORKS today: real mic→VAD (main), real download+%+Cache, real ORT session + CTC decode.
 * BLOCKER risk: fbank is a TS port of knf, not bit-exact kaldi_native_fbank — if WER is bad,
 * swap in sherpa-onnx wasm frontend or precomputed CMVN+fbank wasm. Never posts fake text.
 */
import * as ort from 'onnxruntime-web';
import { APP_CONFIG } from '@/config';
import { applyCmvn, applyLfr, computeLogMelFbank } from './fbank';
import { extractOnnxMetadataProps } from './onnxMeta';

const STT = APP_CONFIG.stt;
const ONNX_BASE = STT.base.replace(/\/$/, '');
const CACHE_NAME = STT.cacheName;
const CACHE_PREFIX = STT.cacheKeyPrefix; // e.g. xiaochun-stt/v2024-07-17
const MODEL_FILE = STT.modelFile;
const TOKENS_FILE = STT.tokensFile;
const SAMPLE_RATE = STT.sampleRate;
const WASM_PATHS =
  'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0-dev.20250409-89f8206ba4/dist/';

type WorkerIn =
  | { type: 'load' }
  | { type: 'recognize'; id: number; pcm: Float32Array; sampleRate?: number };

type ProgressPhase = 'download' | 'init' | 'ready';

let session: ort.InferenceSession | null = null;
let tokens: string[] = [];
let negMean: Float32Array | null = null;
let invStddev: Float32Array | null = null;
let lfrWindowSize = 7;
let lfrWindowShift = 6;
let langAuto = 0;
let withItn = 14;
let withoutItn = 15;
let loadPromise: Promise<void> | null = null;
let ready = false;

function post(msg: Record<string, unknown>): void {
  self.postMessage(msg);
}

function cacheUrl(file: string): string {
  // Stable Cache API key independent of CDN host
  return `https://xiaochun.local/${CACHE_PREFIX}/${file}`;
}

function assetUrl(file: string): string {
  return `${ONNX_BASE}/${file}`;
}

async function fetchWithCacheProgress(
  file: string,
  onProgress: (loaded: number, total: number) => void,
): Promise<ArrayBuffer> {
  const key = cacheUrl(file);
  let cache: Cache | null = null;
  try {
    if (typeof caches !== 'undefined') {
      cache = await caches.open(CACHE_NAME);
      const hit = await cache.match(key);
      if (hit) {
        const buf = await hit.arrayBuffer();
        onProgress(buf.byteLength, buf.byteLength);
        return buf;
      }
    }
  } catch (e) {
    console.warn('[STT Worker] CacheStorage open/match failed', e);
  }

  const url = assetUrl(file);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`STT fetch ${url} failed: HTTP ${res.status}`);
  }
  const total = Number(res.headers.get('Content-Length') || 0);
  if (!res.body) {
    const buf = await res.arrayBuffer();
    onProgress(buf.byteLength, total || buf.byteLength);
    if (cache) {
      try {
        await cache.put(key, new Response(buf.slice(0), { headers: res.headers }));
      } catch (e) {
        console.warn('[STT Worker] Cache put failed', e);
      }
    }
    return buf;
  }

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    onProgress(loaded, total || loaded);
  }
  const out = new Uint8Array(loaded);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  if (cache) {
    try {
      await cache.put(
        key,
        new Response(out.slice(), {
          headers: {
            'Content-Type': res.headers.get('Content-Type') || 'application/octet-stream',
            'Content-Length': String(out.byteLength),
          },
        }),
      );
    } catch (e) {
      console.warn('[STT Worker] Cache put failed', e);
    }
  }
  return out.buffer;
}

function parseTokens(text: string): string[] {
  const lines = text.split(/\r?\n/);
  const out: string[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    out.push(line.trim().split(/\s+/)[0]!);
  }
  return out;
}

function parseCsvFloats(s: string): Float32Array {
  const parts = s.split(',');
  const out = new Float32Array(parts.length);
  for (let i = 0; i < parts.length; i++) {
    out[i] = Number(parts[i]);
  }
  return out;
}

function applyMetaMap(map: Record<string, string>): void {
  if (!map.neg_mean || !map.inv_stddev) {
    throw new Error(
      'SenseVoice ONNX missing CMVN metadata (neg_mean/inv_stddev). Use sherpa-onnx sense-voice int8 export.',
    );
  }
  negMean = parseCsvFloats(map.neg_mean);
  invStddev = parseCsvFloats(map.inv_stddev);
  lfrWindowSize = Number(map.lfr_window_size || 7);
  lfrWindowShift = Number(map.lfr_window_shift || 6);
  langAuto = Number(map.lang_auto ?? 0);
  withItn = Number(map.with_itn ?? 14);
  withoutItn = Number(map.without_itn ?? 15);
}

/**
 * ORT-web has no getModelMeta — parse metadata_props from the ONNX bytes (see onnxMeta.ts).
 */
function readMetaFromModelBuffer(modelBuf: ArrayBuffer): void {
  const map = extractOnnxMetadataProps(modelBuf);
  applyMetaMap(map);
}

function ctcGreedyDecode(logits: ort.Tensor, T: number, V: number): string {
  // logits: [1, T, V] float32
  const data = logits.data as Float32Array;
  const ids: number[] = [];
  let prev = -1;
  for (let t = 0; t < T; t++) {
    let best = 0;
    let bestVal = -Infinity;
    const base = t * V;
    for (let v = 0; v < V; v++) {
      const val = data[base + v]!;
      if (val > bestVal) {
        bestVal = val;
        best = v;
      }
    }
    if (best !== 0 && best !== prev) {
      ids.push(best);
    }
    prev = best;
  }
  let text = '';
  for (const id of ids) {
    const tok = tokens[id];
    if (!tok || tok.startsWith('<|')) continue; // drop SenseVoice special tags
    text += tok;
  }
  // Belt-and-suspenders: strip any residual <|...|> (rich_transcription_postprocess)
  return text
    .replace(/<\|[^|>]*\|>/g, '')
    .replace(/▁/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function ensureLoaded(): Promise<void> {
  if (ready) return;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    post({ type: 'progress', phase: 'download' as ProgressPhase, percent: 0, file: MODEL_FILE });

    let modelLoaded = 0;
    let modelTotal = 0;
    let tokensLoaded = 0;
    let tokensTotal = 0;

    const report = () => {
      const total = (modelTotal || 1) + (tokensTotal || 1);
      const loaded = modelLoaded + tokensLoaded;
      const percent = Math.min(99, Math.round((loaded / total) * 100));
      post({
        type: 'progress',
        phase: 'download' as ProgressPhase,
        percent,
        loaded,
        total,
        file: MODEL_FILE,
      });
    };

    const [modelBuf, tokensBuf] = await Promise.all([
      fetchWithCacheProgress(MODEL_FILE, (l, t) => {
        modelLoaded = l;
        modelTotal = t || modelTotal;
        report();
      }),
      fetchWithCacheProgress(TOKENS_FILE, (l, t) => {
        tokensLoaded = l;
        tokensTotal = t || tokensTotal;
        report();
      }),
    ]);

    post({ type: 'progress', phase: 'init' as ProgressPhase, percent: 99 });

    tokens = parseTokens(new TextDecoder().decode(tokensBuf));
    if (tokens.length < 1000) {
      throw new Error(`tokens.txt looks invalid (only ${tokens.length} entries)`);
    }

    ort.env.wasm.wasmPaths = WASM_PATHS;
    const sabOk = typeof SharedArrayBuffer !== 'undefined';
    const hw = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 1;
    ort.env.wasm.numThreads = sabOk ? Math.min(Math.max(1, hw), 4) : 1;
    (ort.env.wasm as { simd?: boolean }).simd = true;

    // Parse CMVN before create() so we fail fast if the wrong ONNX was served.
    readMetaFromModelBuffer(modelBuf);

    // Match emageWorker: buffer load; typings lag runtime (URL-only overload in .d.ts).
    session = await ort.InferenceSession.create(new Uint8Array(modelBuf) as any, {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
    });

    ready = true;
    post({ type: 'progress', phase: 'ready' as ProgressPhase, percent: 100 });
    post({ type: 'ready' });
  })().catch((e) => {
    loadPromise = null;
    ready = false;
    session = null;
    throw e;
  });

  return loadPromise;
}

function resampleLinear(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return input;
  const ratio = fromRate / toRate;
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

async function recognize(id: number, pcmIn: Float32Array, sampleRate: number): Promise<void> {
  try {
    await ensureLoaded();
    if (!session || !negMean || !invStddev) {
      throw new Error('STT session not ready');
    }
    const pcm = resampleLinear(pcmIn, sampleRate, SAMPLE_RATE);
    const minMs = Number(STT.minUtteranceMs ?? 250);
    if (pcm.length < SAMPLE_RATE * (minMs / 1000)) {
      throw new Error('Utterance too short');
    }

    const featDim = 80;
    const fbank = computeLogMelFbank(pcm, { sampleRate: SAMPLE_RATE, numBins: featDim });
    const numFrames = fbank.length / featDim;
    const { data: lfr, frames } = applyLfr(fbank, numFrames, featDim, lfrWindowSize, lfrWindowShift);
    if (frames <= 0) {
      throw new Error('Not enough frames after LFR');
    }
    const dim = featDim * lfrWindowSize;
    const feats = applyCmvn(lfr, frames, dim, negMean, invStddev);

    const x = new ort.Tensor('float32', feats, [1, frames, dim]);
    const xLength = new ort.Tensor('int32', new Int32Array([frames]), [1]);
    const language = new ort.Tensor('int32', new Int32Array([langAuto]), [1]);
    const textNorm = new ort.Tensor(
      'int32',
      new Int32Array([STT.useItn ? withItn : withoutItn]),
      [1],
    );

    // sherpa-onnx SenseVoice export names (fixed)
    const feeds: Record<string, ort.Tensor> = {
      x,
      x_length: xLength,
      language,
      text_norm: textNorm,
    };

    const out = await session.run(feeds);
    const logits = out.logits ?? out[Object.keys(out)[0]!];
    if (!logits) {
      throw new Error('SenseVoice produced no logits');
    }
    // Prefer runtime dims when present; else derive V from tokens length.
    const anyLogits = logits as ort.Tensor & { dims?: readonly number[] };
    const dims = anyLogits.dims;
    const T = Number(dims?.[1] ?? frames);
    const V = Number(dims?.[2] ?? tokens.length);
    const text = ctcGreedyDecode(logits, T, V);
    if (!text) {
      // Real empty decode — not fake filler
      post({ type: 'result', id, text: '', empty: true });
      return;
    }
    post({ type: 'result', id, text });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    post({ type: 'error', id, message });
  }
}

self.onmessage = (ev: MessageEvent<WorkerIn>) => {
  const msg = ev.data;
  if (!msg || typeof msg !== 'object') return;
  if (msg.type === 'load') {
    void ensureLoaded().catch((e) => {
      post({ type: 'error', message: e instanceof Error ? e.message : String(e) });
    });
    return;
  }
  if (msg.type === 'recognize') {
    void recognize(msg.id, msg.pcm, msg.sampleRate ?? SAMPLE_RATE);
  }
};

export {};
