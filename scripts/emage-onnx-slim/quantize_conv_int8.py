#!/usr/bin/env python3
"""STEP 2: store the remaining FP32 Conv weights as INT8 (weight-only, per-output-channel, symmetric).

README `--quantize` only quantizes MatMul (dynamic). Every Conv (audio_encoder_body, motion_encoder in the step
model; all decoder convs in vq_*_idx) stays FP32 and is ~30% of the INT8 step file.

mode "dq" (default, recommended): Conv.weight -> int8 initializer + per-channel fp32 scale -> DequantizeLinear(axis=0)
    -> Conv. Activations stay FP32, so error is only weight rounding. ORT constant-folds the DequantizeLinear at
    session creation, so runtime speed and RAM are the same as before; only the DOWNLOAD shrinks.
mode "fp16": store Conv weights as fp16 + Cast (2x smaller, no per-channel scales; near-lossless in practice).
mode "convinteger" (experimental): onnxruntime quantize_dynamic(op_types_to_quantize=["Conv"]) -> ConvInteger
    (activations are quantized too). Kept for comparison only.

Usage:
    python quantize_conv_int8.py IN.onnx OUT.onnx [--mode dq|convinteger] [--min-params 1024]
    python quantize_conv_int8.py --all   # step slim int8 + vq_upper/hands/lower_idx_int8 -> out/*_convq.onnx
"""
import argparse
import os
import re
import sys

import numpy as np
import onnx
from onnx import helper, numpy_helper, TensorProto

import slim_common as C


def quantize_conv_dq(in_path, out_path, min_params=1024, include=None, fp16=False):
    m = onnx.load(in_path)
    g = m.graph
    init = {i.name: i for i in g.initializer}
    consumers = {}
    for n in g.node:
        for i in n.input:
            consumers.setdefault(i, []).append(n)
    new_nodes = []
    done, saved_f32, added = 0, 0, 0
    for n in list(g.node):
        if n.op_type != "Conv" or n.input[1] not in init:
            continue
        wname = n.input[1]
        if include and not re.search(include, n.name):
            continue
        if len(consumers.get(wname, [])) != 1:          # shared weight: skip to stay safe
            continue
        w = numpy_helper.to_array(init[wname]).astype(np.float32)
        if w.size < min_params:
            continue
        if fp16:  # storage-only fp16 + Cast back to fp32 (folded by ORT at load)
            hn, fn = wname + "_f16", wname + "_f16_cast"
            g.initializer.append(numpy_helper.from_array(w.astype(np.float16), hn))
            g.node.insert(list(g.node).index(n), helper.make_node("Cast", [hn], [fn], to=TensorProto.FLOAT, name=n.name + "_wcast"))
            n.input[1] = fn
            g.initializer.remove(init[wname])
            saved_f32 += w.size * 4
            added += w.size * 2
            done += 1
            continue
        flat = w.reshape(w.shape[0], -1)
        scale = np.abs(flat).max(axis=1) / 127.0
        scale[scale == 0] = 1.0
        q = np.clip(np.round(flat / scale[:, None]), -127, 127).astype(np.int8).reshape(w.shape)
        qn, sn, dn = wname + "_q8", wname + "_q8_scale", wname + "_dq"
        g.initializer.append(numpy_helper.from_array(q, qn))
        g.initializer.append(numpy_helper.from_array(scale.astype(np.float32), sn))
        dq = helper.make_node("DequantizeLinear", [qn, sn], [dn], axis=0, name=n.name + "_wdq")
        idx = list(g.node).index(n)
        g.node.insert(idx, dq)
        n.input[1] = dn
        g.initializer.remove(init[wname])
        saved_f32 += w.size * 4
        added += q.size + scale.size * 4
        done += 1
    # DequantizeLinear needs opset >= 13 (axis attribute); models are opset 17.
    assert m.opset_import[0].version >= 13
    onnx.save(m, out_path)
    return done, saved_f32 / 1e6, added / 1e6


def quantize_conv_dynamic(in_path, out_path):
    from onnxruntime.quantization import quantize_dynamic, QuantType
    quantize_dynamic(in_path, out_path, weight_type=QuantType.QUInt8, op_types_to_quantize=["Conv"])
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("inp", nargs="?")
    ap.add_argument("out", nargs="?")
    ap.add_argument("--mode", default="dq", choices=["dq", "fp16", "convinteger"])
    ap.add_argument("--include", default=None, help="regex on Conv node name (e.g. audio_encoder_body|motion_encoder)")
    ap.add_argument("--min-params", type=int, default=1024)
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--export-dir", default=C.default_export_dir())
    ap.add_argument("--out-dir", default=C.DEFAULT_OUT)
    ap.add_argument("--suffix", default="_convq")
    a = ap.parse_args()

    jobs = []
    if a.all:
        jobs.append((os.path.join(a.out_dir, "emage_step_slim_int8.onnx"),
                     os.path.join(a.out_dir, f"emage_step_slim_int8{a.suffix}.onnx")))
        for part in ("upper", "hands", "lower"):
            jobs.append((os.path.join(a.export_dir, "onnx", f"vq_{part}_idx_int8.onnx"),
                         os.path.join(a.out_dir, f"vq_{part}_idx_int8{a.suffix}.onnx")))
    else:
        if not (a.inp and a.out):
            ap.error("IN.onnx OUT.onnx required (or --all)")
        jobs.append((a.inp, a.out))

    os.makedirs(a.out_dir, exist_ok=True)
    for src, dst in jobs:
        if a.mode in ("dq", "fp16"):
            n, saved, added = quantize_conv_dq(src, dst, a.min_params, a.include, fp16=(a.mode == "fp16"))
            C.log(f"{os.path.basename(src)}: {C.mb(src):.2f} MB -> {C.mb(dst):.2f} MB "
                  f"({n} Conv weights, fp32 {saved:.2f} MB -> int8+scales {added:.2f} MB)")
        else:
            quantize_conv_dynamic(src, dst)
            C.log(f"{os.path.basename(src)}: {C.mb(src):.2f} MB -> {C.mb(dst):.2f} MB (ConvInteger)")


if __name__ == "__main__":
    main()
