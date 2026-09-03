/**
 * emageWorker.ts — EMAGE 动作生成 Dedicated Web Worker
 * 
 * 核心设计目标:
 * 1. 彻底将 7 个 ONNX 模型的密集浮点矩阵乘法从浏览器主线程剥离，主线程 3D 渲染 (Three.js 60 FPS) 绝不卡顿、不掉帧！
 * 2. 结合 CacheStorage API 实现本地磁盘高速持久缓存，二次访问零下载、实现真正的零等待冷启动。
 * 3. 产出的大量 6D 姿态矩阵使用 Transferable ArrayBuffer 零拷贝极速传回主线程。
 */

import * as ort from 'onnxruntime-web';
import { APP_CONFIG } from '@/config';

const WINDOW = 64;
const SEED_FRAMES = 4;
const EFF = WINDOW - SEED_FRAMES;
const FPS = 30;
const SR = 16000;
const SPF = Math.round(SR / FPS);
const WINDOW_AUDIO = WINDOW * SPF;
const MDIM = 337;
const ROT6D_DIM = 330;
const LATENT_DIM = 256;
const CODEBOOK_SIZE = 256;
const GLOBAL_VX = 54;
const GLOBAL_Y = 55;
const GLOBAL_VZ = 56;
// ponytail: 模型文件基础 URL。生产从 R2(绕过 Pages 25 MiB/300 MiB 单文件上限);
// 本地 dev 在 .env.local 设 VITE_EMAGE_BASE=/onnx 即可用 public/onnx 软链。
const ONNX_BASE = APP_CONFIG.emage.base;
const WASM_PATHS = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0-dev.20250409-89f8206ba4/dist/';
const CACHE_NAME = APP_CONFIG.emage.cacheName;

function makeIdentityMotion(): Float32Array {
  const buf = new Float32Array(WINDOW * MDIM);
  for (let t = 0; t < WINDOW; t++) {
    const base = t * MDIM;
    for (let j = 0; j < 55; j++) {
      buf[base + j * 6] = 1.0;
      buf[base + j * 6 + 4] = 1.0;
    }
  }
  return buf;
}
const IDENTITY_MOTION = makeIdentityMotion();

type Sessions = {
  step: ort.InferenceSession;
  vqFace: ort.InferenceSession;
  vqUpper: ort.InferenceSession;
  vqHands: ort.InferenceSession;
  vqLower: ort.InferenceSession;
  vqGlobal: ort.InferenceSession;
  postprocess: ort.InferenceSession;
};

let sessions: Sessions | null = null;
let seed: Float32Array | null = null;
let isReady = false;
let loadPromise: Promise<void> | null = null;

function argmax2d(data: Float32Array, T: number, C: number): BigInt64Array {
  const out = new BigInt64Array(T);
  for (let t = 0; t < T; t++) {
    let best = -Infinity;
    let idx = 0;
    const base = t * C;
    for (let c = 0; c < C; c++) {
      const v = data[base + c]!;
      if (v > best) { best = v; idx = c; }
    }
    out[t] = BigInt(idx);
  }
  return out;
}

function extractRot6d(motionInf: Float32Array, N: number): Float32Array {
  const out = new Float32Array(N * ROT6D_DIM);
  for (let t = 0; t < N; t++) {
    const src = t * MDIM;
    const dst = t * ROT6D_DIM;
    for (let d = 0; d < ROT6D_DIM; d++) out[dst + d] = motionInf[src + d]!;
  }
  return out;
}

function integrateTranslation(globalPred: Float32Array, N: number): Float32Array {
  const trans = new Float32Array(N * 3);
  const dt = 1 / FPS;
  for (let t = 0; t < N; t++) {
    const g = t * 61;
    if (t === 0) {
      trans[1] = globalPred[g + GLOBAL_Y]!;
    } else {
      const p = (t - 1) * 3;
      const pg = (t - 1) * 61;
      trans[t * 3] = globalPred[pg + GLOBAL_VX]! * dt + trans[p]!;
      trans[t * 3 + 1] = globalPred[g + GLOBAL_Y]!;
      trans[t * 3 + 2] = globalPred[pg + GLOBAL_VZ]! * dt + trans[p + 2]!;
    }
  }
  return trans;
}

/**
 * 带有 CacheStorage 磁盘缓存的 ONNX 加载器，实现瞬间离线热冷启动
 */
async function fetchWithCache(url: string): Promise<ArrayBuffer> {
  let cache: Cache | null = null;
  try {
    if (typeof caches !== 'undefined') {
      cache = await caches.open(CACHE_NAME);
      const match = await cache.match(url);
      if (match) {
        return await match.arrayBuffer();
      }
    }
  } catch (e) {
    console.warn('[EMAGE Worker] CacheStorage access failed, fallback to direct fetch', e);
  }

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fetch ${url} failed: HTTP ${res.status}`);

  // 如果支持 CacheStorage，则写入持久化缓存
  if (cache) {
    try {
      await cache.put(url, res.clone());
    } catch (e) {
      console.warn('[EMAGE Worker] Cache put failed', e);
    }
  }
  return await res.arrayBuffer();
}

async function ensureLoaded(onStatus?: (msg: string) => void): Promise<void> {
  if (isReady) return;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    ort.env.wasm.wasmPaths = WASM_PATHS;
    const crossIso = typeof SharedArrayBuffer !== 'undefined';
    ort.env.wasm.numThreads = crossIso ? Math.min(navigator.hardwareConcurrency || 4, 4) : 1;
    onStatus?.(`Worker WASM ${ort.env.wasm.numThreads} 线程就绪，预热动作模型…`);

    const files: { key: keyof Sessions; file: string; label: string }[] = [
      { key: 'step', file: 'emage_step.onnx', label: 'step' },
      { key: 'vqFace', file: 'vq_face.onnx', label: 'vq_face' },
      { key: 'vqUpper', file: 'vq_upper_idx.onnx', label: 'vq_upper' },
      { key: 'vqHands', file: 'vq_hands_idx.onnx', label: 'vq_hands' },
      { key: 'vqLower', file: 'vq_lower_idx.onnx', label: 'vq_lower' },
      { key: 'vqGlobal', file: 'vq_global.onnx', label: 'vq_global' },
      { key: 'postprocess', file: 'postprocess.onnx', label: 'postprocess' },
    ];

    const opts = { executionProviders: ['wasm'] };
    const sess = {} as Sessions;
    const t0 = performance.now();

    for (let i = 0; i < files.length; i++) {
      const m = files[i]!;
      onStatus?.(`[${i + 1}/${files.length}] 加载 ${m.label}…`);
      const url = `${ONNX_BASE}/${m.file}`;
      const buf = await fetchWithCache(url);
      sess[m.key] = await ort.InferenceSession.create(new Uint8Array(buf) as any, opts);
    }

    sessions = sess;
    isReady = true;
    onStatus?.(`EMAGE 后台模型就绪 (${((performance.now() - t0) / 1000).toFixed(1)}s)`);
  })();

  return loadPromise;
}

async function runStep(audio: Float32Array) {
  const s = sessions!;
  const maskedMotion = new Float32Array(WINDOW * MDIM);
  const mask = new Float32Array(WINDOW * MDIM);
  maskedMotion.set(IDENTITY_MOTION);
  mask.fill(1);
  if (seed) {
    maskedMotion.set(seed);
    mask.fill(0, 0, SEED_FRAMES * MDIM);
  }
  const wAudio = new Float32Array(WINDOW_AUDIO);
  wAudio.set(audio.subarray(0, Math.min(audio.length, WINDOW_AUDIO)));

  const out = await s.step.run({
    audio: new ort.Tensor('float32', wAudio, [1, WINDOW_AUDIO]),
    speaker_id: new ort.Tensor('int64', BigInt64Array.from([0n]), [1, 1]),
    masked_motion: new ort.Tensor('float32', maskedMotion, [1, WINDOW, MDIM]),
    mask: new ort.Tensor('float32', mask, [1, WINDOW, MDIM]),
  });

  return {
    recFace: new Float32Array(out.rec_face!.data as Float32Array),
    clsUpper: new Float32Array(out.cls_upper!.data as Float32Array),
    clsHands: new Float32Array(out.cls_hands!.data as Float32Array),
    clsLower: new Float32Array(out.cls_lower!.data as Float32Array),
    seed: new Float32Array(out.seed!.data as Float32Array),
  };
}

async function decode(
  recFace: Float32Array,
  clsUpper: Float32Array,
  clsHands: Float32Array,
  clsLower: Float32Array,
  N: number,
) {
  const s = sessions!;
  // 串行流水线，彻底防止 WASM 共享内存下的 "Session already started" 报错
  const fO = await s.vqFace.run({ latent: new ort.Tensor('float32', recFace, [1, N, LATENT_DIM]) });
  const uO = await s.vqUpper.run({ indices: new ort.Tensor('int64', argmax2d(clsUpper, N, CODEBOOK_SIZE), [1, N]) });
  const hO = await s.vqHands.run({ indices: new ort.Tensor('int64', argmax2d(clsHands, N, CODEBOOK_SIZE), [1, N]) });
  const lO = await s.vqLower.run({ indices: new ort.Tensor('int64', argmax2d(clsLower, N, CODEBOOK_SIZE), [1, N]) });
  const lowerDec = new Float32Array(lO.decoded!.data as Float32Array);

  const pp = await s.postprocess.run({
    face_dec: new ort.Tensor('float32', new Float32Array(fO.decoded!.data as Float32Array), [1, N, 106]),
    upper_dec: new ort.Tensor('float32', new Float32Array(uO.decoded!.data as Float32Array), [1, N, 78]),
    hands_dec: new ort.Tensor('float32', new Float32Array(hO.decoded!.data as Float32Array), [1, N, 180]),
    lower_dec: new ort.Tensor('float32', lowerDec, [1, N, 61]),
  });
  const rot6d = extractRot6d(new Float32Array(pp.motion_inference!.data as Float32Array), N);
  const gO = await s.vqGlobal.run({
    lower_mix: new ort.Tensor('float32', lowerDec, [1, N, 61]),
  });
  return { rot6d, trans: integrateTranslation(new Float32Array(gO.global_pred!.data as Float32Array), N) };
}

function temporalSmooth6D(data: Float32Array, numFrames: number, radius = 7): Float32Array {
  if (radius <= 0 || numFrames <= 3) return data;
  const out = new Float32Array(data.length);
  const stride = ROT6D_DIM;
  const effectiveRadius = Math.min(radius, Math.floor((numFrames - 1) / 2));
  if (effectiveRadius <= 0) return data;

  const sigma = Math.max(1.0, effectiveRadius / 2.0);
  const twoSigmaSq = 2 * sigma * sigma;
  const weights = new Float32Array(2 * effectiveRadius + 1);
  let wSum = 0;
  for (let r = -effectiveRadius; r <= effectiveRadius; r++) {
    const w = Math.exp(-(r * r) / twoSigmaSq);
    weights[r + effectiveRadius] = w;
    wSum += w;
  }
  for (let i = 0; i < weights.length; i++) {
    weights[i] /= wSum;
  }

  for (let t = 0; t < numFrames; t++) {
    const dstOffset = t * stride;
    for (let d = 0; d < stride; d++) {
      let val = 0;
      let norm = 0;
      for (let r = -effectiveRadius; r <= effectiveRadius; r++) {
        const srcT = t + r;
        if (srcT >= 0 && srcT < numFrames) {
          const w = weights[r + effectiveRadius]!;
          val += data[srcT * stride + d]! * w;
          norm += w;
        }
      }
      out[dstOffset + d] = norm > 0 ? val / norm : data[dstOffset + d]!;
    }
  }
  return out;
}

// ─── Worker 消息路由监听 ───
self.onmessage = async (e: MessageEvent) => {
  const { id, type, pcm, temporalSmoothRadius } = e.data;

  if (type === 'init') {
    try {
      await ensureLoaded((msg) => {
        self.postMessage({ id, type: 'progress', message: msg });
      });
      self.postMessage({ id, type: 'ready' });
    } catch (err: any) {
      self.postMessage({ id, type: 'error', error: err?.message || String(err) });
    }
    return;
  }

  if (type === 'generate') {
    try {
      await ensureLoaded();
      if (!sessions) throw new Error('EMAGE 引擎未能成功就绪');

      seed = null;
      const totalFrames = Math.max(1, Math.floor(pcm.length / SPF));
      const numWindows = Math.max(1, Math.ceil((totalFrames - SEED_FRAMES) / EFF));
      const N = totalFrames;

      const faceBuf = new Float32Array(N * LATENT_DIM);
      const upperBuf = new Float32Array(N * CODEBOOK_SIZE);
      const handsBuf = new Float32Array(N * CODEBOOK_SIZE);
      const lowerBuf = new Float32Array(N * CODEBOOK_SIZE);
      let writeOff = 0;

      for (let w = 0; w < numWindows; w++) {
        self.postMessage({ id, type: 'progress', message: `窗口 ${w + 1}/${numWindows}` });
        const startSample = w * EFF * SPF;
        const wAudio = pcm.subarray(startSample, Math.min(startSample + WINDOW_AUDIO, pcm.length));
        const r = await runStep(wAudio);
        seed = r.seed;
        const keep = w === numWindows - 1 ? WINDOW : EFF;
        const actual = Math.min(keep, N - writeOff);
        faceBuf.set(r.recFace.subarray(0, actual * LATENT_DIM), writeOff * LATENT_DIM);
        upperBuf.set(r.clsUpper.subarray(0, actual * CODEBOOK_SIZE), writeOff * CODEBOOK_SIZE);
        handsBuf.set(r.clsHands.subarray(0, actual * CODEBOOK_SIZE), writeOff * CODEBOOK_SIZE);
        lowerBuf.set(r.clsLower.subarray(0, actual * CODEBOOK_SIZE), writeOff * CODEBOOK_SIZE);
        writeOff += actual;
      }

      self.postMessage({ id, type: 'progress', message: '解码中…' });
      const result = await decode(faceBuf, upperBuf, handsBuf, lowerBuf, N);

      self.postMessage({ id, type: 'progress', message: '时序轨迹平滑去抖…' });
      const smoothedRot6d = temporalSmooth6D(result.rot6d, N, temporalSmoothRadius ?? 7);

      const duration = pcm.length / SR;

      // 使用 Transferable Objects (零拷贝传输)，主线程纳秒级接收
      (self as any).postMessage(
        {
          id,
          type: 'success',
          rot6d: smoothedRot6d,
          trans: result.trans,
          frameCount: N,
          duration,
          fps: FPS,
        },
        [smoothedRot6d.buffer, result.trans.buffer]
      );
    } catch (err: any) {
      console.error('[EMAGE Worker] Error:', err);
      self.postMessage({ id, type: 'error', error: err?.message || String(err) });
    }
  }
};
