# Performance & Bundle Size Optimization Notes (v0.1.14)

> This document summarizes the v0.1.14 optimization cycle for Project XiaoChun covering **bundle size, initial load latency, and inference speed**: what was done, empirical measurements, discarded alternatives, and **unverified follow-ups**.  
> **Guiding Principle**: Numbers must reflect actual empirical measurements; unmeasured items are explicitly flagged as "Unverified"; model quality is evaluated only at the logits / argmax level without formal subjective visual studies.  
> **Related Documents**: [`EMAGE_MODEL.md`](EMAGE_MODEL.md) (online architecture & constraints) · [`packages/emage-onnx`](../packages/emage-onnx/README-CN.md) (offline toolchain, complete datasets & reproduction scripts) · [`EMBED.md`](EMBED.md) (iframe / SDK / security headers).

---

## 0. One-Page Summary

| Dimension | Previous | Current | Notes |
| :-- | :-- | :-- | :-- |
| Single EMAGE `emage_step` File | 175.00 MB | **66.55 MB** | INT8, removed face branch, quantized Conv weights to INT8, pruned cross-attn layers 0..3, offline graph optimization |
| Total EMAGE Download (5 Files) | 191.35 MB | **71.59 MB** (−62.6%) | Per-file `brotli -q9` total: 161.28 → **57.72 MB** |
| `emage_step` Single-Window Inference (Node WASM, 1 Thread) | 548 ms | **274 ms** | 4 threads: 165 → **79 ms**; Node environment only, see §1.3 |
| `emage_step` Session Creation (Node, 1 Thread) | 926 ms | **80 ms** | In-browser: offline optimization reduced creation from 196 → 66 ms (headless Chrome, 4 threads) |
| `vrmEngine` Chunk in Main Bundle | 6,951,996 B | **1,012,057 B** | Split web-llm into on-demand `lib-*.js` chunk (6,028,572 B); `/embed` default path no longer downloads it |
| EMAGE Download Pipeline | Sequential download | **Parallel download + pipelined session creation** | Speak latency over simulated slow network reduced from 12.4 → 9.4 s, see §3 |
| EMAGE Threads in iframe | 1 (default) | Up to **8** when host is isolated and SDK flag is enabled | Disabled by default; requires host COOP/COEP, see §4 |

> Note: All "Node" benchmarks were gathered via ort-web WASM in Node.js (not inside browser engines) and **are only valid for relative comparisons**. Absolute latencies on browsers, mobile devices, Safari, and Firefox remain **Unverified**.

---

## 1. EMAGE Model Slimming (Without Retraining)

For the full processing pipeline, per-step size/latency/quality matrices, and reproduction scripts, refer to [`packages/emage-onnx/README-CN.md`](../packages/emage-onnx/README-CN.md). A concise summary follows below.

### 1.1 Optimizations Applied

1. **Streamline `emage_step` (Retain `cls_*` only)**: Removed the facial branch (`vqFace` was disabled in the app) and eliminated in-graph `argmax → VQ decode → 6D → axis-angle → 55 joints` execution. The `seed` (first 4 frames of the next window) is now reconstructed in JS ([`emageSeed.ts`](../src/motion/sources/emageSeed.ts), using `vq_*_idx` + `postprocess`, with jaw 6D locked to identity rotation), adding ~**18 ms** per window on a single thread. Size dropped from 191.35 → 127.21 MB.
2. **Quantize Remaining Conv Weights to INT8**: Per-channel quantization on weights only; `DequantizeLinear` operators fold during session creation, reducing download size without impacting runtime latency or memory footprint. Size dropped to 100.67 MB.
3. **Prune Cross-Attention Layers 0..3 & Run Offline Graph Optimization (No Retraining)**: The 8 cross-attention layers accounted for 60% of step weights. On this specific checkpoint, layers 0..3 act as approximate identities (pruning them yielded a logits relL2 of 0.05% and an argmax agreement of 99.6%). We then ran offline `ORT_ENABLE_EXTENDED` graph optimization using Python onnxruntime, retaining only CPU fusion kernels bundled across all ORT WASM builds. Final size: **71.59 MB**.
   - Note: The pruned layer indices were determined via empirical ablation. **Retraining or updating weights requires repeating this analysis**. The underlying mechanism causing layers 0..3 to be near-identity remains unverified.

### 1.2 Model Size (MB = 1e6 bytes)

| Variant | `emage_step` | Total | Total (brotli -q9) |
| :-- | --: | --: | --: |
| Baseline INT8 | 175.00 | 191.35 | 161.28 |
| Step 1 (Streamlined step) | 110.86 | 127.21 | 107.60 |
| Step 1+2 (+ Conv INT8) | 95.43 | 100.67 | 82.83 |
| **Step 3 (+ Pruning + Offline Optimization, Production)** | **66.55** | **71.59** | **57.72** |

Filenames remain unchanged (`emage_step_int8.onnx`, `vq_{upper,hands,lower}_idx_int8.onnx`, `postprocess_int8.onnx`). When `useInt8 = true` in `config.ts`, these files are fetched.

### 1.3 Latency Benchmarks

Environment: Node.js + onnxruntime-web WASM (`ort-web 1.29.0`, 64-frame window, median of 10 windows post-warmup):

| `emage_step` Variant | 1 Thread | 4 Threads | 8 Threads | Session Creation (1 Thread) |
| :-- | --: | --: | --: | --: |
| Full Baseline INT8 step | 578 ms (alt: 548) | 163 ms (alt: 165) | 99 ms | 926 ms |
| Step 3 (Final Production) | **274 ms** | **79 ms** | 48 ms | **80 ms** |

- **In-Browser** (headless Chrome 154 on Apple M1 Ultra, cross-origin isolated, 4 threads): Offline optimization reduced session creation from **196 → 66 ms** (pinned 1.22.0-dev: 164 → 50 ms), with single-window inference at ~78 ms. Output matches bit-for-bit before and after offline optimization (max absolute difference: 0). Offline graph optimization **does not alter single-window inference latency**, only session initialization.
- Browser numbers reflect an Apple M1 Ultra on headless Chrome 154; other CPUs, memory-constrained environments, and mobile platforms are **Unverified**.

### 1.4 Output Quality (Logits & Argmax Level)

| Benchmark Comparison | Metric | Result |
| :-- | :-- | :-- |
| vs. FP32 Slim Ground Truth (42 windows, Python ORT) | relL2 / top-1 | 1.27% / **~92.5%** |
| vs. Previous INT8 Baseline, Teacher Forcing (72 windows) | Argmax agreement (upper / hands / lower) | 93.8 / 92.1 / 93.3% |
| vs. Previous INT8 Baseline, Free-Running | Argmax agreement (upper / hands / lower) | **90.1 / 86.5 / 90.6%** |
| Noise Floor (FP32 Free-Running vs. INT8 Free-Running) | Same as above | 89.8 / 88.2 / 92.2% |

- **Interpretation**: Free-running agreement aligns closely with the intrinsic noise floor between FP32 and INT8 (hands are ~1.7 percentage points below the floor). **Agreement does not equal visual indistinguishability**. In production, upper and hands undergo top-6 sampling at temperature 0.85.
- **Visual Regression**: No perceptible degradation observed during manual verification.
- **Validation Dataset**: 7 audio tracks (EN/ZH TTS, music snippets, conversational audio, benchmark audio) totaling 72 inference windows.
- **Unverified Scope**: Mobile devices, Safari, Firefox; prolonged sessions (>several minutes); singing; non-standard speakers; silence; empirical statistical distribution under top-k sampling; formal subjective perceptual studies.

### 1.5 CDN Path & Cache Invalidation

- Model assets are served from **`https://cdn.firetable.tech/xiaochun/emage/`** (production default in `APP_CONFIG.emage.base`; overridable via `VITE_EMAGE_BASE_PROD`).
- Cache Storage bucket upgraded to **`emage-models-v2`**: Because filenames match the legacy set and cache lookups use URL paths, upgrading the bucket avoids stale asset contamination. Upon successful initialization, `emageWorker.ts#purgeOldModelCaches()` cleans up legacy `emage-models-*` buckets (~190 MB freed).
- Legacy files under `https://cdn.firetable.tech/xiaochun/` remain intact for backward compatibility.

### 1.6 Cloudflare Edge Compression (Empirical Measurements)

Requests to `emage_step_int8.onnx` (66,550,463 bytes) on the CDN with varied `Accept-Encoding` (measured 2026-10-03, single trial, local network):

| Accept-Encoding | Response `content-encoding` | Transferred Bytes | Ratio vs. Raw |
| :-- | :-- | --: | --: |
| identity | — | 66,550,463 | 100% |
| gzip | gzip | 54,112,594 | 81.3% |
| br | br | 53,507,704 | 80.4% |
| zstd | zstd | 53,828,638 | 80.9% |
| zstd, br, gzip | zstd (server prefers zstd) | 53,831,000 | 80.9% |

- **Observation**: Edge compression delivers modest gains (~80% of original size via zstd or br). **Offline model slimming (−62.6%) provides the overwhelming majority of bandwidth savings**, with edge compression offering secondary benefits.
- Note: The offline `brotli -q9` figure of 57.72 MB represents all 5 files compressed offline and does not reflect runtime network transfer. Cloudflare dynamically compresses assets using unspecified quality levels; only `emage_step` was empirically measured on the wire.

---

## 2. On-Demand Loading of web-llm

**Problem**: `@mlc-ai/web-llm` (~6 MB) was statically imported by `webLLMProvider.ts`, bundling it directly into the shared `vrmEngine` chunk. As a result, the `/embed` iframe was forced to download the entire LLM library even when only performing TTS speech.

**Solution**: Replaced static imports with `import('@mlc-ai/web-llm')` dynamic loading (retaining only type references), fetching the dependency **only on first actual LLM invocation**:

- Main site: Preloaded in background when `ChatBar` mounts (needed for model lists);
- `/embed`: Loaded only on `xc.say` in chat mode, during `heavy: 'eager'` pre-warming, or when `ui` includes chat controls and the user opens the model selector;
- When unloaded, model ID validation defaults to trusting stored IDs, with strict validation executed after `getWebLLMEngine` completes.

**Build Artifact Size Comparison (Bytes)**:

| Chunk | Previous | Current |
| :-- | --: | --: |
| `vrmEngine` | 6,951,996 (gzip: 2,416,814 / br: 1,622,728) | **1,012,057** (gzip: 292,056 / br: 233,548) |
| `lib-*` (web-llm, new on-demand chunk) | — | 6,028,572 (gzip: 2,145,169 / br: 1,408,854) |
| `llmWorker` (already on-demand) | 6,016,641 | 6,016,641 (unchanged) |

- Verified in headless Chrome: Loading `/embed` and calling `speakAudio` requests only `vrmEngine`, completely omitting `lib-*` and `llmWorker` while successfully loading EMAGE models and synthesizing gestures.
- Main site `/` still loads `lib-*`.
- **Unverified**: Full chat loop pulling WebLLM on WebGPU-enabled machines post-dynamic-import; end-to-end `xc.say` chat mode; mobile devices.

---

## 3. EMAGE Model Parallel Download Pipeline

In `emageWorker.ts#ensureLoaded`, the legacy flow sequentially executed `download → InferenceSession.create` for each model. The new architecture **downloads all enabled models in parallel** (preserving cache semantics), queueing `create` operations as each download resolves.

- **Session creation remains serialized**: Single-threaded WASM cannot meaningfully parallelize `InferenceSession.create`, and serialization avoids concurrency bugs in ort-web runtime initialization.
- Download progress is reported via `onStatus` (`Downloading N models in parallel... / [k/N] downloaded / [k/N] initialized`).

**Empirical Measurements** (headless Chrome → SDK iframe → `speakAudio`, median of 3 cold-cache runs; all 5 models successfully loaded):

| Network Profile | Total Download Elapsed (Prev → Now) | Total Speak Overhead (Prev → Now) |
| :-- | --: | --: |
| Localhost, unthrottled | ~1.65 s → ~0.05 s | ~2.7 s → ~2.5 s |
| **Simulated** 8 MB/s, 60 ms latency | 11.5 s → 8.8 s | 12.4 s → 9.4 s |
| **Simulated** 2 MB/s, 100 ms latency | 39.9 s → 34.9 s | 40.9 s → 35.7 s |

- "Total Download Elapsed" represents the wall-clock duration from the first to the last `.onnx` request. "Speak Overhead" measures duration from `speakAudio` invocation until playback start minus the 2.5s audio duration (includes download + session creation + first-window inference).
- **Caveat on Throttling**: Throttling was simulated per-connection on a local test server, multiplying effective aggregate bandwidth. In real-world networks with shared connection limits, parallel gains will be smaller and primarily driven by pipelining download with session creation. The 66.55 MB `step` model remains the fundamental bottleneck (~8.3s at 8 MB/s).
- Production CDN behavior under varied cellular conditions is **Unverified**.

---

## 4. SDK: Optional `crossOriginIsolated` (Multi-Threaded WASM)

By default, an embedded iframe has `crossOriginIsolated === false`, forcing onnxruntime-web into **single-threaded** WASM mode. Enabling multi-threading requires satisfying three constraints simultaneously:

1. Host page isolation: `Cross-Origin-Opener-Policy: same-origin` + `Cross-Origin-Embedder-Policy: credentialless` (or `require-corp`);
2. `/embed` headers: Sends `COEP: credentialless` + `CORP: cross-origin` (configured in `securityHeaders.ts` and `public/_headers`);
3. Host iframe permissions: `allow` attribute must include `cross-origin-isolated`—supported via the SDK flag `createXiaochun({ crossOriginIsolated: true })` / React `<Xiaochun crossOriginIsolated />` / `<xiaochun-avatar cross-origin-isolated>`. **Defaults to false, preserving standard `allow="microphone; autoplay"` behavior.**

**Empirical Verification** (headless Chrome, distinct host and embed origins, mock headers matching `securityHeaders.ts`):

| Host Configuration | SDK Flag | `xc.ready.capabilities.crossOriginIsolated` | EMAGE `numThreads` |
| :-- | :-- | :-- | --: |
| Standard (No COOP/COEP) | false | false | 1 |
| Isolated (COEP `credentialless`) | false | false | 1 |
| Isolated (COEP `credentialless`) | **true** | **true** | **8** (Desktop max; machine had 20 logical cores) |
| Isolated (COEP `require-corp`) | **true** | **true** | **8** |
| Standard (No COOP/COEP) | true | false | 1 |

- Performance reference from Node benchmarks (§1.3): 1 thread 274 ms → 4 threads 79 ms → 8 threads 48 ms. **Actual in-browser latency comparison between 1 and 8 threads remains Unverified**.
- Protocol additions: `xc.ready.capabilities.crossOriginIsolated` exposed as an optional diagnostic field.
- **Side effects on host page**: Host subresources must comply with COEP; other third-party iframes must declare COEP; `COOP: same-origin` severs `window.opener` (may break OAuth / payment popups); Safari requires `require-corp` as it lacks `credentialless` support. Enabling this flag on un-isolated hosts is benign (browser silently ignores it).
- See [`EMBED.md` §3.1](EMBED.md#31-optional-cross-origin-isolation-for-multi-threaded-wasm) and the [SDK README](../packages/project-xiaochun/README.md).

---

## 5. Evaluated Alternatives Not Adopted

Based on experiments documented in [`packages/emage-onnx`](../packages/emage-onnx/README-CN.md):

| Approach | Outcome | Reason for Rejection |
| :-- | :-- | :-- |
| **Static Quantization with Calibration** | Worse quality, no speed gain | No accuracy or latency benefit |
| **Built-in ORT GPTQ** | Worse than RTN baseline | Unacceptable output degradation |
| **4-bit `MatMulNBits`** | Smaller download, but **slower in WASM**; top-1 accuracy dropped to 78%–86% | Slow execution and excessive quality loss; requires AWQ/GPTQ fine-tuning |
| **SVD Low-Rank / FFN & Attention Head Pruning** (Without fine-tuning) | Rejected | Severe quality drop without retraining |
| **Weight Deduplication / Permutation** | Rejected | Inconsequential size reduction |
| **Replace `postprocess` with JavaScript** | Saved only ~0.05 MB after compression | Negligible gain |
| **`quantize_dynamic(["Conv"])` (`ConvInteger`)** | −15.3 MB, but relL2 1.96%, top-1 87.7%, latency increased 365 → 417 ms | Inferior quality and higher latency; kept in script as `--mode convinteger` for reference |
| **`.ort` Format Export** | Session creation 59 vs 66 ms (marginal); larger files (step +0.28 MB, postprocess 1.18 vs 0.47 MB); locked to ORT version | Inadequate benefits coupled with tight runtime version coupling |
| **WebGPU for EMAGE** | FP32/FP16 step achieved 21–28 ms per window on headless Chrome WebGPU, but required 130–263 MB weights; models contain `int64` ops (`speaker_id`, VQ `indices`) with incomplete ORT WebGPU support | Larger download size and runtime instability; EMAGE remains on WASM + INT8, reserving WebGPU for LLMs (see [`EMAGE_MODEL.md` §2](EMAGE_MODEL.md#2-why-emage-stays-on-wasm-e3--closed)) |
| **Knowledge Distillation / Model Retraining** (Compacting step to ~20 MB) | Feasibility evaluated only; no empirical implementation | Requires full retraining pipeline and GPU cluster; deferred |

---

## 6. Unverified Items & Open Follow-ups

- Total first-load latency under real-world mobile networks (only simulated throttling tested);
- EMAGE inference and initialization on Safari, Firefox, and mobile operating systems (including `crossOriginIsolated` behaviors);
- Prolonged multi-minute conversational stability, voice diversity, singing, silence handling, and top-k output distributions;
- In-browser empirical latency comparison of 1 thread vs. 8 threads;
- Verification of whether `VITE_EMAGE_BASE_PROD` is configured in production Cloudflare deployment environments (which would override the default CDN URL);
- End-to-end WebGPU chat pipeline on the main site following web-llm dynamic imports.
