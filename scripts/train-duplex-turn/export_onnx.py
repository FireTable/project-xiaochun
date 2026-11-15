#!/usr/bin/env python3
"""
export_onnx.py — Exports trained `WhisperTurnClassifier` to FP32 ONNX, applies
dynamic INT8 quantization -> `public/models/duplex-turn/duplex-turn-zh-en-v1.int8.onnx`
(target ~8-12 MB), writes `manifest.json`, and generates `mel_reference.json`
(`~100-250 KB`) from HuggingFace `WhisperFeatureExtractor`.
"""

from __future__ import annotations

import json
import math
import shutil
from pathlib import Path

import numpy as np
import onnx
import onnxruntime as ort
import torch
from onnxruntime.quantization import QuantType, quantize_dynamic
from onnxruntime.quantization.shape_inference import quant_pre_process
from transformers import WhisperFeatureExtractor

from model import (
    CLASSES,
    WHISPER_MAX_SAMPLES,
    WHISPER_N_FRAMES,
    WHISPER_N_MELS,
    WHISPER_SAMPLE_RATE,
    WhisperTurnClassifier,
    left_pad_or_tail_trim,
)

REPO_ROOT = Path(__file__).resolve().parents[2]
CACHE_ROOT = Path("/tmp/xc-duplex-turn-cache")
CKPT_PATH = CACHE_ROOT / "checkpoints" / "best_model.pt"
FP32_ONNX_PATH = CACHE_ROOT / "checkpoints" / "duplex-turn-zh-en-v1.fp32.onnx"

PUBLIC_MODEL_DIR = REPO_ROOT / "public" / "models" / "duplex-turn"
INT8_ONNX_PATH = PUBLIC_MODEL_DIR / "duplex-turn-zh-en-v1.int8.onnx"
MANIFEST_PATH = PUBLIC_MODEL_DIR / "manifest.json"
MEL_REF_PATH = REPO_ROOT / "src" / "live" / "turn" / "__tests__" / "fixtures" / "mel_reference.json"


def generate_mel_reference(fe: WhisperFeatureExtractor) -> None:
    """
    Creates compact (~150-220 KB) `mel_reference.json` containing 3 deterministic
    test waveforms (short left-pad, medium speech-like, >8.0s tail-trimmed) +
    summary stats, boundary frames [0,1,2,399,797,798,799], and 240 sampled
    points computed with HuggingFace `WhisperFeatureExtractor(chunk_length=8)`.
    """
    MEL_REF_PATH.parent.mkdir(parents=True, exist_ok=True)
    rng = np.random.default_rng(12345)

    # Case 1: 0.35s (5,600 samples) direct raw waveform -> heavy left-zero-padding
    t1 = np.arange(5600, dtype=np.float32) / WHISPER_SAMPLE_RATE
    env1 = np.hanning(5600).astype(np.float32)
    w1 = (env1 * (0.32 * np.sin(2 * np.pi * 310 * t1) + 0.14 * np.sin(2 * np.pi * 920 * t1) + 0.02 * rng.standard_normal(5600))).astype(np.float32)
    w1_compact = [round(float(v), 5) for v in w1]

    # Case 2: 0.70s (11,200 samples) multi-harmonic + noise -> medium left-zero-padding + right edge energy
    t2 = np.arange(11200, dtype=np.float32) / WHISPER_SAMPLE_RATE
    w2 = (0.28 * np.sin(2 * np.pi * (180 + 260 * t2) * t2) + 0.12 * np.cos(2 * np.pi * 1350 * t2) + 0.015 * rng.standard_normal(11200)).astype(np.float32)
    w2_compact = [round(float(v), 5) for v in w2]

    # Case 3: 8.20s (131,200 samples > 128,000) deterministic multi-tone chirp formula -> tests tail-trim & full 800 frames
    n3 = 131200
    idx3 = np.arange(n3, dtype=np.float64)
    w3 = (
        0.24 * np.sin(2.0 * math.pi * 240.0 * idx3 / WHISPER_SAMPLE_RATE)
        + 0.14 * np.cos(2.0 * math.pi * 680.0 * idx3 / WHISPER_SAMPLE_RATE)
        + 0.08 * np.sin(2.0 * math.pi * 1950.0 * idx3 / WHISPER_SAMPLE_RATE)
    ).astype(np.float32)

    cases_raw = [
        {
            "name": "short_0_35s_left_pad",
            "length": int(w1.size),
            "encoding": "samples",
            "samples": w1_compact,
            "raw": np.array(w1_compact, dtype=np.float32),
        },
        {
            "name": "medium_0_70s_chirp",
            "length": int(w2.size),
            "encoding": "samples",
            "samples": w2_compact,
            "raw": np.array(w2_compact, dtype=np.float32),
        },
        {
            "name": "long_8_20s_tail_trim",
            "length": n3,
            "encoding": "harmonic_formula",
            "formula": {
                "sampleRate": WHISPER_SAMPLE_RATE,
                "length": n3,
                "terms": [
                    {"fn": "sin", "amp": 0.24, "freqHz": 240.0},
                    {"fn": "cos", "amp": 0.14, "freqHz": 680.0},
                    {"fn": "sin", "amp": 0.08, "freqHz": 1950.0},
                ],
            },
            "raw": w3,
        },
    ]

    boundary_indices = [0, 1, 2, 399, 760, 797, 798, 799]
    out_cases = []
    for c in cases_raw:
        padded = left_pad_or_tail_trim(c["raw"], WHISPER_MAX_SAMPLES)
        mel = fe(padded, sampling_rate=WHISPER_SAMPLE_RATE, return_tensors="np")["input_features"][0]  # (80, 800)

        boundary_frames = {
            str(t): [round(float(v), 6) for v in mel[:, t]] for t in boundary_indices
        }

        sample_pts = []
        pt_rng = np.random.default_rng(777)
        for _ in range(240):
            m = int(pt_rng.integers(0, WHISPER_N_MELS))
            t = int(pt_rng.integers(0, WHISPER_N_FRAMES))
            sample_pts.append([m, t, round(float(mel[m, t]), 6)])

        entry = {
            "name": c["name"],
            "length": c["length"],
            "encoding": c["encoding"],
            "summary": {
                "min": round(float(mel.min()), 6),
                "max": round(float(mel.max()), 6),
                "mean": round(float(mel.mean()), 6),
                "std": round(float(mel.std()), 6),
                "l2Norm": round(float(np.linalg.norm(mel)), 5),
            },
            "boundaryFrames": boundary_frames,
            "sampledPoints": sample_pts,
        }
        if c["encoding"] == "samples":
            entry["samples"] = c["samples"]
        else:
            entry["formula"] = c["formula"]
        out_cases.append(entry)

    payload = {
        "sampleRate": WHISPER_SAMPLE_RATE,
        "maxSamples": WHISPER_MAX_SAMPLES,
        "nMels": WHISPER_N_MELS,
        "nFrames": WHISPER_N_FRAMES,
        "paddingSide": "left",
        "cases": out_cases,
    }
    text = json.dumps(payload, separators=(",", ":"))
    MEL_REF_PATH.write_text(text)
    kb = len(text.encode("utf-8")) / 1024.0
    print(f"[MelReference] Wrote {MEL_REF_PATH} ({kb:.1f} KB)")


def main() -> None:
    if not CKPT_PATH.exists():
        raise FileNotFoundError(f"Checkpoint not found: {CKPT_PATH}. Run train.py first.")

    PUBLIC_MODEL_DIR.mkdir(parents=True, exist_ok=True)
    ckpt = torch.load(CKPT_PATH, map_location="cpu", weights_only=True)
    temperature = float(ckpt.get("temperature", 1.0))

    model = WhisperTurnClassifier("openai/whisper-tiny", dropout=0.15)
    model.load_state_dict(ckpt["model_state_dict"])
    model.eval()

    dummy_input = torch.randn(1, WHISPER_N_MELS, WHISPER_N_FRAMES, dtype=torch.float32)
    with torch.no_grad():
        torch_out = model(dummy_input).numpy()

    torch.onnx.export(
        model,
        dummy_input,
        str(FP32_ONNX_PATH),
        export_params=True,
        opset_version=17,
        do_constant_folding=True,
        input_names=["input_features"],
        output_names=["logits"],
        dynamic_axes={"input_features": {0: "batch"}, "logits": {0: "batch"}},
        dynamo=False,
    )
    onnx.checker.check_model(str(FP32_ONNX_PATH))
    fp32_mb = FP32_ONNX_PATH.stat().st_size / (1024 * 1024)
    print(f"[Export] FP32 ONNX saved ({fp32_mb:.2f} MB) -> {FP32_ONNX_PATH}")

    # Pre-process & dynamically quantize INT8; automatically keeps at most the single most
    # sensitive Whisper MLP fc2 down-projection in FP32 (~11.3 MB) when activation outliers occur.
    prep_path = CACHE_ROOT / "checkpoints" / "duplex-turn-zh-en-v1.prep.onnx"
    quant_pre_process(str(FP32_ONNX_PATH), str(prep_path), skip_symbolic_shape=True)
    prep_model = onnx.load(str(prep_path))
    mm_nodes = [n.name for n in prep_model.graph.node if n.op_type in ("MatMul", "Gemm")]

    val_mel_path = CACHE_ROOT / "prepared" / "mel_cache" / "val_mel_f16.npy"
    if val_mel_path.exists():
        val_arr = np.load(str(val_mel_path), mmap_mode="r")
        step = max(1, len(val_arr) // 160)
        cal_x = np.array(val_arr[::step][:160], dtype=np.float32)
    else:
        cal_x = np.random.default_rng(0).standard_normal((16, WHISPER_N_MELS, WHISPER_N_FRAMES), dtype=np.float32)

    sess_fp32_cal = ort.InferenceSession(str(FP32_ONNX_PATH), providers=["CPUExecutionProvider"])
    fp32_cal_logits = np.concatenate(
        [sess_fp32_cal.run(["logits"], {"input_features": cal_x[i : i + 32]})[0] for i in range(0, len(cal_x), 32)],
        axis=0,
    )
    fp32_cal_preds = fp32_cal_logits.argmax(axis=1)

    candidates: list[tuple[str, list[str]]] = [("all_int8", [])]
    for layer_idx in range(4):
        excl = [n for n in mm_nodes if f"layers.{layer_idx}/fc2" in n]
        if excl:
            candidates.append((f"excl_L{layer_idx}fc2", excl))

    best_tuple: tuple[float, float, str, Path] | None = None
    tmp_cand_dir = CACHE_ROOT / "checkpoints" / "quant_candidates"
    tmp_cand_dir.mkdir(parents=True, exist_ok=True)
    for cname, excl in candidates:
        cand_path = tmp_cand_dir / f"{cname}.onnx"
        quantize_dynamic(
            model_input=str(prep_path),
            model_output=str(cand_path),
            weight_type=QuantType.QInt8,
            op_types_to_quantize=["MatMul", "Gemm"],
            per_channel=True,
            nodes_to_exclude=excl,
            extra_options={"MatMulConstBOnly": True},
        )
        qsess = ort.InferenceSession(str(cand_path), providers=["CPUExecutionProvider"])
        q_logits = np.concatenate(
            [qsess.run(["logits"], {"input_features": cal_x[i : i + 32]})[0] for i in range(0, len(cal_x), 32)],
            axis=0,
        )
        agree = float((q_logits.argmax(axis=1) == fp32_cal_preds).mean())
        mse = float(np.mean((fp32_cal_logits - q_logits) ** 2))
        mb = cand_path.stat().st_size / (1024 * 1024)
        print(f"  [QuantSelect] {cname:12s} ({mb:5.2f} MB) -> fp32_agree={agree:.4f}, logit_mse={mse:.5f}")
        score = (agree, -mse)
        if cname == "all_int8" and agree >= 0.994 and mse <= 0.02:
            best_tuple = (agree, -mse, cname, cand_path)
            break
        if best_tuple is None or score > (best_tuple[0], best_tuple[1]):
            best_tuple = (agree, -mse, cname, cand_path)

    assert best_tuple is not None
    shutil.copy2(best_tuple[3], INT8_ONNX_PATH)
    shutil.rmtree(tmp_cand_dir, ignore_errors=True)
    int8_bytes = INT8_ONNX_PATH.stat().st_size
    int8_mb = int8_bytes / (1024 * 1024)
    print(f"[Export] Selected {best_tuple[2]} -> INT8 ONNX saved ({int8_mb:.2f} MB) -> {INT8_ONNX_PATH}")

    # Verify numerical parity between PyTorch, FP32 ONNX, and INT8 ONNX
    sess_fp32 = ort.InferenceSession(str(FP32_ONNX_PATH), providers=["CPUExecutionProvider"])
    sess_int8 = ort.InferenceSession(str(INT8_ONNX_PATH), providers=["CPUExecutionProvider"])
    fp32_out = sess_fp32.run(["logits"], {"input_features": dummy_input.numpy()})[0]
    int8_out = sess_int8.run(["logits"], {"input_features": dummy_input.numpy()})[0]
    print(f"[Parity] PyTorch vs FP32 ONNX max diff: {np.max(np.abs(torch_out - fp32_out)):.6f}")
    print(f"[Parity] FP32 vs INT8 ONNX max diff:    {np.max(np.abs(fp32_out - int8_out)):.6f}")

    manifest = {
        "version": "1.0.0",
        "backbone": "openai/whisper-tiny-encoder-8s",
        "classes": CLASSES,
        "temperature": round(temperature, 6),
        "inputShape": [1, WHISPER_N_MELS, WHISPER_N_FRAMES],
        "sampleRate": WHISPER_SAMPLE_RATE,
        "windowSeconds": 8.0,
        "maxSamples": WHISPER_MAX_SAMPLES,
        "paddingSide": "left",
        "modelFile": INT8_ONNX_PATH.name,
        "modelBytes": int8_bytes,
    }
    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"[Export] Manifest written -> {MANIFEST_PATH}")

    fe = WhisperFeatureExtractor(chunk_length=8)
    generate_mel_reference(fe)


if __name__ == "__main__":
    main()
