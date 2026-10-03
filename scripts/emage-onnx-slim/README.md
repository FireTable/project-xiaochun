# emage-onnx-slim

Offline toolchain that shrinks the EMAGE ONNX download used by 小蠢 (XiaoChun) without retraining.
It is a **companion of [VolgaGerm/emage-onnx-export](https://github.com/VolgaGerm/emage-onnx-export)** (sibling checkout `../emage-onnx-export`, the README-documented `export_onnx.py` + `--quantize` flow stays authoritative). This pack never modifies that repo: it only **reads** its `onnx/*.onnx` baselines, its `PantoMatrix` git history (to extract the model code at `MODEL_COMMIT=0bbb03d`) and `demo.wav`; everything it produces goes to `scripts/emage-onnx-slim/out/` (gitignored).

中文说明: [README-CN.md](README-CN.md)

## Result (measured on the original HF weights, this machine)

Download set = what `APP_CONFIG.emage.models` enables today: step + `vq_upper_idx` + `vq_hands_idx` + `vq_lower_idx` + `postprocess` (`vqFace` / `vqGlobal` are disabled). MB = 1e6 bytes.

| Variant | step | vq_upper | vq_hands | vq_lower | postprocess | **Total** | vs current INT8 | brotli -q9 total |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| FP32 (emage-onnx-export) | 528.52 | 4.52 | 5.15 | 6.01 | 0.44 | 544.64 | | 502.82 |
| **INT8 (current, `--quantize`)** | 175.00 | 4.52 | 5.15 | 6.02 | 0.67 | **191.35** | baseline | 161.28 |
| **Step 1**: slim step (`cls_*` only) INT8 | 110.86 | 4.52 | 5.15 | 6.02 | 0.67 | **127.21** | -64.14 (-33.5%) | 107.60 |
| **Step 1+2**: + INT8 Conv weights | 95.43 | 1.34 | 1.50 | 1.72 | 0.67 | **100.67** | -90.68 (-47.4%) | 82.83 |

(Intermediate: slim step FP32 = 376.58 MB. Brotli is `brotli -q 9` on each file; q11 on the 175 MB file gave 145.5 MB vs 146.7 MB, so q9 is representative.) Brotli on top of Step 1+2 brings the wire size to about 83 MB; CDN compression is orthogonal to this pack.

Per-window latency (onnxruntime-web wasm EP in Node, `demo`-style 64-frame window, median of 10 windows after warm-up; **Node, not a browser**, so treat as relative numbers):

| Step model | 1 thread, ort-web 1.29.0 | 1 thread, pinned 1.22.0-dev | 4 threads 1.29.0 | 4 threads 1.22.0-dev | session create (1T, 1.29.0) |
|---|---:|---:|---:|---:|---:|
| baseline `emage_step_int8` (full) | 548 ms | 551 ms | 165 ms | 173 ms | 878 ms |
| Step 1 slim INT8 | 363 ms | 371 ms | 104 ms | 110 ms | 209 ms |
| Step 1+2 slim INT8 + conv INT8 | 366 ms | 368 ms | 104 ms | 109 ms | 213 ms |

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

How to read the argmax numbers: the INT8 dynamic quantization re-rolls its activation rounding on **any** upstream perturbation (even FP16 Conv weights give relL2 0.9%), and the model has many near-tied logits, so "argmax agreement vs reference" is noisy by construction. The app additionally samples top-6 with temperature 0.85 for upper/hands. Logit-level numbers (relL2, KL, top-3 containment) are the more meaningful ones: Step 2 adds about 0.15 percentage points of relative logit error on top of INT8's 1.16%.

## Run

Requirements: Python with `requirements.txt` (the `emage-onnx-export/.venv` works), Node 24+ (runs the `.ts` seed helper through type stripping), ffmpeg (clips), `onnxruntime-web` from this repo's `node_modules`, HF weights `H-Liu1997/emage_audio` in the HF cache (otherwise downloaded), a sibling `../emage-onnx-export` checkout with `onnx/` already exported by its README flow (`EMAGE_EXPORT_DIR` overrides the path).

```bash
cd scripts/emage-onnx-slim
PYTHON=../../../emage-onnx-export/.venv/bin/python ./run_all.sh --with-pinned-ort --brotli
# or step by step:
python export_slim_step.py             # STEP 1  -> out/emage_step_slim.onnx, out/emage_step_slim_int8.onnx
python quantize_conv_int8.py --all     # STEP 2  -> out/*_convq.onnx
./make_clips.sh                        # out/clips/*.wav (set EMAGE_EXTRA_CLIPS="a.mp3 b.mp3" to add sources)
node js/verify_slim.mjs --fp32-step emage_step.onnx   # step 1 checks (+ FP32 noise floor)
node js/verify_convq.mjs                              # step 2 checks + latency
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
| `js/common.mjs`, `js/verify_slim.mjs`, `js/verify_convq.mjs`, `js/bench_latency.mjs` | ort-web (wasm) verification and latency |
| `tools_vs_fp32.py`, `size_report.py`, `make_clips.sh`, `run_all.sh` | error vs FP32, sizes, clips, one-shot run |

## Adopting the files (not done by this pack)

1. Upload `emage_step_slim_int8_convq.onnx`, `vq_{upper,hands,lower}_idx_int8_convq.onnx` (and the unchanged `postprocess_int8.onnx`) to the CDN base `APP_CONFIG.emage.base`. New file names mean new Cache Storage keys (`emage-models-v1` is keyed by URL), so users download the new set once; the old ~191 MB entries stay in their cache until evicted or the cache name is bumped.
2. Point `APP_CONFIG.emage.models` at the new names (today `q()` only rewrites `.onnx` -> `_int8.onnx`) and keep `vqFace` disabled.
3. Run the worker in a browser against the new files (not done here, see below).

## Caveats and what is NOT verified

* **No browser run.** `emageSeed.ts` is exercised from Node with onnxruntime-web (both 1.29.0 and the pinned 1.22.0-dev wasm); `emageWorker.ts` type-checks (`tsc --noEmit`) but the worker itself was not run end to end in a browser, Web Worker, SharedArrayBuffer multi-thread or on mobile.
* Latency is Node wasm (1 and 4 threads); browser numbers, memory and mobile were not measured. Step 2 gives no latency or RAM gain.
* Motion quality was judged only by logit-level and argmax metrics over 7 clips; no visual / perceptual review of the animation, no top-k sampling simulation, no long (minutes) autoregressive sessions. Free-running argmax agreement of 86 to 94% sits near the INT8-vs-FP32 floor (89 to 92%), which is not proof that the motion looks the same.
* Face/jaw: the slim path fixes the seed jaw to identity; `vqFace` cannot be enabled with the slim step. An analysis probe (teacher forced, one clip, FP32) showed identity-vs-real-jaw seed changes body logits by <= 0.07% relative.
* `package.json` allows `onnxruntime-web ^1.22.0-dev…`, `pnpm-lock` installs 1.29.0 for the JS while `emageWorker.ts` loads the wasm from the jsdelivr 1.22.0-dev URL. Both were tested here, but that JS/wasm version mix in the app was not.
* 4-bit weight-only (`MatMulNBits`) loads in ort-web (also checked) but is **not part of this pack**: naive RTN 4-bit measured clearly worse argmax agreement (about 70 to 85% vs FP32), so it needs GPTQ/AWQ style calibration before it is worth shipping. Reaching ~20 MB would require distillation / retraining.
* Weights come from the local HF cache snapshot (`main`); the dependency on the exact HF revision is the same as in `emage-onnx-export`.

## Suggested back-link for emage-onnx-export README (not applied, that repo is untouched)

> **Smaller download for browser use.** [Project-XiaoChun / scripts/emage-onnx-slim](https://github.com/FireTable/project-xiaochun/tree/main/scripts/emage-onnx-slim) builds a streaming-only `emage_step` that outputs just the three VQ logits (face branch and the in-graph seed chain removed, seed computed in JS), plus INT8 Conv weights: total browser download 191 MB -> 101 MB (83 MB with brotli) with `cls_*` bit-identical to the INT8 step on identical inputs.
