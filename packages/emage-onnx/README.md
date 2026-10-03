# emage-onnx

Offline toolchain that **slims, quantizes and optimizes** the EMAGE ONNX models used by 小蠢 (XiaoChun) in the browser, without retraining: slim `cls`-only step, INT8 MatMul + Conv weights, removal of dead cross-attention layers, and offline ORT graph optimization. (Formerly `emage-onnx-slim`; it is no longer only about slimming.)
It is a **companion of [VolgaGerm/emage-onnx-export](https://github.com/VolgaGerm/emage-onnx-export)** (sibling checkout `../emage-onnx-export`, the README-documented `export_onnx.py` + `--quantize` flow stays authoritative). This pack never modifies that repo: it only **reads** its `onnx/*.onnx` baselines, its `PantoMatrix` git history (to extract the model code at `MODEL_COMMIT=0bbb03d`) and `demo.wav`; everything it produces goes to `packages/emage-onnx/out/` (gitignored).

中文说明: [README-CN.md](README-CN.md)

## Result (measured on the original HF weights, this machine)

Download set = what `APP_CONFIG.emage.models` enables today: step + `vq_upper_idx` + `vq_hands_idx` + `vq_lower_idx` + `postprocess` (`vqFace` / `vqGlobal` are disabled). MB = 1e6 bytes.

| Variant | step | vq_upper | vq_hands | vq_lower | postprocess | **Total** | vs current INT8 | brotli -q9 total |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| FP32 (emage-onnx-export) | 528.52 | 4.52 | 5.15 | 6.01 | 0.44 | 544.64 | | 502.82 |
| **INT8 (current, `--quantize`)** | 175.00 | 4.52 | 5.15 | 6.02 | 0.67 | **191.35** | baseline | 161.28 |
| **Step 1**: slim step (`cls_*` only) INT8 | 110.86 | 4.52 | 5.15 | 6.02 | 0.67 | **127.21** | -64.14 (-33.5%) | 107.60 |
| **Step 1+2**: + INT8 Conv weights | 95.43 | 1.34 | 1.50 | 1.72 | 0.67 | **100.67** | -90.68 (-47.4%) | 82.83 |
| **Step 3**: + cross-attn layers 0..3 removed + offline-optimized graphs (`out/final/`) | 66.55 | 1.34 | 1.50 | 1.72 | 0.47 | **71.59** | **-119.76 (-62.6%)** | **57.72** |

(Intermediate: slim step FP32 = 376.58 MB. Brotli is `brotli -q 9` on each file; q11 on the 175 MB file gave 145.5 MB vs 146.7 MB, so q9 is representative.) Brotli on top of Step 1+2 brings the wire size to about 83 MB; CDN compression is orthogonal to this pack.

Per-window latency (onnxruntime-web wasm EP in Node, `demo`-style 64-frame window, median of 10 windows after warm-up; **Node, not a browser**, so treat as relative numbers):

| Step model | 1 thread, ort-web 1.29.0 | 1 thread, pinned 1.22.0-dev | 4 threads 1.29.0 | 4 threads 1.22.0-dev | session create (1T, 1.29.0) |
|---|---:|---:|---:|---:|---:|
| baseline `emage_step_int8` (full) | 548 ms | 551 ms | 165 ms | 173 ms | 878 ms |
| Step 1 slim INT8 | 363 ms | 371 ms | 104 ms | 110 ms | 209 ms |
| Step 1+2 slim INT8 + conv INT8 | 366 ms | 368 ms | 104 ms | 109 ms | 213 ms |

Step 3, measured in one run (Node, `--windows 10`, median ms; `create` = session creation, 1 thread, ort-web 1.29.0):

| Step model | 1T 1.29.0 | 1T 1.22.0-dev | 4T 1.29.0 | 4T 1.22.0-dev | 8T 1.29.0 | create |
|---|---:|---:|---:|---:|---:|---:|
| baseline `emage_step_int8` (full) | 578 | 558 | 163 | 192 | 99 | 926 ms |
| Step 1+2 | 370 | 380 | 108 | 115 | 62 | 231 ms |
| Step 3, layers removed, not optimized | 276 | 280 | 80 | 85 | 44 | 180 ms |
| **Step 3 final** (`out/final/emage_step_int8.onnx`) | **274** | **286** | **79** | **87** | **48** | **80 ms** |

Real browser (headless Chrome 154 on the same Mac, cross-origin isolated, 4 threads, files fetched as ArrayBuffer like `emageWorker.ts`, `js/browser_check.mjs`): step session creation 196 -> 66 ms (ort-web 1.29.0) and 164 -> 50 ms (pinned 1.22.0-dev) after offline optimization, 78 ms / 83 ms per window; `postprocess` creation 566 -> 444 ms and 423 -> 310 ms (it is now the slowest session to create: 5104 graph nodes). Outputs of the optimized files are **bit-identical** to the not-optimized ones in the browser (step `cls_*`, `vq_*`, `postprocess`: max abs diff 0). Offline optimization does not change per-window latency, only session creation.

Extra work per window in the worker for the host-side seed: `vq_* x3 + postprocess` on 64 frames, about 18 ms (1 thread). Step 2 does not change latency or RAM: ORT constant-folds the `DequantizeLinear` at session creation, only the **download** shrinks.

## Pipeline

```
HF weights (H-Liu1997/emage_audio, local HF cache)  +  PantoMatrix@0bbb03d (git archive, read-only)
        |
        v   export_slim_step.py   (wrapper = body-only copy of EmageAudioModel.forward)
 emage_step_slim.onnx (FP32, outputs cls_upper/cls_hands/cls_lower)         376.58 MB
        |  quantize_dynamic(QInt8, op_types_to_quantize=["MatMul"])   <- exactly the README --quantize call
        v
 emage_step_slim_int8.onnx                                                   110.86 MB   (STEP 1)
        |  quantize_conv_int8.py   (per-channel int8 Conv weights + DequantizeLinear)
        v
 emage_step_slim_int8_convq.onnx  95.43 MB   + vq_{upper,hands,lower}_idx_int8_convq.onnx 1.34/1.50/1.72 MB   (STEP 2)
        |  step3_drop_optimize.py: export_slim_step.py --drop-cross-layers 0,1,2,3 -> INT8 (same README call) -> Conv INT8
        |                         -> offline ORT_ENABLE_EXTENDED optimization of step, vq_*, postprocess
        v
 out/final/{emage_step_int8,vq_upper_idx_int8,vq_hands_idx_int8,vq_lower_idx_int8,postprocess_int8}.onnx   71.59 MB   (STEP 3)
```

### Step 1: slim step

`export_slim_step.py` re-exports from the original weights (not an `onnx.utils.extract_model` prototype). The wrapper is a line-by-line copy of the body path of `EmageAudioModel.forward` and is asserted equal to the full model (`max|diff| = 0` in PyTorch; ONNX vs PyTorch `<= 8e-5`). Dropped compared with `emage_step.onnx`:

* the whole face branch: `audio_encoder_face`, `bodyhints_face`, `audio_face_motion_proj`, `face_motion_decoder` (4 layers), `face_out_proj`, `speaker_embedding_face` (`rec_face` output is gone; `vqFace` is disabled in the app anyway);
* the in-graph `argmax -> VQ decode (face/upper/hands/lower) -> 6D -> axis-angle -> 55-joint assembly` chain, which only produced `rot6d` / `lower_dec` (never consumed by `emageWorker.ts`) and `seed`.

Outputs: `cls_upper`, `cls_hands`, `cls_lower` `[1,64,256]`. Inputs are unchanged (`audio`, `speaker_id`, `masked_motion`, `mask`). Graph nodes: 6485 -> 1473.

#### Host-side `seed` spec (JS)

The next window's first 4 frames are the last 4 frames of the previous window's `motion_inference`. The full step computed it in-graph; the slim step does not, so the worker rebuilds it (`src/motion/sources/emageSeed.ts`):

1. For the **full 64-frame window**, take `argmax` of `cls_upper`, `cls_hands`, `cls_lower` (greedy, not the top-k sampled indices used for the final motion).
2. Decode with the sessions the worker already has: `vq_upper_idx`, `vq_hands_idx`, `vq_lower_idx` -> `decoded` of 78 / 180 / 61 dims.
3. Build `face_dec` `[1,64,106]` zeros and set the **jaw 6D (first 6 dims of every frame) to the identity `[1,0,0,0,1,0]`**. Do not leave it zero: `postprocess` turns an all-zero face into the invalid jaw 6D `[0,0,1,1,0,0]`.
4. Run `postprocess(face_dec, upper_dec, hands_dec, lower_dec)` -> `motion_inference` `[1,64,337]`.
5. `seed = motion_inference[:, 60:64, :]` (`SEED_FRAMES = 4`).

Why the whole window and not the already decoded range: the first window of a stream only keeps frames 0..59, and the VQ decoders are convolutional (decoding only the last 8 frames changes the seed by up to ~0.18; 18+ frames of context agree to 1.5e-4, the full 64 frames to exactly 0 except the jaw).

Reference implementation + worker patch (this branch): `src/motion/sources/emageSeed.ts` (pure TS, dependency injected) and `src/motion/sources/emageWorker.ts`:

* `runStep` auto-detects the model: if the step returns `seed` + `rec_face` (full model) they are used as before; otherwise `computeSeedFromLogits` runs and `recFace` is a zero placeholder. **Existing models behave exactly as before** and no config change is made by this pack.
* A slim step with `vqFace` enabled throws a clear error (no `rec_face`).
* `vq_*` / `postprocess` are now also used inside `runStep`, so all uses go through one promise-chain lock (`withVqLock`, also around `decode()`); ORT wasm throws "Session already started" if two `run()` calls overlap on one session.

### Step 2: INT8 Conv weights

`--quantize` only touches `MatMul`; every `Conv` (audio_encoder_body + motion_encoder in the step, all decoder convs in `vq_*_idx`) stays FP32, about 30% of the INT8 step. `quantize_conv_int8.py` stores them as per-output-channel symmetric INT8 + FP32 scales followed by `DequantizeLinear(axis=0)` (weight-only, activations unchanged). Savings: step -15.43 MB (20.60 MB FP32 -> 5.17 MB), vq files 15.69 -> 4.56 MB.

Alternatives measured and rejected: `ConvInteger` via `quantize_dynamic(["Conv"])` (-15.3 MB but relL2 vs FP32 1.96% and top-1 87.7%, 417 ms vs 365 ms); the script keeps `--mode convinteger` for comparison. `--mode fp16` (weights stored as FP16 + Cast, step 100.56 MB) and `--include <regex>` (e.g. only `motion_encoder`: 105.37 MB; only `audio_encoder_body`: 100.91 MB) exist for trading size against error.

### Step 3: remove dead cross-attention layers + offline graph optimization

**3a. Cross-attention layers 0..3 removed (no retraining).** `audio_motion_cross_attn` has 8 layers and holds 60% of the step weights (7.08 MB INT8 each). Ablating layers one at a time and in groups on the released weights (61 windows, FP32, teacher forced, logits vs the unmodified FP32 slim model):

| Removed layers | relL2 | argmax agreement |
|---|---:|---:|
| none | 0 | 100% |
| 0 | 0.00% | 100% |
| 0,1,2 | 0.00% | 100% |
| **0,1,2,3** | **0.05%** | **99.6%** |
| 0,1,2,4 | 0.33% | 97.1% |
| 0,1,2,3,4 | 8.96% | 44.7% |
| any of 5, 6, 7 alone | 7.6% to 25% | collapses |

So the first four layers are almost an identity on these weights (even for random-noise inputs, removing them changes the logits by < 1e-4), the later ones are essential. Same idea as depth pruning of LLMs without retraining: [ShortGPT](https://arxiv.org/abs/2403.03853), [Gromov et al.](https://arxiv.org/abs/2403.17887). A possible reason is large residual-branch activations in the early layers that the following LayerNorm washes out ([massive activations](https://arxiv.org/abs/2402.17762)); that mechanism was **not** verified. Self-encoder and the three body decoders were also ablated and must stay (1.3% to 9% relL2). The layer list comes from those ablation experiments (a scratch directory, not shipped with the package): re-do them if the checkpoint ever changes.

`export_slim_step.py --drop-cross-layers 0,1,2,3 --name emage_step_drop0123` removes the layers before export (default behaviour without the flag is unchanged); the rest is the README `quantize_dynamic` call and STEP 2 Conv INT8. FP32 263.0 MB, INT8 82.11 MB, + Conv INT8 **66.68 MB** (STEP 2 file 95.43 MB).

**3b. Offline optimization.** `step3_drop_optimize.py` loads each file in python onnxruntime at `ORT_ENABLE_EXTENDED` (CPU EP) and saves the optimized graph (`optimized_model_filepath`). The saved graphs contain only CPU `com.microsoft` fusions that every ORT wasm build ships (`DynamicQuantizeMatMul`, `MatMulIntegerToFloat`, `FusedMatMul`, `SkipLayerNormalization`, `FusedConv`); the script refuses to write graphs with NHWC/NCHWc layout-specific domains. The browser then spends much less time optimizing at session creation. `postprocess_int8.onnx` shrinks 0.67 -> 0.47 MB. Per-window latency is unchanged.

**.ort format vs optimized .onnx.** `--ort` also writes ORT-format files (`convert_onnx_models_to_ort --optimization_style Fixed --target_platform amd64`; `wasm` is not an accepted target) to `out/final_ort/`. Both load and give bit-identical outputs in headless Chrome with ort-web 1.29.0 and the pinned 1.22.0-dev (see `js/browser_check.mjs`). The `.ort` files are not shipped in the final set because the browser gain is nil (step creation 59 vs 66 ms), they are slightly larger (step +0.28 MB, `postprocess` 1.18 vs 0.47 MB) and ORT-format files are tied to the ORT version that wrote them. **There is no filename problem either way**: `emageWorker.ts` fetches the bytes (`fetchWithCache`) and passes an `ArrayBuffer` to `InferenceSession.create`, ORT detects the format from the bytes, so even the file extension would not matter; `config.ts` keeps requesting `emage_step_int8.onnx` etc. and the final set already has exactly those names.

Quality (Step 3 final, optimized): against the FP32 slim truth (42 windows, python ORT) relL2 **1.27%**, top-1 **92.5%** (Step 1+2: 1.29%, 92.9%; FP32 with the layers removed: 0.05%, 99.5%). Against the baseline INT8 `emage_step_int8` (72 windows, ort-web 1.29.0, identical on 1.22.0-dev): teacher-forced argmax agreement upper 93.8%, hands 92.1%, lower 93.3% (no longer bit-identical to the baseline, by construction); free-running 90.1% / 86.5% / 90.6% vs the FP32-vs-INT8 noise floor 89.8% / 88.2% / 92.2%; host seed non-jaw max abs diff 0, jaw <= 0.056 as before. The free-running `hands` figure is 1.7 points below the floor (Step 2 alone gave 86.0% against Step 1), so treat Step 3 as "at the noise floor, hands slightly under it".

Measured and rejected for further size/speed (see `out/research/NOTES.md` in the author's checkout, not shipped): static quantization with calibration (worse and not faster), ORT GPTQ (worse than RTN), 4-bit `MatMulNBits` (smaller but slower in wasm and top-1 78 to 86%), SVD low-rank and FFN/head pruning without finetuning, weight reordering/dedup, replacing `postprocess` by JS (size gain ~0.05 MB compressed).

## Verification (72 windows, 7 clips: emage-onnx-export `demo.wav`, this repo's `bench/baseline.wav`, three 32 s cuts of local mp3 files (`gaosu_baolun`, `test-2`, `the-11th-forest`; content not inspected, may include non-speech), macOS `say` Chinese and English)

Windows are 64 frames (34112 samples), non-overlapping, up to 14 per clip; clips live in `out/clips/` (`make_clips.sh`). Results are identical on ort-web 1.29.0 (installed) and on the wasm pinned in `emageWorker.ts` (`1.22.0-dev.20250409-89f8206ba4`).

| Check | Result |
|---|---|
| Slim INT8 vs baseline `emage_step_int8`, same inputs (teacher forced), `cls_*` | **max abs diff 0, argmax agreement 100%** (72 windows) |
| Host seed (JS path) vs in-graph seed, same logits | **non-jaw dims max abs diff 0**; jaw dims 0.03 to 0.056 (identity vs real face-decoded jaw) |
| Free-running (each loop feeds its own seed), slim+host seed vs baseline, argmax agreement | upper 93.1%, hands 91.5%, lower 94.1% |
| Noise floor for the line above: FP32 free-running vs INT8 free-running (baseline models) | upper 90.1%, hands 88.9%, lower 92.4% |
| Step 2 vs Step 1, teacher forced: logits relL2 / KL per frame / ref argmax in top-3 | 1.2% / 0.005 / 99.8%; argmax agreement 93.4 / 91.9 / 93.6% |
| Step 2 vs Step 1, free-running argmax agreement | 89.0 / 86.0 / 90.9% |
| vs FP32 slim truth (28 windows, python ORT): step 1 INT8 -> step 1+2 | relL2 1.16% -> 1.31%, top-1 93.4% -> 92.5% (re-roll floor, Conv in FP16: 1.16%, 94.0%) |
| Same VQ indices through `vq_*_convq` vs `vq_*_int8`, `motion_inference` | mean abs diff 0.00083, max 0.029 |
| **Step 3** vs baseline `emage_step_int8`, teacher forced, argmax agreement (72 windows) | 93.8 / 92.1 / 93.3% (upper / hands / lower) |
| **Step 3** free-running argmax agreement vs baseline; FP32-vs-INT8 floor | 90.1 / 86.5 / 90.6%; floor 89.8 / 88.2 / 92.2% |
| **Step 3** vs FP32 slim truth (42 windows, python ORT) | relL2 1.27%, top-1 92.5% |
| **Step 3** optimized vs not optimized, in Chrome (step, vq x3, postprocess; ort 1.29.0 and 1.22.0-dev; .onnx and .ort) | max abs diff 0 |

How to read the argmax numbers: the INT8 dynamic quantization re-rolls its activation rounding on **any** upstream perturbation (even FP16 Conv weights give relL2 0.9%), and the model has many near-tied logits, so "argmax agreement vs reference" is noisy by construction. The app additionally samples top-6 with temperature 0.85 for upper/hands. Logit-level numbers (relL2, KL, top-3 containment) are the more meaningful ones: Step 2 adds about 0.15 percentage points of relative logit error on top of INT8's 1.16%.

## Run

Requirements: Python with `requirements.txt` (the `emage-onnx-export/.venv` works), Node 24+ (runs the `.ts` seed helper through type stripping), ffmpeg (clips), `onnxruntime-web` (this package's dependency, resolved from `node_modules`), HF weights `H-Liu1997/emage_audio` in the HF cache (otherwise downloaded), a sibling `../emage-onnx-export` checkout with `onnx/` already exported by its README flow (`EMAGE_EXPORT_DIR` overrides the path).

```bash
cd packages/emage-onnx
# via pnpm (same commands, see package.json scripts):
PYTHON=../../../emage-onnx-export/.venv/bin/python pnpm run all:pinned     # = ./run_all.sh --with-pinned-ort --brotli
pnpm run step1 | step2 | step3 | clips | verify:slim | verify:convq | bench | vs-fp32 | sizes
# or directly:
PYTHON=../../../emage-onnx-export/.venv/bin/python ./run_all.sh --with-pinned-ort --brotli
# or step by step:
python export_slim_step.py             # STEP 1  -> out/emage_step_slim.onnx, out/emage_step_slim_int8.onnx
python quantize_conv_int8.py --all     # STEP 2  -> out/*_convq.onnx
python step3_drop_optimize.py --ort    # STEP 3  -> out/final/*.onnx (+ out/final_ort/*.ort), MANIFEST.json
./make_clips.sh                        # out/clips/*.wav (set EMAGE_EXTRA_CLIPS="a.mp3 b.mp3" to add sources)
node js/verify_slim.mjs --fp32-step emage_step.onnx   # step 1 checks (+ FP32 noise floor)
node js/verify_convq.mjs                              # step 2 checks + latency
node js/verify_slim.mjs --slim-dir out/final --slim-step emage_step_int8.onnx --fp32-step emage_step.onnx   # step 3 checks
node js/browser_check.mjs [--threads 4]               # headless Chrome: load/compare final .onnx and .ort, ort-web installed + pinned
node js/bench_latency.mjs [--threads 4] [--ort-web-dir DIR]
python tools_vs_fp32.py                # error vs FP32 slim truth
python size_report.py --brotli         # size tables
```

Pinned wasm: `npm i onnxruntime-web@1.22.0-dev.20250409-89f8206ba4 --prefix out/ort-pinned` then pass `--ort-web-dir out/ort-pinned/node_modules/onnxruntime-web`.

| File | Purpose |
|---|---|
| `slim_common.py` | paths, `git archive` of PantoMatrix@`0bbb03d` (never `git checkout` in the export repo) |
| `export_slim_step.py` | STEP 1 wrapper export + README INT8 call + checks |
| `quantize_conv_int8.py` | STEP 2 Conv weights (`dq` / `fp16` / `convinteger`) |
| `step3_drop_optimize.py` | STEP 3 layer removal (via `export_slim_step.py --drop-cross-layers`) + Conv INT8 + offline optimization -> `out/final/` |
| `js/browser_check.mjs` | headless Chrome load/compare check of the final files (needs Chrome; `CHROME=` overrides the path) |
| `js/common.mjs`, `js/verify_slim.mjs`, `js/verify_convq.mjs`, `js/bench_latency.mjs` | ort-web (wasm) verification and latency (Node) |
| `tools_vs_fp32.py`, `size_report.py`, `make_clips.sh`, `run_all.sh` | error vs FP32, sizes, clips, one-shot run |

## npm package (not published yet)

This folder is the workspace package `@firetable/emage-onnx` (`version` is independent of the app version, `publishConfig.access = public`, MIT). The tarball contains only scripts and docs (about 30 kB, `npm pack --dry-run` lists 18 files); `out/`, `.cache/` and every model file are excluded via `files`. `prepack` runs `js/sync-seed.mjs`, which vendors `src/motion/sources/emageSeed.ts` as plain JS (`js/vendor/emageSeed.mjs`, gitignored) so the verification scripts also work outside this repo. Its only dependency is `onnxruntime-web` (same range as the app, resolves to the same 1.29.0 in `pnpm-lock.yaml`).

Not wired into any release flow: `publish-npm.yml` only publishes `packages/project-xiaochun`, and `scripts/bump-version.mjs` only edits a fixed file list that does not include this package. There is intentionally no `build` script, so `pnpm build:packages` skips it. To publish it later: bind this package on npmjs.com (Trusted Publishing: repository `FireTable/project-xiaochun`, a workflow file name), then add a dedicated workflow (or a second job with `working-directory: packages/emage-onnx`) and its own tag or version rule. Existing `publish-npm.yml` must stay as is because npm binds it by file name.

## Adopting the files (not done by this pack)

The deployable set is `out/final/`: `emage_step_int8.onnx`, `vq_{upper,hands,lower}_idx_int8.onnx`, `postprocess_int8.onnx` (71.59 MB, 57.72 MB with brotli q9). They already use the names `config.ts` requests with `useInt8 = true`, so no code or `config.ts` change is needed.

1. Local trial: a gitignored `public/onnx-slim3/` can hold symlinks to `out/final/*.onnx`; run the app with `VITE_EMAGE_BASE=/onnx-slim3`. The CDN `cdn.firetable.tech` already serves models with `content-encoding: zstd`, so the wire size is below the raw sizes above.
2. Upload to the CDN under a **new path** (or bump `APP_CONFIG.emage.cacheName`): the file names are the same as the current INT8 set, and `emage-models-v1` caches by URL, so reusing the old path would leave existing users with the old cached step and a new `vq`/`postprocess` mix. Never serve the Step 3 `vq_*`/`postprocess` with the old step or the reverse without checking: the step output is the same shape, but the host-side seed needs the `vq_*`/`postprocess` pair (`emageSeed.ts`).
3. Keep `vqFace` disabled. Run the worker in a browser against the new files first (not done here, see below).

## Caveats and what is NOT verified

* **Only a partial browser run.** `js/browser_check.mjs` loads and runs the Step 3 files in headless Chrome 154 (ort-web 1.29.0 and the pinned 1.22.0-dev, 4 threads, cross-origin isolated) and compares them with the not-optimized files. `emageSeed.ts` is exercised from Node. `emageWorker.ts` type-checks (`tsc --noEmit`) but the worker itself was not run end to end in a browser, a Web Worker, other browsers (Safari, Firefox) or on mobile.
* Latency is mostly Node wasm (1, 4 and 8 threads) plus a 4-thread headless-Chrome check on one Apple M1 Ultra; other CPUs, memory and mobile were not measured. Step 2 gives no latency or RAM gain; Step 3 removes 4 of 8 cross-attention layers, which is where its speed-up comes from (1T 370 -> 274 ms, 4T 108 -> 79 ms).
* **Step 3 risk**: the removal of cross-attention layers 0..3 is a data-driven choice validated on 7 clips (zh/en TTS, three music/speech cuts, demo, bench); no visual/perceptual review, no top-k sampling run, no multi-minute sessions, no other speakers, singing or silence. The layers are ~identity on this checkpoint (mechanism not verified); a different checkpoint needs the ablation again. The optimized graphs were written by python onnxruntime 1.23.2 on arm64 macOS; they only use CPU `com.microsoft` fusions and loaded in both ort-web builds, other ort-web versions or platforms were not tested (the not-optimized `out/emage_step_drop0123_int8_convq.onnx` etc. are the fallback).
* WebGPU is **not** part of this pack. In a side experiment the FP32/FP16 step ran on WebGPU in headless Chrome on the same Mac in ~21 to 28 ms per window, but that needs 130 to 263 MB of weights and was only checked on one GPU, so the app's wasm + INT8 decision is unchanged.
* Motion quality was judged only by logit-level and argmax metrics over 7 clips; no visual / perceptual review of the animation, no top-k sampling simulation, no long (minutes) autoregressive sessions. Free-running argmax agreement of 86 to 94% sits near the INT8-vs-FP32 floor (89 to 92%), which is not proof that the motion looks the same.
* Face/jaw: the slim path fixes the seed jaw to identity; `vqFace` cannot be enabled with the slim step. An analysis probe (teacher forced, one clip, FP32) showed identity-vs-real-jaw seed changes body logits by <= 0.07% relative.
* `package.json` allows `onnxruntime-web ^1.22.0-dev…`, `pnpm-lock` installs 1.29.0 for the JS while `emageWorker.ts` loads the wasm from the jsdelivr 1.22.0-dev URL. Both were tested here, but that JS/wasm version mix in the app was not.
* 4-bit weight-only (`MatMulNBits`) loads in ort-web (also checked) but is **not part of this pack**: naive RTN 4-bit measured clearly worse argmax agreement (about 70 to 85% vs FP32), so it needs GPTQ/AWQ style calibration before it is worth shipping. Reaching ~20 MB would require distillation / retraining.
* Weights come from the local HF cache snapshot (`main`); the dependency on the exact HF revision is the same as in `emage-onnx-export`.

## Suggested back-link for emage-onnx-export README (not applied, that repo is untouched)

> **Smaller download for browser use.** [Project-XiaoChun / packages/emage-onnx](https://github.com/FireTable/project-xiaochun/tree/main/packages/emage-onnx) builds a streaming-only `emage_step` that outputs just the three VQ logits (face branch and the in-graph seed chain removed, seed computed in JS), plus INT8 Conv weights: total browser download 191 MB -> 101 MB (83 MB with brotli) with `cls_*` bit-identical to the INT8 step on identical inputs.
