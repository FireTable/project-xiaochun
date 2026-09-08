/**
 * emageWorker.ts — EMAGE 动作生成 Dedicated Web Worker
 * 
 * 核心设计目标:
 * 1. 彻底将 7 个 ONNX 模型的密集浮点矩阵乘法从浏览器主线程剥离，主线程 3D 渲染 (Three.js 60 FPS) 绝不卡顿、不掉帧！
 * 2. 结合 CacheStorage API 实现本地磁盘高速持久缓存，二次访问零下载、实现真正的零等待冷启动。
 * 3. 产出的大量 6D 姿态矩阵使用 Transferable ArrayBuffer 零拷贝极速传回主线程。
 * 
 * 核心升级（真正无尽自回归长会话流式架构）:
 * 1. 会话在整场回答期间长驻，跨切片绝不重置 streamNFrames 和特征缓冲，自回归 seed 物理级自然滚动延续[cite: 13]。
 * 2. 窗口边推断边保留特征历史，解码时利用滑动窗口因果上下文做平滑，消灭段落接缝抖动[cite: 13]。
 * 3. 支持 feed_audio_checkpoint 增量结算当前段落切片动作，保留全局上下文，长流不关闭[cite: 13]。
 * 4. 音频与姿态双种子回滚保护：切片结算时保留末尾 4 帧历史 PCM，保证模型输入端声画时序相位绝对锁定[cite: 13]！
 * 5. 跨切片平滑重叠卷绕（Overlap Convolution）：增量结算时借用历史尾帧参与高斯滤波，根除切片接缝处滤波导数塌陷[cite: 13]！
 * 6. Top-K 多样性动作采样：消除确定性贪心解码，让同一段话每次手势动作自然多变，生动灵动！
 */

import * as ort from 'onnxruntime-web';
import { APP_CONFIG } from '@/config';

const WINDOW = 64;
const SEED_FRAMES = 4;
const EFF = WINDOW - SEED_FRAMES;
/** E2: PCM hop per step (frames). Baseline = EFF (60). Max = WINDOW (64) to avoid audio gaps; motion stretched take→hop. */
let ADVANCE_FRAMES = EFF;
const FPS = 30;
const SR = 16000;
const SPF = Math.round(SR / FPS);
const WINDOW_AUDIO = WINDOW * SPF;
const SEED_AUDIO = SEED_FRAMES * SPF; // 4 帧姿态对应的历史音频采样数 (4 * 533 = 2132 采样点)[cite: 13]
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

function postStageProfile(
  id: number,
  enabled: boolean,
  stage: string,
  startedAt: number,
  extra: Record<string, number> = {},
): void {
  if (!enabled) return;
  self.postMessage({
    id,
    type: 'stage_profile',
    stage,
    elapsedMs: Number((performance.now() - startedAt).toFixed(1)),
    ...extra,
  });
}

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
  // ponytail: vqFace 可选 — config.ts 关掉就不加载。decode() 里以 if (s.vqFace) 守护并传全零 106 维，防止崩溃。
  vqFace?: ort.InferenceSession;
  vqUpper: ort.InferenceSession;
  vqHands: ort.InferenceSession;
  vqLower: ort.InferenceSession;
  // ponytail: vqGlobal 可选 — config.ts 关掉就不加载。decode() 里 if (s.vqGlobal) 守护。
  vqGlobal?: ort.InferenceSession;
  postprocess: ort.InferenceSession;
};

let sessions: Sessions | null = null;
let seed: Float32Array | null = null;
let isReady = false;
let loadPromise: Promise<void> | null = null;

// ponytail: 流式会话状态 — feed_audio_start 置位,end/abort 清零。
// 在无限自回归长会话模式下，整场回答期间状态长驻，跨切片绝不中途清零！[cite: 13]
let streamActive = false;
let streamId: number | null = null;
let streamProfileStages = false;
let streamBuffer: Float32Array = new Float32Array(0);
let streamWindowsProcessed = 0;
const streamFace: Float32Array[] = [];
const streamUpper: Float32Array[] = [];
const streamHands: Float32Array[] = [];
const streamLower: Float32Array[] = [];
let streamNFrames = 0;
// 特征数组的绝对起始帧；checkpoint 成功后会丢弃更早的历史。
let streamBaseFrame = 0;

// 已解码并向主线程交付的帧计数游标（用于 checkpoint 增量切片结算）[cite: 13]
let decodedFrameCursor = 0;

// P0a: 每窗 runStep 成功后立即 decode 末尾并 post motion_chunk；默认开，便于回滚
let streamEmitPerWindow = true;
// P0a: checkpoint / motion_chunk 的平滑半径由 feed_audio_start 写入
let streamSmoothRadius = 7;

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

/**
 * 带温度与 Top-k 的动作采样器（赋予手臂与双手自然灵动的多样性，告别千篇一律）
 */
function sampleIndices2d(
  data: Float32Array,
  T: number,
  C: number,
  temperature = 1.5,
  topK = 10
): BigInt64Array {
  const out = new BigInt64Array(T);
  const poolCap = Math.min(topK, C);
  const candidates: { idx: number; val: number }[] = Array.from({ length: poolCap }, () => ({ idx: 0, val: -Infinity }));

  for (let t = 0; t < T; t++) {
    const base = t * C;
    for (let i = 0; i < poolCap; i++) {
      candidates[i]!.idx = 0;
      candidates[i]!.val = -Infinity;
    }

    // 取 Top-K
    for (let c = 0; c < C; c++) {
      const val = data[base + c]!;
      if (val > candidates[poolCap - 1]!.val) {
        candidates[poolCap - 1]!.idx = c;
        candidates[poolCap - 1]!.val = val;
        for (let k = poolCap - 1; k > 0; k--) {
          if (candidates[k]!.val > candidates[k - 1]!.val) {
            const tmp = candidates[k]!;
            candidates[k] = candidates[k - 1]!;
            candidates[k - 1] = tmp;
          } else {
            break;
          }
        }
      }
    }

    // Gumbel 扰动采样: logit / T - log(-log(U))
    let bestScore = -Infinity;
    let chosen = candidates[0]!.idx;
    for (let i = 0; i < poolCap; i++) {
      const u = Math.max(1e-6, Math.random());
      const gumbel = -Math.log(-Math.log(u));
      const score = candidates[i]!.val / temperature + gumbel;
      if (score > bestScore) {
        bestScore = score;
        chosen = candidates[i]!.idx;
      }
    }

    out[t] = BigInt(chosen);
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

/**
 * ponytail: 把流式会话中累积的窗口特征串成一个连续 buffer — 只在 feed_audio_end 调用一次。
 */
function concatFloat32(chunks: Float32Array[], totalLen: number): Float32Array {
  const out = new Float32Array(totalLen);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

/**
 * 丢弃已交付且不再属于高斯 overlap 的特征帧。数组仍按窗口分块，
 * 因而只复制一个有界的 checkpoint 上下文，而不是每次拼接整场历史。
 */
function trimStreamHistory(keepFromFrame: number): void {
  let remaining = keepFromFrame - streamBaseFrame;
  if (remaining <= 0) return;

  while (remaining > 0 && streamFace.length > 0) {
    const firstFrames = streamFace[0]!.length / LATENT_DIM;
    const trimFrames = Math.min(remaining, firstFrames);
    if (trimFrames === firstFrames) {
      streamFace.shift();
      streamUpper.shift();
      streamHands.shift();
      streamLower.shift();
    } else {
      streamFace[0] = streamFace[0]!.subarray(trimFrames * LATENT_DIM);
      streamUpper[0] = streamUpper[0]!.subarray(trimFrames * CODEBOOK_SIZE);
      streamHands[0] = streamHands[0]!.subarray(trimFrames * CODEBOOK_SIZE);
      streamLower[0] = streamLower[0]!.subarray(trimFrames * CODEBOOK_SIZE);
    }
    streamBaseFrame += trimFrames;
    remaining -= trimFrames;
  }
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
    // P0b: SAB only exists under COOP/COEP isolation; log env so FINAL_TEST can verify threads>1 on phone.
    const sabOk = typeof SharedArrayBuffer !== 'undefined';
    const isolated = typeof self !== 'undefined' && !!(self as unknown as { crossOriginIsolated?: boolean }).crossOriginIsolated;
    const hw = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 1;
    // Cap at 4: enough for ORT wasm; leaves headroom for WebLLM / main-thread render on phones.
    const numThreads = sabOk ? Math.min(Math.max(1, hw), 4) : 1;
    ort.env.wasm.numThreads = numThreads;
    // simd defaults on modern builds; set explicitly so profile logs are unambiguous.
    (ort.env.wasm as any).simd = true;
    onStatus?.(
      `Worker WASM threads=${numThreads} (hw=${hw}, isolated=${isolated}, sab=${sabOk})，预热动作模型…`,
    );
    self.postMessage({
      type: 'wasm_env',
      numThreads,
      hardwareConcurrency: hw,
      crossOriginIsolated: isolated,
      sharedArrayBuffer: sabOk,
      simd: true,
    });

    const allModels = APP_CONFIG.emage.models as unknown as Record<string, { file: string; enabled: boolean; label: string }>;
    const files: { key: keyof Sessions; file: string; label: string }[] = (
      Object.entries(allModels) as [keyof Sessions, { file: string; enabled: boolean; label: string }][]
    )
      .filter(([, m]) => m.enabled)
      .map(([key, m]) => ({ key, file: m.file, label: m.label }));

    const sess = {} as Sessions;
    const t0 = performance.now();

    for (let i = 0; i < files.length; i++) {
      const m = files[i]!;
      onStatus?.(`[${i + 1}/${files.length}] 加载 ${m.label}…`);
      const cleanBase = ONNX_BASE.replace(/\/+$/, '');
      const url = `${cleanBase}/${m.file}`;
      const buf = await fetchWithCache(url);
      sess[m.key] = await ort.InferenceSession.create(new Uint8Array(buf) as any, {
        executionProviders: ['wasm'],
      });
    }

    sessions = sess;
    isReady = true;
    onStatus?.(`EMAGE 后台模型就绪 (${((performance.now() - t0) / 1000).toFixed(1)}s)`);
  })();

  return loadPromise;
}

// P0b: reuse step scratch across windows — avoids ~WINDOW*MDIM*2 + WINDOW_AUDIO allocs per step.
const STEP_MASKED = new Float32Array(WINDOW * MDIM);
const STEP_MASK = new Float32Array(WINDOW * MDIM);
const STEP_AUDIO = new Float32Array(WINDOW_AUDIO);
const STEP_SPEAKER = BigInt64Array.from([0n]);

async function runStep(audio: Float32Array) {
  const s = sessions!;
  const maskedMotion = STEP_MASKED;
  const mask = STEP_MASK;
  maskedMotion.set(IDENTITY_MOTION);
  mask.fill(1);
  if (seed) {
    maskedMotion.set(seed);
    mask.fill(0, 0, SEED_FRAMES * MDIM);
  }
  const wAudio = STEP_AUDIO;
  wAudio.fill(0);
  wAudio.set(audio.subarray(0, Math.min(audio.length, WINDOW_AUDIO)));

  const out = await s.step.run({
    audio: new ort.Tensor('float32', wAudio, [1, WINDOW_AUDIO]),
    speaker_id: new ort.Tensor('int64', STEP_SPEAKER, [1, 1]),
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

  let faceDec: Float32Array;
  if (s.vqFace) {
    const fO = await s.vqFace.run({ latent: new ort.Tensor('float32', recFace, [1, N, LATENT_DIM]) });
    faceDec = new Float32Array(fO.decoded!.data as Float32Array);
  } else {
    faceDec = new Float32Array(N * 106);
  }

  // 上半身与手部采用 Top-K 随机采样（自然生动），下半身采用确定性 argmax2d（保持站姿稳固不滑步）
  const vqTemp = APP_CONFIG.emage.motion.vqSampleTemperature;
  const vqTopK = APP_CONFIG.emage.motion.vqSampleTopK;
  const uO = await s.vqUpper.run({ indices: new ort.Tensor('int64', sampleIndices2d(clsUpper, N, CODEBOOK_SIZE, vqTemp, vqTopK), [1, N]) });
  const hO = await s.vqHands.run({ indices: new ort.Tensor('int64', sampleIndices2d(clsHands, N, CODEBOOK_SIZE, vqTemp, vqTopK), [1, N]) });
  const lO = await s.vqLower.run({ indices: new ort.Tensor('int64', argmax2d(clsLower, N, CODEBOOK_SIZE), [1, N]) });
  const lowerDec = new Float32Array(lO.decoded!.data as Float32Array);

  const pp = await s.postprocess.run({
    face_dec: new ort.Tensor('float32', faceDec, [1, N, 106]),
    upper_dec: new ort.Tensor('float32', new Float32Array(uO.decoded!.data as Float32Array), [1, N, 78]),
    hands_dec: new ort.Tensor('float32', new Float32Array(hO.decoded!.data as Float32Array), [1, N, 180]),
    lower_dec: new ort.Tensor('float32', lowerDec, [1, N, 61]),
  });
  const rot6d = extractRot6d(new Float32Array(pp.motion_inference!.data as Float32Array), N);

  let trans: Float32Array;
  if (s.vqGlobal) {
    const gO = await s.vqGlobal.run({
      lower_mix: new ort.Tensor('float32', lowerDec, [1, N, 61]),
    });
    trans = integrateTranslation(new Float32Array(gO.global_pred!.data as Float32Array), N);
  } else {
    trans = new Float32Array(N * 3);
  }
  return { rot6d, trans };
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

/** E2: stretch rot6d/trans from srcFrames → dstFrames (linear in frame space). */
function stretchMotionFeatures(
  rot6d: Float32Array,
  trans: Float32Array,
  srcFrames: number,
  dstFrames: number,
): { rot6d: Float32Array; trans: Float32Array; frameCount: number; duration: number } {
  if (dstFrames <= srcFrames || srcFrames <= 0) {
    return {
      rot6d,
      trans,
      frameCount: srcFrames,
      duration: srcFrames / FPS,
    };
  }
  const outR = new Float32Array(dstFrames * ROT6D_DIM);
  const outT = new Float32Array(dstFrames * 3);
  const denom = Math.max(1, dstFrames - 1);
  for (let i = 0; i < dstFrames; i++) {
    const src = (i / denom) * (srcFrames - 1);
    const f0 = Math.floor(src);
    const f1 = Math.min(srcFrames - 1, f0 + 1);
    const a = src - f0;
    const o0 = f0 * ROT6D_DIM;
    const o1 = f1 * ROT6D_DIM;
    const d = i * ROT6D_DIM;
    for (let k = 0; k < ROT6D_DIM; k++) {
      outR[d + k] = rot6d[o0 + k]! * (1 - a) + rot6d[o1 + k]! * a;
    }
    const t0 = f0 * 3;
    const t1 = f1 * 3;
    const td = i * 3;
    for (let k = 0; k < 3; k++) {
      outT[td + k] = trans[t0 + k]! * (1 - a) + trans[t1 + k]! * a;
    }
  }
  return { rot6d: outR, trans: outT, frameCount: dstFrames, duration: dstFrames / FPS };
}

/**
 * 局部增量解码（重叠卷绕因果上下文修复版）：
 * 从 decodedFrameCursor 解码到当前 streamNFrames[cite: 13]。
 * 关键优化：向前多包含 overlap 帧历史特征一同参与高斯滤波，计算完成后剔除前导历史，
 * 保证切片交界处的滤波二阶导数连续，彻底消灭段落接缝顿挫[cite: 13]！
 */
async function decodeRange(fromFrame: number, toFrame: number, temporalSmoothRadius = 7) {
  const count = toFrame - fromFrame;
  if (count <= 0) return null;

  // 向前借调至多 radius * 2 帧历史作为滤波预热卷积核
  const overlap = Math.min(fromFrame, temporalSmoothRadius * 2);
  const actualStart = fromFrame - overlap;
  const actualCount = toFrame - actualStart;

  if (actualStart < streamBaseFrame) {
    throw new Error(`Checkpoint history unavailable: need frame ${actualStart}, have ${streamBaseFrame}`);
  }
  const historyFrames = streamNFrames - streamBaseFrame;
  const fullFace = concatFloat32(streamFace, historyFrames * LATENT_DIM);
  const fullUpper = concatFloat32(streamUpper, historyFrames * CODEBOOK_SIZE);
  const fullHands = concatFloat32(streamHands, historyFrames * CODEBOOK_SIZE);
  const fullLower = concatFloat32(streamLower, historyFrames * CODEBOOK_SIZE);

  const localStart = actualStart - streamBaseFrame;
  const localEnd = toFrame - streamBaseFrame;
  const subFace = fullFace.subarray(localStart * LATENT_DIM, localEnd * LATENT_DIM);
  const subUpper = fullUpper.subarray(localStart * CODEBOOK_SIZE, localEnd * CODEBOOK_SIZE);
  const subHands = fullHands.subarray(localStart * CODEBOOK_SIZE, localEnd * CODEBOOK_SIZE);
  const subLower = fullLower.subarray(localStart * CODEBOOK_SIZE, localEnd * CODEBOOK_SIZE);

  const result = await decode(subFace, subUpper, subHands, subLower, actualCount);
  const smoothedRot6d = temporalSmooth6D(result.rot6d, actualCount, temporalSmoothRadius);

  // 截除前导 overlap 帧，仅向主线程返回干净的新增切片
  // ponytail: 用 subarray 视图共享 buffer,postMessage transferable 会保留 byteOffset,
  // 省掉 (actualCount - overlap) * ROT6D_DIM floats × 4 bytes 的 alloc + copy。[cite: 13]
  const cleanRot6d = (overlap > 0)
    ? smoothedRot6d.subarray(overlap * ROT6D_DIM)
    : smoothedRot6d;

  const cleanTrans = (overlap > 0)
    ? result.trans.subarray(overlap * 3)
    : result.trans;

  return {
    rot6d: cleanRot6d,
    trans: cleanTrans,
    frameCount: count,
    duration: count / FPS,
    fps: FPS,
  };
}

// ─── Worker 消息路由监听 ───
self.onmessage = async (e: MessageEvent) => {
  const { id, type, pcm, temporalSmoothRadius, continueFromPrevious, profileStages } = e.data;

  if (type === 'reset') {
    seed = null;
    streamActive = false;
    streamId = null;
    streamProfileStages = false;
    streamBuffer = new Float32Array(0);
    streamWindowsProcessed = 0;
    streamNFrames = 0;
    streamBaseFrame = 0;
    decodedFrameCursor = 0;
    streamEmitPerWindow = true;
    streamSmoothRadius = 7;
    streamFace.length = 0;
    streamUpper.length = 0;
    streamHands.length = 0;
    streamLower.length = 0;
    self.postMessage({ id, type: 'reset_done' });
    return;
  }

  // 开启无限自回归长会话（整场对话只调用一次）[cite: 13]
  if (type === 'feed_audio_start') {
    try {
      await ensureLoaded();
      if (!continueFromPrevious) {
        seed = null;
        streamBuffer = new Float32Array(0);
        streamWindowsProcessed = 0;
        streamNFrames = 0;
        streamBaseFrame = 0;
        decodedFrameCursor = 0;
        streamFace.length = 0;
        streamUpper.length = 0;
        streamHands.length = 0;
        streamLower.length = 0;
      }
      streamActive = true;
      streamId = id;
      streamProfileStages = profileStages === true;
      // P0a: 窗级 motion_chunk 开关 + 平滑半径
      streamEmitPerWindow = e.data.emitPerWindow !== false;
      // E2: hop frames (default EFF=60). Clamp so we always cover at least EFF new motion from one step.
      const adv = Number(e.data.advanceFrames);
      ADVANCE_FRAMES = Number.isFinite(adv) && adv >= EFF
        ? Math.min(WINDOW, Math.floor(adv))
        : EFF;
      streamSmoothRadius = e.data.temporalSmoothRadius ?? 7;
      self.postMessage({ id, type: 'stream_ready' });
    } catch (err: any) {
      self.postMessage({ id, type: 'error', error: err?.message || String(err) });
    }
    return;
  }

  // 跨切片持续接收 PCM 并滑动自回归窗口[cite: 13]
  if (type === 'feed_audio_chunk') {
    if (!streamActive || streamId !== id) {
      self.postMessage({ id, type: 'error', error: 'No active stream session' });
      return;
    }
    try {
      const merged = new Float32Array(streamBuffer.length + pcm.length);
      merged.set(streamBuffer);
      merged.set(pcm, streamBuffer.length);
      streamBuffer = merged;

      while (streamBuffer.length >= WINDOW_AUDIO) {
        const wAudio = streamBuffer.subarray(0, WINDOW_AUDIO);
        const stepStartedAt = performance.now();
        const r = await runStep(wAudio);
        postStageProfile(id, streamProfileStages, 'step', stepStartedAt, { frames: WINDOW });
        // 自回归核心：前一窗的产出姿态作为下一窗的历史输入，物理级连续[cite: 13]
        seed = r.seed;

        // 首个窗口包含开头的 SEED 帧，后续窗口必须跳过前 SEED_FRAMES 帧，确保时序连续[cite: 13]
        const isFirst = streamWindowsProcessed === 0;
        const startFrame = isFirst ? 0 : SEED_FRAMES;
        const endFrame = isFirst ? EFF : WINDOW;
        const takeFrames = endFrame - startFrame;
        const hopFrames = Math.max(takeFrames, ADVANCE_FRAMES);

        streamFace.push(r.recFace.subarray(startFrame * LATENT_DIM, endFrame * LATENT_DIM));
        streamUpper.push(r.clsUpper.subarray(startFrame * CODEBOOK_SIZE, endFrame * CODEBOOK_SIZE));
        streamHands.push(r.clsHands.subarray(startFrame * CODEBOOK_SIZE, endFrame * CODEBOOK_SIZE));
        streamLower.push(r.clsLower.subarray(startFrame * CODEBOOK_SIZE, endFrame * CODEBOOK_SIZE));

        streamNFrames += takeFrames;
        streamBuffer = streamBuffer.subarray(hopFrames * SPF);
        streamWindowsProcessed++;

        self.postMessage({
          id,
          type: 'stream_progress',
          windowsProcessed: streamWindowsProcessed,
          totalBufferedFrames: streamNFrames,
        });

        // P0a: 每窗 runStep 成功后立即 decode 末尾并 post motion_chunk（Transferable）
        // 首动早于段 EOF，TTFA ≈ 1×step + 1×decode + 首窗 PCM
        if (streamEmitPerWindow) {
          const absFrom = decodedFrameCursor;
          const absTo = streamNFrames;
          if (absTo > absFrom) {
            const decodeStartedAt = performance.now();
            const chunk = await decodeRange(absFrom, absTo, streamSmoothRadius);
            postStageProfile(id, streamProfileStages, 'decode_chunk', decodeStartedAt, { frames: absTo - absFrom });
            if (chunk) {
              decodedFrameCursor = absTo;
              trimStreamHistory(Math.max(0, decodedFrameCursor - streamSmoothRadius * 2));
              const hop = Math.max(chunk.frameCount, ADVANCE_FRAMES);
              const out = hop > chunk.frameCount
                ? stretchMotionFeatures(chunk.rot6d, chunk.trans, chunk.frameCount, hop)
                : chunk;
              (self as any).postMessage(
                {
                  id,
                  type: 'motion_chunk',
                  rot6d: out.rot6d,
                  trans: out.trans,
                  frameCount: out.frameCount,
                  duration: out.duration ?? out.frameCount / FPS,
                  fps: chunk.fps,
                  absFrom,
                  absTo,
                  advanceFrames: hop,
                  windowsProcessed: streamWindowsProcessed,
                },
                [out.rot6d.buffer, out.trans.buffer]
              );
            }
          }
        }
      }
    } catch (err: any) {
      streamActive = false;
      streamId = null;
      self.postMessage({ id, type: 'error', error: err?.message || String(err) });
    }
    return;
  }

  // 增量结算切片：在不关闭长流、不清空特征栈的前提下，解码出当前段落对应的动作帧并返回[cite: 13]
  if (type === 'feed_audio_checkpoint') {
    if (!streamActive) {
      self.postMessage({ id, type: 'error', error: 'No active stream session' });
      return;
    }
    try {
      // 允许处理剩余音频凑出的微窗
      const remainingFrames = Math.floor(streamBuffer.length / SPF);
      if (remainingFrames > SEED_FRAMES) {
        const stepStartedAt = performance.now();
        const r = await runStep(streamBuffer);
        postStageProfile(id, streamProfileStages, 'step_tail', stepStartedAt, { frames: remainingFrames });
        seed = r.seed;

        const isFirst = streamWindowsProcessed === 0;
        const startFrame = isFirst ? 0 : SEED_FRAMES;
        const tailFrames = Math.min(WINDOW - startFrame, remainingFrames);

        if (tailFrames > 0) {
          const endFrame = startFrame + tailFrames;
          streamFace.push(r.recFace.subarray(startFrame * LATENT_DIM, endFrame * LATENT_DIM));
          streamUpper.push(r.clsUpper.subarray(startFrame * CODEBOOK_SIZE, endFrame * CODEBOOK_SIZE));
          streamHands.push(r.clsHands.subarray(startFrame * CODEBOOK_SIZE, endFrame * CODEBOOK_SIZE));
          streamLower.push(r.clsLower.subarray(startFrame * CODEBOOK_SIZE, endFrame * CODEBOOK_SIZE));
          streamNFrames += tailFrames;
          streamWindowsProcessed++;
        }
      }

      // 核心对齐保护：保留与最新 seed (4帧) 严格对应的音频采样点作为历史声学上下文[cite: 13]
      if (streamBuffer.length >= SEED_AUDIO) {
        streamBuffer = streamBuffer.subarray(streamBuffer.length - SEED_AUDIO);
      }

      const decodeStartedAt = performance.now();
      const smoothRadius = temporalSmoothRadius ?? streamSmoothRadius ?? 7;
      const unEmitted = streamNFrames - decodedFrameCursor;
      // P0a: 若 motion_chunk 已交付完所有尾段，checkpoint 只发空包（drained:true），避免双 decode
      if (unEmitted <= 0) {
        self.postMessage({
          id,
          type: 'checkpoint_success',
          rot6d: new Float32Array(0),
          trans: new Float32Array(0),
          frameCount: 0,
          duration: 0,
          fps: FPS,
          drained: true,
        });
      } else {
        const res = await decodeRange(decodedFrameCursor, streamNFrames, smoothRadius);
        postStageProfile(id, streamProfileStages, 'decode_checkpoint', decodeStartedAt, { frames: unEmitted });
        if (!res) {
          throw new Error('当前切片无可用动作帧');
        }
        decodedFrameCursor = streamNFrames;
        // 只保留下一次 decodeRange 所需的前导 overlap。
        trimStreamHistory(Math.max(0, decodedFrameCursor - smoothRadius * 2));

        (self as any).postMessage(
          {
            id,
            type: 'checkpoint_success',
            rot6d: res.rot6d,
            trans: res.trans,
            frameCount: res.frameCount,
            duration: res.duration,
            fps: res.fps,
            drained: false,
          },
          [res.rot6d.buffer, res.trans.buffer]
        );
      }
    } catch (err: any) {
      self.postMessage({ id, type: 'error', error: err?.message || String(err) });
    }
    return;
  }

  // 对话全部结束：执行末尾收尾与闭流[cite: 13]
  if (type === 'feed_audio_end') {
    if (!streamActive || streamId !== id) {
      self.postMessage({ id, type: 'error', error: 'No active stream session' });
      return;
    }
    try {
      const remainingFrames = Math.floor(streamBuffer.length / SPF);
      if (remainingFrames > 0) {
        const stepStartedAt = performance.now();
        const r = await runStep(streamBuffer);
        postStageProfile(id, streamProfileStages, 'step_tail', stepStartedAt, { frames: remainingFrames });
        seed = r.seed;

        const isFirst = streamWindowsProcessed === 0;
        const startFrame = isFirst ? 0 : SEED_FRAMES;
        const tailFrames = Math.min(WINDOW - startFrame, remainingFrames);

        if (tailFrames > 0) {
          const endFrame = startFrame + tailFrames;
          streamFace.push(r.recFace.subarray(startFrame * LATENT_DIM, endFrame * LATENT_DIM));
          streamUpper.push(r.clsUpper.subarray(startFrame * CODEBOOK_SIZE, endFrame * CODEBOOK_SIZE));
          streamHands.push(r.clsHands.subarray(startFrame * CODEBOOK_SIZE, endFrame * CODEBOOK_SIZE));
          streamLower.push(r.clsLower.subarray(startFrame * CODEBOOK_SIZE, endFrame * CODEBOOK_SIZE));
          streamNFrames += tailFrames;
          streamWindowsProcessed++;
        }
      }

      // 结算从上次 Checkpoint 到最终结束未交付的尾部动作帧[cite: 13]
      const unEmitted = streamNFrames - decodedFrameCursor;
      let finalRes = null;
      if (unEmitted > 0) {
        self.postMessage({ id, type: 'progress', message: '尾部动作解码中…' });
        const decodeStartedAt = performance.now();
        const endSmoothRadius = temporalSmoothRadius ?? streamSmoothRadius ?? 7;
        finalRes = await decodeRange(decodedFrameCursor, streamNFrames, endSmoothRadius);
        postStageProfile(id, streamProfileStages, 'decode_end', decodeStartedAt, { frames: unEmitted });
        decodedFrameCursor = streamNFrames;
        trimStreamHistory(Math.max(0, decodedFrameCursor - endSmoothRadius * 2));
      }

      streamActive = false;
      streamId = null;

      if (finalRes) {
        (self as any).postMessage(
          {
            id,
            type: 'success',
            rot6d: finalRes.rot6d,
            trans: finalRes.trans,
            frameCount: finalRes.frameCount,
            duration: finalRes.duration,
            fps: finalRes.fps,
          },
          [finalRes.rot6d.buffer, finalRes.trans.buffer]
        );
      } else {
        self.postMessage({ id, type: 'success_empty' });
      }
    } catch (err: any) {
      streamActive = false;
      streamId = null;
      self.postMessage({ id, type: 'error', error: err?.message || String(err) });
    }
    return;
  }

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

      if (!continueFromPrevious) {
        seed = null;
      }
      const totalFrames = Math.max(1, Math.floor(pcm.length / SPF));
      const hop = Math.max(EFF, ADVANCE_FRAMES);
      const numWindows = Math.max(1, Math.ceil((totalFrames - SEED_FRAMES) / hop));
      const N = totalFrames;

      const faceBuf = new Float32Array(N * LATENT_DIM);
      const upperBuf = new Float32Array(N * CODEBOOK_SIZE);
      const handsBuf = new Float32Array(N * CODEBOOK_SIZE);
      const lowerBuf = new Float32Array(N * CODEBOOK_SIZE);
      let writeOff = 0;

      for (let w = 0; w < numWindows; w++) {
        self.postMessage({ id, type: 'progress', message: `窗口 ${w + 1}/${numWindows}` });
        const startSample = w * hop * SPF;
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
    return;
  }
};