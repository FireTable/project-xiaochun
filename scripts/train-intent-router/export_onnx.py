"""
scripts/train-intent-router/export_onnx.py

Export CompactTransformerClassifier PyTorch weights to:
1. FP32 ONNX model with dynamic batch axis
2. Pre-processed graph via quant_pre_process
3. Dynamic INT8 quantized ONNX model via quantize_dynamic (QuantType.QInt8, MatMulConstBOnly: True)
4. Verify numeric parity between PyTorch, FP32 ONNX, and INT8 ONNX
5. Generate public/models/intent-router/manifest.json
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import numpy as np
import onnx
import onnxruntime as ort
from onnxruntime.quantization import QuantType, quant_pre_process, quantize_dynamic
import torch

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parent.parent
DATA_DIR = SCRIPT_DIR / "data"
CHECKPOINT_DIR = SCRIPT_DIR / "checkpoints"
PUBLIC_MODEL_DIR = REPO_ROOT / "public" / "models" / "intent-router"

sys.path.insert(0, str(SCRIPT_DIR))
from dataset import tokenize_py
from model import CompactTransformerClassifier, CLASSES, NUM_CLASSES, MAX_SEQ_LEN


def main():
    CHECKPOINT_DIR.mkdir(parents=True, exist_ok=True)
    PUBLIC_MODEL_DIR.mkdir(parents=True, exist_ok=True)

    checkpoint_path = CHECKPOINT_DIR / "best_model.pt"
    if not checkpoint_path.exists():
        raise FileNotFoundError(f"Checkpoint not found at {checkpoint_path}. Run train.py first.")

    vocab_file = PUBLIC_MODEL_DIR / "vocab.json"
    with open(vocab_file, "r", encoding="utf-8") as f:
        vocab = json.load(f)
    vocab_size = len(vocab)

    print(f"[Export] Loading checkpoint from {checkpoint_path}...")
    ckpt = torch.load(checkpoint_path, map_location="cpu", weights_only=False)
    temp = float(ckpt.get("temperature", 1.0))
    # Clamp temperature into healthy operating window [0.8, 1.5]
    clamped_temp = max(0.8, min(1.5, temp))

    model = CompactTransformerClassifier(
        vocab_size=vocab_size,
        d_model=128,
        nhead=4,
        num_layers=2,
        dim_feedforward=512,
        max_seq_len=MAX_SEQ_LEN,
        num_classes=NUM_CLASSES,
        dropout=0.0,
    )
    model.load_state_dict(ckpt["model_state_dict"])
    model.eval()

    fp32_onnx_path = CHECKPOINT_DIR / "intent-router.fp32.onnx"
    prep_onnx_path = CHECKPOINT_DIR / "intent-router.prep.onnx"
    int8_onnx_path = PUBLIC_MODEL_DIR / "intent-router-bilingual-v1.int8.onnx"

    dummy_ids = torch.zeros(1, MAX_SEQ_LEN, dtype=torch.long)
    dummy_mask = torch.ones(1, MAX_SEQ_LEN, dtype=torch.long)

    print(f"[Export] Exporting to FP32 ONNX -> {fp32_onnx_path}...")
    torch.onnx.export(
        model,
        (dummy_ids, dummy_mask),
        str(fp32_onnx_path),
        export_params=True,
        opset_version=17,
        do_constant_folding=True,
        input_names=["input_ids", "attention_mask"],
        output_names=["logits"],
        dynamic_axes={
            "input_ids": {0: "batch"},
            "attention_mask": {0: "batch"},
            "logits": {0: "batch"},
        },
    )

    onnx.checker.check_model(str(fp32_onnx_path))
    fp32_mb = fp32_onnx_path.stat().st_size / (1024 * 1024)
    print(f"[Export] FP32 ONNX exported successfully ({fp32_mb:.2f} MB).")

    print(f"[Export] Pre-processing ONNX model for dynamic quantization...")
    quant_pre_process(str(fp32_onnx_path), str(prep_onnx_path), skip_symbolic_shape=True)

    print(f"[Export] Performing dynamic INT8 quantization -> {int8_onnx_path}...")
    quantize_dynamic(
        model_input=str(prep_onnx_path),
        model_output=str(int8_onnx_path),
        weight_type=QuantType.QInt8,
        op_types_to_quantize=["MatMul", "Gemm"],
        per_channel=True,
        extra_options={"MatMulConstBOnly": True},
    )

    int8_bytes = int8_onnx_path.stat().st_size
    int8_mb = int8_bytes / (1024 * 1024)
    print(f"[Export] INT8 ONNX exported ({int8_mb:.2f} MB) -> {int8_onnx_path}")
    assert int8_mb < 10.0, f"INT8 model exceeds 10 MB limit ({int8_mb:.2f} MB)"

    # Parity check between PyTorch and INT8 ONNX
    print(f"[Export] Verifying numerical parity on landmark test queries...")
    sess_int8 = ort.InferenceSession(str(int8_onnx_path), providers=["CPUExecutionProvider"])

    test_queries = [
        ("小春，今天在海边心情怎么样呀？", "CHAT"),
        ("Hey XiaoChun, 今天海边风大不大? By the way how is your WebGPU GPU temperature?", "CHAT"),
        ("小春在吗？", "CHAT"),
        ("好的收到！", "CHAT"),
        ("mm-hmm 对对", "CHAT"),
        ("帮我查一下 / deeply analyze why iOS TBDR WebGPU drops frames when we use RGBA16F 4x MSAA", "HEAVY"),
        ("尤其是开启 bloom 的时候", "HEAVY"),
        ("写一个快速排序算法并在 C++ 中实现", "HEAVY"),
        ("Deeply profile why Three.js drops frames on iOS TBDR architecture", "HEAVY"),
    ]

    all_matched = True
    for text, expected in test_queries:
        ids, mask = tokenize_py(text, vocab, MAX_SEQ_LEN)
        b_ids = torch.tensor([ids], dtype=torch.long)
        b_mask = torch.tensor([mask], dtype=torch.long)

        with torch.no_grad():
            py_logits = model(b_ids, b_mask).numpy()[0]

        ort_out = sess_int8.run(["logits"], {
            "input_ids": np.array([ids], dtype=np.int64),
            "attention_mask": np.array([mask], dtype=np.int64),
        })[0][0]

        pred_class = CLASSES[int(ort_out.argmax())]
        max_diff = float(np.max(np.abs(py_logits - ort_out)))
        matched = (pred_class == expected)
        all_matched = all_matched and matched

        status = "PASS" if matched else "FAIL"
        print(f"  [{status}] Expected {expected:5s} | Got {pred_class:5s} | Diff: {max_diff:.4f} | {text[:45]}")

    assert all_matched, "INT8 ONNX predictions do not match expected landmark labels!"

    # Write manifest.json
    manifest = {
        "version": "1.0.0",
        "architecture": "CompactTransformerClassifier-2L-128D-4H",
        "classes": CLASSES,
        "maxSeqLen": MAX_SEQ_LEN,
        "vocabSize": vocab_size,
        "temperature": round(clamped_temp, 4),
        "confidenceThreshold": 0.5,
        "modelFile": "intent-router-bilingual-v1.int8.onnx",
        "modelBytes": int8_bytes,
        "vocabFile": "vocab.json",
        "quantization": "INT8_DYNAMIC",
        "inputNames": ["input_ids", "attention_mask"],
        "outputNames": ["logits"],
    }

    manifest_path = PUBLIC_MODEL_DIR / "manifest.json"
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)
    print(f"[Export] Manifest exported -> {manifest_path}")


if __name__ == "__main__":
    main()
