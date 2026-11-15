#!/usr/bin/env python3
"""
train.py — Fine-tunes `WhisperTurnClassifier` (`openai/whisper-tiny` encoder + Attention Pooling)
on Apple M1 Ultra `mps` with cosine LR schedule, class-weighted label-smoothed Focal/CE loss,
SpecAugment + mel floor/shift augmentation, and post-hoc Temperature Scaling `T`.
"""

from __future__ import annotations

import argparse
import json
import math
import time
from collections import Counter
from pathlib import Path

import numpy as np
import soundfile as sf
import torch
import torch.nn as nn
import torch.nn.functional as F
from sklearn.metrics import accuracy_score, f1_score
from torch.utils.data import DataLoader, Dataset
from transformers import WhisperFeatureExtractor

from model import (
    CLASSES,
    NUM_CLASSES,
    WHISPER_MAX_SAMPLES,
    WHISPER_N_FRAMES,
    WHISPER_N_MELS,
    WHISPER_SAMPLE_RATE,
    WhisperTurnClassifier,
    left_pad_or_tail_trim,
)

CACHE_ROOT = Path("/tmp/xc-duplex-turn-cache")
PREP_DIR = CACHE_ROOT / "prepared"
CKPT_DIR = CACHE_ROOT / "checkpoints"


def load_jsonl(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


def build_or_load_mel_cache(rows: list[dict], cache_name: str, fe: WhisperFeatureExtractor) -> np.ndarray:
    """Extracts and caches `[N, 80, 800]` float16 log-mel features via HuggingFace WhisperFeatureExtractor."""
    mel_dir = PREP_DIR / "mel_cache"
    mel_dir.mkdir(parents=True, exist_ok=True)
    npy_path = mel_dir / f"{cache_name}_mel_f16.npy"
    meta_path = mel_dir / f"{cache_name}_meta.json"

    if npy_path.exists() and meta_path.exists():
        meta = json.loads(meta_path.read_text())
        if meta.get("n") == len(rows) and meta.get("first_id") == (rows[0]["id"] if rows else None):
            arr = np.load(str(npy_path), mmap_mode="r")
            print(f"[MelCache] Loaded cached {cache_name}: shape={arr.shape}")
            return np.array(arr, dtype=np.float16)

    t0 = time.time()
    n = len(rows)
    out = np.empty((n, WHISPER_N_MELS, WHISPER_N_FRAMES), dtype=np.float16)
    batch_size = 64
    for start in range(0, n, batch_size):
        end = min(n, start + batch_size)
        waves = []
        for r in rows[start:end]:
            wav, sr = sf.read(r["wav_path"], dtype="float32")
            if wav.ndim == 2:
                wav = wav.mean(axis=1)
            if sr != WHISPER_SAMPLE_RATE:
                raise ValueError(f"Unexpected sr {sr} in {r['wav_path']}")
            waves.append(left_pad_or_tail_trim(wav, WHISPER_MAX_SAMPLES))
        feats = fe(waves, sampling_rate=WHISPER_SAMPLE_RATE, return_tensors="np")["input_features"]
        out[start:end] = feats.astype(np.float16)
        if end % 2048 == 0 or end == n:
            print(f"  [MelCache:{cache_name}] {end}/{n} ({time.time() - t0:.1f}s)")

    np.save(str(npy_path), out)
    meta_path.write_text(json.dumps({"n": n, "first_id": rows[0]["id"] if rows else None}))
    return out


class CachedMelDataset(Dataset):
    def __init__(self, mels: np.ndarray, labels: list[int], train: bool = False) -> None:
        self.mels = mels
        self.labels = np.asarray(labels, dtype=np.int64)
        self.train = train

    def __len__(self) -> int:
        return len(self.labels)

    def __getitem__(self, idx: int) -> tuple[torch.Tensor, int]:
        x = np.array(self.mels[idx], dtype=np.float32)
        if self.train:
            floor_val = float(x.min())
            # 1. Crisp end-alignment jitter (shift left by 1..10 frames = 10..100ms trailing silence)
            if np.random.random() < 0.42:
                shift = int(np.random.randint(1, 11))
                shifted = np.empty_like(x)
                shifted[:, :-shift] = x[:, shift:]
                shifted[:, -shift:] = floor_val
                x = shifted

            # 2. Mild microphone gain jitter (train_norm already spans RMS 0.022..0.165)
            if np.random.random() < 0.45:
                delta = float(np.random.uniform(-0.15, 0.15))
                x = np.clip(x + delta, -1.5, 2.2)
                floor_val = float(x.min())

            # 3. SpecAugment strictly within active speech (never paint gray stripes over left silence pad)
            if np.random.random() < 0.65:
                col_peak = x.max(axis=0)
                active_cols = np.flatnonzero(col_peak > floor_val + 0.12)
                active_start = int(active_cols[0]) if active_cols.size > 0 else WHISPER_N_FRAMES - 60
                active_end = WHISPER_N_FRAMES - 24
                active_span = active_end - active_start

                for _ in range(2):
                    f_w = int(np.random.randint(1, 9))
                    f0 = int(np.random.randint(0, WHISPER_N_MELS - f_w))
                    x[f0 : f0 + f_w, active_start:] = floor_val

                if active_span > 16:
                    n_tmasks = 2 if active_span >= 45 else 1
                    max_tw = max(4, min(28, active_span // 5))
                    for _ in range(n_tmasks):
                        t_w = int(np.random.randint(3, max_tw + 1))
                        t0 = int(np.random.randint(active_start, active_end - t_w + 1))
                        x[:, t0 : t0 + t_w] = floor_val

        return torch.from_numpy(x), int(self.labels[idx])


class ClassWeightedLabelSmoothFocalLoss(nn.Module):
    def __init__(
        self,
        class_weights: torch.Tensor,
        gamma: float = 1.0,
        label_smoothing: float = 0.05,
    ) -> None:
        super().__init__()
        self.register_buffer("class_weights", class_weights)
        self.gamma = gamma
        self.label_smoothing = label_smoothing

    def forward(self, logits: torch.Tensor, targets: torch.Tensor) -> torch.Tensor:
        log_probs = F.log_softmax(logits, dim=-1)
        probs = log_probs.exp()
        n_cls = logits.size(-1)

        with torch.no_grad():
            smooth_targets = torch.full_like(log_probs, self.label_smoothing / (n_cls - 1))
            smooth_targets.scatter_(1, targets.unsqueeze(1), 1.0 - self.label_smoothing)

        pt = probs.gather(1, targets.unsqueeze(1)).squeeze(1).clamp(min=1e-6, max=1.0)
        focal_factor = (1.0 - pt) ** self.gamma
        ce_per_sample = -(smooth_targets * log_probs).sum(dim=-1)
        w = self.class_weights[targets]
        return (w * focal_factor * ce_per_sample).mean()


def fit_temperature_scaling(val_logits: np.ndarray, val_labels: np.ndarray) -> tuple[float, float, float]:
    """Fits scalar temperature T > 0 on validation logits minimizing NLL."""
    logits_t = torch.from_numpy(val_logits).float()
    labels_t = torch.from_numpy(val_labels).long()

    with torch.no_grad():
        nll_before = float(F.cross_entropy(logits_t, labels_t).item())

    log_t = nn.Parameter(torch.zeros(1))
    opt = torch.optim.LBFGS([log_t], lr=0.1, max_iter=60)

    def closure() -> torch.Tensor:
        opt.zero_grad()
        temp = torch.exp(log_t).clamp(min=0.3, max=5.0)
        loss = F.cross_entropy(logits_t / temp, labels_t)
        loss.backward()
        return loss

    opt.step(closure)
    with torch.no_grad():
        best_t = float(torch.exp(log_t).clamp(min=0.3, max=5.0).item())
        nll_after = float(F.cross_entropy(logits_t / best_t, labels_t).item())

    return best_t, nll_before, nll_after


@torch.no_grad()
def eval_model(
    model: nn.Module,
    loader: DataLoader,
    device: torch.device,
) -> tuple[float, float, np.ndarray, np.ndarray]:
    model.eval()
    all_logits: list[np.ndarray] = []
    all_labels: list[np.ndarray] = []
    for x, y in loader:
        x = x.to(device)
        logits = model(x)
        all_logits.append(logits.cpu().numpy())
        all_labels.append(y.numpy())
    logits_np = np.concatenate(all_logits, axis=0)
    labels_np = np.concatenate(all_labels, axis=0)
    preds = logits_np.argmax(axis=1)
    acc = float(accuracy_score(labels_np, preds))
    f1 = float(f1_score(labels_np, preds, average="macro"))
    return acc, f1, logits_np, labels_np


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--epochs", type=int, default=11)
    parser.add_argument("--batch-size", type=int, default=64)
    parser.add_argument("--lr-encoder", type=float, default=4.5e-5)
    parser.add_argument("--lr-head", type=float, default=4.0e-4)
    parser.add_argument("--weight-decay", type=float, default=0.02)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    torch.manual_seed(args.seed)
    np.random.seed(args.seed)

    if torch.backends.mps.is_available():
        device = torch.device("mps")
    elif torch.cuda.is_available():
        device = torch.device("cuda")
    else:
        device = torch.device("cpu")
    print(f"[Train] Using device: {device}")

    train_rows = load_jsonl(PREP_DIR / "train.jsonl")
    val_rows = load_jsonl(PREP_DIR / "val.jsonl")
    print(f"[Train] Dataset rows: train={len(train_rows)}, val={len(val_rows)}")

    fe = WhisperFeatureExtractor(chunk_length=8)
    train_mels = build_or_load_mel_cache(train_rows, "train", fe)
    val_mels = build_or_load_mel_cache(val_rows, "val", fe)

    train_labels = [int(r["label_id"]) for r in train_rows]
    val_labels = [int(r["label_id"]) for r in val_rows]

    counts = Counter(train_labels)
    # Near-uniform class weights avoid over-triggering WAIT_INTERRUPT on clean Mandarin & EN backchannels
    class_weights = torch.tensor([1.0, 1.0, 1.03, 0.97], dtype=torch.float32, device=device)
    print(f"[Train] Class counts={dict(counts)}, weights={[round(float(x), 3) for x in class_weights.tolist()]}")

    train_ds = CachedMelDataset(train_mels, train_labels, train=True)
    val_ds = CachedMelDataset(val_mels, val_labels, train=False)

    train_loader = DataLoader(train_ds, batch_size=args.batch_size, shuffle=True, num_workers=0)
    val_loader = DataLoader(val_ds, batch_size=args.batch_size, shuffle=False, num_workers=0)

    model = WhisperTurnClassifier("openai/whisper-tiny", dropout=0.15).to(device)
    criterion = ClassWeightedLabelSmoothFocalLoss(class_weights, gamma=0.5, label_smoothing=0.04)

    enc_params = [p for p in model.encoder.parameters() if p.requires_grad]
    head_params = list(model.norm.parameters()) + list(model.attn_proj.parameters()) + list(model.head.parameters())

    optimizer = torch.optim.AdamW(
        [
            {"params": enc_params, "lr": args.lr_encoder},
            {"params": head_params, "lr": args.lr_head},
        ],
        weight_decay=args.weight_decay,
    )

    total_steps = args.epochs * len(train_loader)
    warmup_steps = max(1, int(0.08 * total_steps))

    def lr_lambda(step: int) -> float:
        if step < warmup_steps:
            return float(step + 1) / float(warmup_steps)
        progress = float(step - warmup_steps) / float(max(1, total_steps - warmup_steps))
        return max(0.02, 0.5 * (1.0 + math.cos(math.pi * progress)))

    scheduler = torch.optim.lr_scheduler.LambdaLR(optimizer, lr_lambda)

    CKPT_DIR.mkdir(parents=True, exist_ok=True)
    best_score = -1.0
    best_ckpt = CKPT_DIR / "best_model.pt"
    epoch1_sec = 0.0
    history: list[dict] = []

    for epoch in range(1, args.epochs + 1):
        t_ep = time.time()
        model.train()
        running_loss = 0.0
        n_batches = 0

        for x, y in train_loader:
            x = x.to(device)
            y = y.to(device)
            optimizer.zero_grad(set_to_none=True)
            logits = model(x)
            loss = criterion(logits, y)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()
            scheduler.step()
            running_loss += float(loss.item())
            n_batches += 1

        if device.type == "mps":
            torch.mps.synchronize()
        ep_sec = time.time() - t_ep
        if epoch == 1:
            epoch1_sec = ep_sec

        val_acc, val_f1, val_logits, val_y = eval_model(model, val_loader, device)
        avg_loss = running_loss / max(1, n_batches)
        score = 0.5 * val_acc + 0.5 * val_f1
        print(
            f"Epoch {epoch}/{args.epochs} | time={ep_sec:.2f}s | train_loss={avg_loss:.4f} "
            f"| val_acc={val_acc:.4f} | val_macro_f1={val_f1:.4f}"
        )
        history.append({
            "epoch": epoch,
            "epoch_sec": round(ep_sec, 2),
            "train_loss": round(avg_loss, 4),
            "val_acc": round(val_acc, 4),
            "val_macro_f1": round(val_f1, 4),
        })

        if score > best_score:
            best_score = score
            torch.save(
                {
                    "model_state_dict": model.state_dict(),
                    "epoch": epoch,
                    "val_acc": val_acc,
                    "val_macro_f1": val_f1,
                    "classes": CLASSES,
                },
                best_ckpt,
            )

    # Load best checkpoint and calibrate post-hoc Temperature Scaling T on val logits
    ckpt = torch.load(best_ckpt, map_location="cpu", weights_only=True)
    model.load_state_dict(ckpt["model_state_dict"])
    model.to(device)
    val_acc, val_f1, val_logits, val_y = eval_model(model, val_loader, device)
    best_t, nll_before, nll_after = fit_temperature_scaling(val_logits, val_y)
    print(
        f"[Calibration] Best epoch={ckpt['epoch']} val_acc={val_acc:.4f} val_f1={val_f1:.4f} "
        f"| Temperature T={best_t:.4f} (NLL {nll_before:.4f} -> {nll_after:.4f})"
    )

    ckpt["temperature"] = best_t
    ckpt["nll_before_T"] = nll_before
    ckpt["nll_after_T"] = nll_after
    ckpt["epoch1_sec"] = round(epoch1_sec, 2)
    ckpt["history"] = history
    torch.save(ckpt, best_ckpt)

    summary = {
        "device": str(device),
        "epoch1_sec": round(epoch1_sec, 2),
        "best_epoch": int(ckpt["epoch"]),
        "best_val_acc": round(val_acc, 4),
        "best_val_macro_f1": round(val_f1, 4),
        "temperature": round(best_t, 4),
        "nll_before_T": round(nll_before, 4),
        "nll_after_T": round(nll_after, 4),
        "history": history,
    }
    (CKPT_DIR / "train_summary.json").write_text(json.dumps(summary, indent=2))
    print(f"[Train] Saved calibrated checkpoint to {best_ckpt}")


if __name__ == "__main__":
    main()
