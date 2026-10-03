#!/usr/bin/env bash
# One-shot pipeline: export slim step -> INT8 -> conv INT8 -> clips -> verification -> latency -> sizes.
# Everything is written to scripts/emage-onnx-slim/out/ (gitignored). emage-onnx-export is only read.
#
#   PYTHON=/path/to/python EMAGE_EXPORT_DIR=../emage-onnx-export ./run_all.sh [--with-pinned-ort] [--brotli]
#
# PYTHON must have torch, onnx, onnxruntime, transformers<5, huggingface_hub, omegaconf (see requirements.txt);
# the venv of emage-onnx-export works. HF weights are read from the normal Hugging Face cache (HF_HUB_OFFLINE=1 is fine
# when H-Liu1997/emage_audio is already cached).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; cd "$HERE"
PYTHON="${PYTHON:-python3}"
export EMAGE_EXPORT_DIR="${EMAGE_EXPORT_DIR:-$HERE/../../../emage-onnx-export}"
export PYTHONDONTWRITEBYTECODE=1
PINNED=0; BROTLI=""
for a in "$@"; do case "$a" in --with-pinned-ort) PINNED=1;; --brotli) BROTLI="--brotli";; esac; done
mkdir -p out/reports

echo "== STEP 1: slim step (cls_* only) + INT8 =="
"$PYTHON" export_slim_step.py --export-dir "$EMAGE_EXPORT_DIR"
echo "== STEP 2: INT8 Conv weights (step + vq_*_idx) =="
"$PYTHON" quantize_conv_int8.py --all --export-dir "$EMAGE_EXPORT_DIR"
echo "== test clips =="
./make_clips.sh
echo "== verification (installed onnxruntime-web) =="
node js/verify_slim.mjs --fp32-step emage_step.onnx --json out/reports/verify_slim.json | tee out/reports/verify_slim.log
node js/verify_convq.mjs --json out/reports/verify_convq.json | tee out/reports/verify_convq.log
node js/bench_latency.mjs | tee out/reports/bench_latency.log
"$PYTHON" tools_vs_fp32.py | tee out/reports/vs_fp32.log
if [ "$PINNED" = 1 ]; then
  echo "== same checks on the wasm pinned by emageWorker.ts (1.22.0-dev.20250409) =="
  mkdir -p out/ort-pinned
  (cd out/ort-pinned && { [ -f package.json ] || npm init -y >/dev/null; } && npm install onnxruntime-web@1.22.0-dev.20250409-89f8206ba4 --no-audit --no-fund --ignore-scripts)
  P=out/ort-pinned/node_modules/onnxruntime-web
  node js/verify_slim.mjs --ort-web-dir "$P" --json out/reports/verify_slim_ort1.22-dev.json | tee out/reports/verify_slim_ort1.22-dev.log
  node js/verify_convq.mjs --ort-web-dir "$P" --json out/reports/verify_convq_ort1.22-dev.json | tee out/reports/verify_convq_ort1.22-dev.log
  node js/bench_latency.mjs --ort-web-dir "$P" | tee out/reports/bench_latency_ort1.22-dev.log
fi
echo "== sizes =="
"$PYTHON" size_report.py $BROTLI --json out/reports/sizes.json | tee out/reports/sizes.txt
