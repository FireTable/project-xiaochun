#!/usr/bin/env python3
"""Error of each INT8 variant against the FP32 slim model (the truth), python onnxruntime CPU.
Reports mean relative L2 of cls_* logits and top-1 agreement over several windows of several clips.
usage: python tools_vs_fp32.py [--windows 4]  (needs out/emage_step_slim.onnx, out/clips/*.wav)
"""
import argparse, glob, os, wave
import numpy as np
import onnxruntime as ort
import slim_common as C

ap = argparse.ArgumentParser(); ap.add_argument("--windows", type=int, default=4)
ap.add_argument("--out-dir", default=C.DEFAULT_OUT); a = ap.parse_args()
so = ort.SessionOptions(); so.log_severity_level = 3
files = {
    "fp32 slim (truth)": "emage_step_slim.onnx",
    "step1 int8": "emage_step_slim_int8.onnx",
    "step1+2 int8 + conv int8": "emage_step_slim_int8_convq.onnx",
    "step1 int8 + conv fp16 (re-roll floor)": "var/step_all_fp16.onnx",
    "step1 int8 + ConvInteger (experimental)": "var/step_convinteger.onnx",
}
S = {k: ort.InferenceSession(os.path.join(a.out_dir, f), so, providers=["CPUExecutionProvider"])
     for k, f in files.items() if os.path.exists(os.path.join(a.out_dir, f))}
res = {k: {"rel": [], "top1": []} for k in S}
for clip in sorted(glob.glob(os.path.join(a.out_dir, "clips", "*.wav"))):
    w = wave.open(clip); x = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768
    for wi in range(min(a.windows, len(x) // C.WINDOW_AUDIO_LEN)):
        mm = np.zeros((1, 64, 337), np.float32); mask = np.ones((1, 64, 337), np.float32)   # first-window style input
        f = {"audio": x[wi * C.WINDOW_AUDIO_LEN:(wi + 1) * C.WINDOW_AUDIO_LEN][None], "speaker_id": np.zeros((1, 1), np.int64),
             "masked_motion": mm, "mask": mask}
        o = {k: s.run(None, f) for k, s in S.items()}
        ref = o["fp32 slim (truth)"]
        for k in S:
            res[k]["rel"].append(np.mean([np.linalg.norm(p - q) / np.linalg.norm(q) for p, q in zip(o[k], ref)]))
            res[k]["top1"].append(np.mean([(p.argmax(-1) == q.argmax(-1)).mean() for p, q in zip(o[k], ref)]))
n = len(res["fp32 slim (truth)"]["rel"])
print(f"windows evaluated: {n}")
for k, v in res.items():
    print(f"{k:42s} relL2={np.mean(v['rel']):.4f}  top1 agree vs fp32={np.mean(v['top1']):.3f}")
