#!/usr/bin/env python3
"""File sizes (MB = 1e6 bytes) and optional brotli -q9 sizes for the download set XiaoChun actually enables:
step + vq_upper_idx + vq_hands_idx + vq_lower_idx + postprocess (vqFace / vqGlobal are disabled in config.ts).

usage: python size_report.py [--brotli] [--json out/reports/sizes.json]
"""
import argparse, json, os, shutil, subprocess
import slim_common as C

ap = argparse.ArgumentParser()
ap.add_argument("--export-dir", default=C.default_export_dir())
ap.add_argument("--out-dir", default=C.DEFAULT_OUT)
ap.add_argument("--brotli", action="store_true", help="also compute brotli -q 9 size (needs the brotli CLI)")
ap.add_argument("--json", default=None)
a = ap.parse_args()
E = os.path.join(a.export_dir, "onnx")
O = a.out_dir

def br(path):
    if not a.brotli or not shutil.which("brotli"):
        return None
    p = subprocess.Popen(["brotli", "-q", "9", "-c", path], stdout=subprocess.PIPE)
    n = 0
    while True:
        b = p.stdout.read(1 << 20)
        if not b:
            break
        n += len(b)
    p.wait()
    return n / 1e6

def row(name, path):
    if not os.path.exists(path):
        return None
    return {"file": name, "mb": os.path.getsize(path) / 1e6, "brotli9_mb": br(path)}

sets = {
    "baseline FP32": [("emage_step.onnx", E), ("vq_upper_idx.onnx", E), ("vq_hands_idx.onnx", E), ("vq_lower_idx.onnx", E), ("postprocess.onnx", E)],
    "baseline INT8 (current)": [("emage_step_int8.onnx", E), ("vq_upper_idx_int8.onnx", E), ("vq_hands_idx_int8.onnx", E), ("vq_lower_idx_int8.onnx", E), ("postprocess_int8.onnx", E)],
    "step 1 (slim step INT8)": [("emage_step_slim_int8.onnx", O), ("vq_upper_idx_int8.onnx", E), ("vq_hands_idx_int8.onnx", E), ("vq_lower_idx_int8.onnx", E), ("postprocess_int8.onnx", E)],
    "step 1+2 (slim INT8 + conv INT8)": [("emage_step_slim_int8_convq.onnx", O), ("vq_upper_idx_int8_convq.onnx", O), ("vq_hands_idx_int8_convq.onnx", O), ("vq_lower_idx_int8_convq.onnx", O), ("postprocess_int8.onnx", E)],
}
cache = {}
report = {}
for sname, files in sets.items():
    rows, tot, totb = [], 0.0, 0.0
    for f, d in files:
        p = os.path.join(d, f)
        if p not in cache:
            cache[p] = row(f, p)
        r = cache[p]
        if r is None:
            rows = None; break
        rows.append(r); tot += r["mb"]; totb += r["brotli9_mb"] or 0
    if rows is None:
        print(f"[skip] {sname}: missing files"); continue
    report[sname] = {"files": rows, "total_mb": tot, "total_brotli9_mb": totb if a.brotli else None}
    print(f"\n{sname}")
    for r in rows:
        print(f"  {r['file']:36s} {r['mb']:9.2f} MB" + (f"   brotli-q9 {r['brotli9_mb']:8.2f} MB" if r["brotli9_mb"] else ""))
    print(f"  {'TOTAL':36s} {tot:9.2f} MB" + (f"   brotli-q9 {totb:8.2f} MB" if a.brotli else ""))
if a.json:
    os.makedirs(os.path.dirname(a.json), exist_ok=True)
    json.dump(report, open(a.json, "w"), indent=2)
