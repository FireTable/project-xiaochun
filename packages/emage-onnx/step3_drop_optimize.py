#!/usr/bin/env python3
"""STEP 3: drop cross-attention layers 0..3 (no retraining) + offline graph optimization -> out/final/.

Output set (names the XiaoChun worker already requests when `useInt8 = true`, so config.ts needs no change):
    out/final/emage_step_int8.onnx        step (cls-only, cross-attn layers 0..3 removed, INT8 MatMul + INT8 Conv)
    out/final/vq_{upper,hands,lower}_idx_int8.onnx   (from STEP 2, offline optimized)
    out/final/postprocess_int8.onnx       (baseline file from emage-onnx-export, offline optimized)
    out/final/MANIFEST.json               sizes, ops/domains, versions
    out/final_ort/*.ort                   (only with --ort) same graphs in ORT format, for comparison; see README

What it does
  3a  export_slim_step.py --drop-cross-layers 0,1,2,3 --name emage_step_drop0123   (README quantize_dynamic call for MatMul)
  3b  quantize_conv_int8.py logic (DequantizeLinear INT8 Conv weights) on that step
  3c  "optimize": onnxruntime.InferenceSession(..., optimized_model_filepath=...) at ORT_ENABLE_EXTENDED on the CPU EP.
      The saved graph already contains the fusions (MatMulIntegerToFloat, SkipLayerNormalization, FusedConv, ...), so
      onnxruntime-web spends much less time optimizing at session creation. Per-run latency is unchanged.
      Only CPU-EP extended fusions (com.microsoft CPU ops that every ORT wasm build contains) are used. The script
      refuses to write a model that contains the *.nhwc / NchwcConv domains (platform-specific layouts).
  3d  optional --ort: python -m onnxruntime.tools.convert_onnx_models_to_ort --optimization_style Fixed
      --target_platform amd64  (`wasm` is not a valid target value of that tool)

usage: python step3_drop_optimize.py [--drop 0,1,2,3] [--ort] [--force]
"""
import argparse
import json
import os
import shutil
import subprocess
import sys

import slim_common as C
from quantize_conv_int8 import quantize_conv_dq

ap = argparse.ArgumentParser()
ap.add_argument("--export-dir", default=C.default_export_dir())
ap.add_argument("--out-dir", default=C.DEFAULT_OUT)
ap.add_argument("--drop", default="0,1,2,3", help="cross-attn layers to remove")
ap.add_argument("--name", default=None, help="basename of the dropped step (default emage_step_drop<digits>)")
ap.add_argument("--ort", action="store_true", help="also write ORT-format files to out/final_ort/")
ap.add_argument("--force", action="store_true", help="re-export even when intermediate files exist")
args = ap.parse_args()

name = args.name or "emage_step_drop" + args.drop.replace(",", "")
O = args.out_dir
FINAL = os.path.join(O, "final")
FINAL_ORT = os.path.join(O, "final_ort")
os.makedirs(FINAL, exist_ok=True)

# 3a
int8 = os.path.join(O, f"{name}_int8.onnx")
if args.force or not os.path.exists(int8):
    C.log(f"== 3a: export step without cross-attn layers {args.drop} + INT8 ==")
    subprocess.check_call([sys.executable, os.path.join(C.PACK_DIR, "export_slim_step.py"),
                           "--export-dir", args.export_dir, "--out-dir", O,
                           "--drop-cross-layers", args.drop, "--name", name])
else:
    C.log(f"== 3a: reuse {int8}")

# 3b
convq = os.path.join(O, f"{name}_int8_convq.onnx")
n, saved, added = quantize_conv_dq(int8, convq)
C.log(f"== 3b: Conv INT8: {C.mb(int8):.2f} -> {C.mb(convq):.2f} MB ({n} Conv weights)")

# vq (STEP 2 outputs) and postprocess (baseline)
vq = {}
for part in ("upper", "hands", "lower"):
    f = os.path.join(O, f"vq_{part}_idx_int8_convq.onnx")
    if not os.path.exists(f):
        sys.exit(f"missing {f}: run `python quantize_conv_int8.py --all` (STEP 2) first")
    vq[f"vq_{part}_idx_int8.onnx"] = f
pp = os.path.join(args.export_dir, "onnx", "postprocess_int8.onnx")
if not os.path.exists(pp):
    sys.exit(f"missing {pp}")
sources = {"emage_step_int8.onnx": convq, **vq, "postprocess_int8.onnx": pp}

# 3c
import onnx  # noqa: E402
import onnxruntime as ort  # noqa: E402

BAD_DOMAINS = ("com.ms.internal.nhwc", "com.microsoft.nchwc")


def optimize(src, dst):
    so = ort.SessionOptions()
    so.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_EXTENDED
    so.optimized_model_filepath = dst
    so.log_severity_level = 3
    ort.InferenceSession(src, so, providers=["CPUExecutionProvider"])
    m = onnx.load(dst, load_external_data=False)
    ops = {}
    for nd in m.graph.node:
        ops[f"{nd.domain or 'ai.onnx'}::{nd.op_type}"] = ops.get(f"{nd.domain or 'ai.onnx'}::{nd.op_type}", 0) + 1
    bad = [k for k in ops if k.split("::")[0] in BAD_DOMAINS]
    if bad:
        os.remove(dst)
        sys.exit(f"{dst}: platform-specific ops {bad}; refusing to ship")
    return ops


C.log("== 3c: offline optimization (ORT_ENABLE_EXTENDED, CPU EP) ==")
manifest = {"onnxruntime_python": ort.__version__, "dropped_cross_attn_layers": args.drop, "files": {}}
for fname, src in sources.items():
    dst = os.path.join(FINAL, fname)
    ops = optimize(src, dst)
    manifest["files"][fname] = {"source": os.path.relpath(src, C.PACK_DIR), "src_mb": round(C.mb(src), 3),
                                "mb": round(C.mb(dst), 3), "nodes": sum(ops.values()),
                                "com_microsoft_ops": {k: v for k, v in sorted(ops.items()) if k.startswith("com.microsoft")}}
    C.log(f"  {fname:28s} {C.mb(src):8.2f} -> {C.mb(dst):8.2f} MB, {sum(ops.values())} nodes")

# 3d
if args.ort:
    shutil.rmtree(FINAL_ORT, ignore_errors=True)
    os.makedirs(FINAL_ORT)
    for fname in sources:
        tmp = os.path.join(FINAL_ORT, "_in", fname)
        os.makedirs(os.path.dirname(tmp), exist_ok=True)
        shutil.copy(sources[fname], tmp)
    subprocess.check_call([sys.executable, "-m", "onnxruntime.tools.convert_onnx_models_to_ort",
                           os.path.join(FINAL_ORT, "_in"), "--optimization_style", "Fixed", "--target_platform", "amd64"],
                          stdout=subprocess.DEVNULL)
    for fname in sources:
        o = fname.replace(".onnx", ".ort")
        shutil.move(os.path.join(FINAL_ORT, "_in", o), os.path.join(FINAL_ORT, o))
        manifest["files"][fname]["ort_mb"] = round(C.mb(os.path.join(FINAL_ORT, o)), 3)
    shutil.rmtree(os.path.join(FINAL_ORT, "_in"))
    C.log(f"  .ort files -> {FINAL_ORT}")

tot = sum(v["mb"] for v in manifest["files"].values())
manifest["total_mb"] = round(tot, 3)
json.dump(manifest, open(os.path.join(FINAL, "MANIFEST.json"), "w"), indent=2)
C.log(f"== done: {FINAL}  total download {tot:.2f} MB ==")
