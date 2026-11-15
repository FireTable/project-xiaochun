#!/usr/bin/env python3
"""
evaluate.py — Evaluates exported INT8 ONNX model (`public/models/duplex-turn/duplex-turn-zh-en-v1.int8.onnx`)
with calibrated temperature `T` from `manifest.json` across:
  1. `ASLP-lab/Easy-Turn-Testset` (ZH, 4 classes)
  2. `pipecat-ai/smart-turn-data-v3.2-test` (EN + ZH, COMPLETE / INCOMPLETE)
  3. Clean 15% stratified EN/CS Holdout (EN + CS, BACKCHANNEL / WAIT_INTERRUPT, zero speaker/phrase leakage)

Writes `public/models/duplex-turn/eval_report.json` with overall, per-dataset,
per-language (`ZH`, `EN`, `CS`), per-class Accuracy/F1, calibration ECE/NLL, and confusion matrices.
"""

from __future__ import annotations

import json
import time
from collections import defaultdict
from pathlib import Path

import numpy as np
import onnxruntime as ort
import soundfile as sf
from sklearn.metrics import accuracy_score, classification_report, confusion_matrix, f1_score
from transformers import WhisperFeatureExtractor

from model import (
    CLASSES,
    NUM_CLASSES,
    WHISPER_MAX_SAMPLES,
    WHISPER_SAMPLE_RATE,
    left_pad_or_tail_trim,
)

REPO_ROOT = Path(__file__).resolve().parents[2]
CACHE_ROOT = Path("/tmp/xc-duplex-turn-cache")
PREP_DIR = CACHE_ROOT / "prepared"
PUBLIC_MODEL_DIR = REPO_ROOT / "public" / "models" / "duplex-turn"
INT8_ONNX_PATH = PUBLIC_MODEL_DIR / "duplex-turn-zh-en-v1.int8.onnx"
MANIFEST_PATH = PUBLIC_MODEL_DIR / "manifest.json"
REPORT_PATH = PUBLIC_MODEL_DIR / "eval_report.json"


def load_jsonl(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


def softmax_with_temp(logits: np.ndarray, temp: float) -> np.ndarray:
    scaled = logits / max(1e-4, temp)
    scaled = scaled - scaled.max(axis=-1, keepdims=True)
    exps = np.exp(scaled)
    return exps / exps.sum(axis=-1, keepdims=True)


def expected_calibration_error(probs: np.ndarray, y_true: np.ndarray, n_bins: int = 10) -> float:
    conf = probs.max(axis=1)
    preds = probs.argmax(axis=1)
    acc = (preds == y_true).astype(np.float64)
    edges = np.linspace(0.0, 1.0, n_bins + 1)
    ece = 0.0
    for i in range(n_bins):
        lo, hi = edges[i], edges[i + 1]
        mask = (conf >= lo) & (conf <= hi if i == n_bins - 1 else conf < hi)
        if mask.any():
            ece += float(mask.mean()) * abs(float(acc[mask].mean()) - float(conf[mask].mean()))
    return round(ece, 5)


def run_onnx_inference(
    sess: ort.InferenceSession,
    rows: list[dict],
    fe: WhisperFeatureExtractor,
    temp: float,
    tag: str,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, float]:
    n = len(rows)
    all_logits = np.empty((n, NUM_CLASSES), dtype=np.float32)
    y_true = np.array([int(r["label_id"]) for r in rows], dtype=np.int64)

    t0 = time.time()
    batch_size = 32
    for start in range(0, n, batch_size):
        end = min(n, start + batch_size)
        waves = []
        for r in rows[start:end]:
            wav, sr = sf.read(r["wav_path"], dtype="float32")
            if wav.ndim == 2:
                wav = wav.mean(axis=1)
            assert sr == WHISPER_SAMPLE_RATE
            waves.append(left_pad_or_tail_trim(wav, WHISPER_MAX_SAMPLES))
        feats = fe(waves, sampling_rate=WHISPER_SAMPLE_RATE, return_tensors="np")["input_features"]
        logits = sess.run(["logits"], {"input_features": feats.astype(np.float32)})[0]
        all_logits[start:end] = logits
    elapsed = time.time() - t0
    ms_per_sample = (elapsed * 1000.0) / max(1, n)
    probs = softmax_with_temp(all_logits, temp)
    print(f"[Eval:{tag}] n={n}, elapsed={elapsed:.2f}s ({ms_per_sample:.2f} ms/clip)")
    return all_logits, probs, y_true, ms_per_sample


def compute_metrics(y_true: np.ndarray, probs: np.ndarray) -> dict:
    y_pred = probs.argmax(axis=1)
    present_ids = sorted(set(y_true.tolist()) | set(y_pred.tolist()))
    cm = confusion_matrix(y_true, y_pred, labels=list(range(NUM_CLASSES))).tolist()
    rep = classification_report(
        y_true,
        y_pred,
        labels=list(range(NUM_CLASSES)),
        target_names=CLASSES,
        output_dict=True,
        zero_division=0,
    )
    per_class = {}
    for cls in CLASSES:
        c_mask = y_true == CLASSES.index(cls)
        per_class[cls] = {
            "support": int(c_mask.sum()),
            "precision": round(float(rep[cls]["precision"]), 4),
            "recall": round(float(rep[cls]["recall"]), 4),
            "f1": round(float(rep[cls]["f1-score"]), 4),
            "accuracy": round(float((y_pred[c_mask] == y_true[c_mask]).mean()), 4) if c_mask.any() else None,
        }

    # Macro F1 over classes actually present in y_true so 2-class subsets report true present macro-F1 too
    gt_present = sorted(set(y_true.tolist()))
    macro_f1_present = float(f1_score(y_true, y_pred, labels=gt_present, average="macro", zero_division=0))

    return {
        "count": int(len(y_true)),
        "accuracy": round(float(accuracy_score(y_true, y_pred)), 4),
        "macroF1All4": round(float(rep["macro avg"]["f1-score"]), 4),
        "macroF1Present": round(macro_f1_present, 4),
        "weightedF1": round(float(rep["weighted avg"]["f1-score"]), 4),
        "ece": expected_calibration_error(probs, y_true),
        "perClass": per_class,
        "confusionMatrixLabels": CLASSES,
        "confusionMatrix": cm,
        "presentGroundTruthClasses": [CLASSES[i] for i in gt_present],
        "predictedClasses": [CLASSES[i] for i in present_ids],
    }


def main() -> None:
    if not INT8_ONNX_PATH.exists():
        raise FileNotFoundError(f"INT8 ONNX not found: {INT8_ONNX_PATH}")

    manifest = json.loads(MANIFEST_PATH.read_text())
    temperature = float(manifest.get("temperature", 1.0))

    opts = ort.SessionOptions()
    opts.intra_op_num_threads = 4
    sess = ort.InferenceSession(str(INT8_ONNX_PATH), sess_options=opts, providers=["CPUExecutionProvider"])
    fe = WhisperFeatureExtractor(chunk_length=8)

    datasets = {
        "easy_turn_test": load_jsonl(PREP_DIR / "easy_turn_test.jsonl"),
        "smart_turn_test": load_jsonl(PREP_DIR / "smart_turn_test.jsonl"),
        "holdout_en_cs": load_jsonl(PREP_DIR / "holdout_en_cs.jsonl"),
    }

    combined_probs: list[np.ndarray] = []
    combined_y: list[np.ndarray] = []
    combined_langs: list[str] = []
    per_dataset_report: dict[str, dict] = {}
    latency_ms: dict[str, float] = {}

    for name, rows in datasets.items():
        _, probs, y_true, ms_clip = run_onnx_inference(sess, rows, fe, temperature, name)
        latency_ms[name] = round(ms_clip, 2)
        metrics = compute_metrics(y_true, probs)

        # Also compute 2-class binary endpoint accuracy for smart-turn (argmax over COMPLETE/INCOMPLETE)
        if name == "smart_turn_test":
            ep_pred = np.argmax(probs[:, :2], axis=1)
            metrics["binaryEndpointAccuracy"] = round(float(accuracy_score(y_true, ep_pred)), 4)

        per_dataset_report[name] = metrics
        combined_probs.append(probs)
        combined_y.append(y_true)
        combined_langs.extend([r["lang"] for r in rows])

    all_probs = np.concatenate(combined_probs, axis=0)
    all_y = np.concatenate(combined_y, axis=0)
    overall_metrics = compute_metrics(all_y, all_probs)

    # Balanced macro-average across the 3 test benchmarks (unweighted mean of dataset accuracies)
    balanced_benchmark_acc = round(
        float(np.mean([per_dataset_report[k]["accuracy"] for k in datasets])),
        4,
    )

    by_language: dict[str, dict] = {}
    lang_indices: dict[str, list[int]] = defaultdict(list)
    for idx, lg in enumerate(combined_langs):
        lang_indices[lg].append(idx)

    for lg in sorted(lang_indices.keys()):
        idxs = np.array(lang_indices[lg], dtype=np.int64)
        by_language[lg] = compute_metrics(all_y[idxs], all_probs[idxs])

    report = {
        "modelFile": INT8_ONNX_PATH.name,
        "modelSizeMB": round(INT8_ONNX_PATH.stat().st_size / (1024 * 1024), 2),
        "temperature": temperature,
        "overall": overall_metrics,
        "balancedBenchmarkMeanAccuracy": balanced_benchmark_acc,
        "byLanguage": by_language,
        "datasets": per_dataset_report,
        "cpuOnnxBatchMsPerClip": latency_ms,
    }

    REPORT_PATH.write_text(json.dumps(report, indent=2) + "\n")
    print("\n=== INT8 ONNX Evaluation Report ===")
    print(f"Model: {report['modelFile']} ({report['modelSizeMB']} MB), T={temperature}")
    print(f"Overall Combined Acc: {overall_metrics['accuracy']:.4f} (n={overall_metrics['count']})")
    print(f"Balanced 3-Suite Mean Acc: {balanced_benchmark_acc:.4f}")
    for lg, m in by_language.items():
        print(f"  Lang {lg}: acc={m['accuracy']:.4f}, macroF1Present={m['macroF1Present']:.4f}, n={m['count']}")
    for ds, m in per_dataset_report.items():
        extra = f", binAcc={m['binaryEndpointAccuracy']:.4f}" if "binaryEndpointAccuracy" in m else ""
        print(f"  Suite {ds}: acc={m['accuracy']:.4f}, macroF1Present={m['macroF1Present']:.4f}, n={m['count']}{extra}")
    print(f"Report saved -> {REPORT_PATH}")


if __name__ == "__main__":
    main()
