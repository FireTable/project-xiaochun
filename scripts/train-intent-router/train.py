"""
scripts/train-intent-router/train.py

Training script for CompactTransformerClassifier:
- Loads data/train.jsonl and data/val.jsonl
- Tokenizes using public/models/intent-router/vocab.json
- Optimizes via AdamW, Cosine Annealing, Cross-Entropy with label smoothing
- Calibrates post-hoc temperature scaling on validation logits
- Saves best model checkpoint to scripts/train-intent-router/checkpoints/best_model.pt
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import List, Tuple

import numpy as np
import torch
import torch.nn as nn
from torch.utils.data import DataLoader, TensorDataset

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parent.parent
DATA_DIR = SCRIPT_DIR / "data"
CHECKPOINT_DIR = SCRIPT_DIR / "checkpoints"
PUBLIC_MODEL_DIR = REPO_ROOT / "public" / "models" / "intent-router"

sys.path.insert(0, str(SCRIPT_DIR))
from dataset import tokenize_py
from model import CompactTransformerClassifier, CLASSES, NUM_CLASSES, MAX_SEQ_LEN


def load_data(file_path: Path, vocab: dict) -> Tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
    """Load JSONL dataset and tokenize into pre-allocated PyTorch tensors."""
    input_ids_list = []
    attention_mask_list = []
    labels_list = []

    with open(file_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            item = json.loads(line)
            text = item["text"]
            label = int(item["label"])

            ids, mask = tokenize_py(text, vocab, max_len=MAX_SEQ_LEN)
            input_ids_list.append(ids)
            attention_mask_list.append(mask)
            labels_list.append(label)

    return (
        torch.tensor(input_ids_list, dtype=torch.long),
        torch.tensor(attention_mask_list, dtype=torch.long),
        torch.tensor(labels_list, dtype=torch.long),
    )


def calibrate_temperature(val_logits: torch.Tensor, val_labels: torch.Tensor) -> float:
    """
    Find optimal temperature T > 0 on validation set logits using L-BFGS.
    Minimizes negative log likelihood of softmax(logits / T).
    """
    temperature = nn.Parameter(torch.ones(1) * 1.0)
    optimizer = torch.optim.LBFGS([temperature], lr=0.05, max_iter=100)
    criterion = nn.CrossEntropyLoss()

    def eval_closure():
        optimizer.zero_grad()
        loss = criterion(val_logits / temperature.clamp(min=0.1, max=5.0), val_labels)
        loss.backward()
        return loss

    optimizer.step(eval_closure)
    opt_t = float(temperature.clamp(min=0.1, max=5.0).item())
    print(f"[Calibration] Optimal temperature T = {opt_t:.4f}")
    return opt_t


def main():
    CHECKPOINT_DIR.mkdir(parents=True, exist_ok=True)

    vocab_file = PUBLIC_MODEL_DIR / "vocab.json"
    if not vocab_file.exists():
        raise FileNotFoundError(f"Vocabulary not found at {vocab_file}. Run dataset.py first.")

    with open(vocab_file, "r", encoding="utf-8") as f:
        vocab = json.load(f)
    vocab_size = len(vocab)
    print(f"[Train] Loaded vocabulary with {vocab_size} tokens.")

    # Device selection: MPS (Apple Silicon) if available, else CPU
    if torch.backends.mps.is_available():
        device = torch.device("mps")
    elif torch.cuda.is_available():
        device = torch.device("cuda")
    else:
        device = torch.device("cpu")
    print(f"[Train] Using compute device: {device}")

    train_file = DATA_DIR / "train.jsonl"
    val_file = DATA_DIR / "val.jsonl"
    print(f"[Train] Loading and tokenizing train/val splits...")
    train_ids, train_mask, train_y = load_data(train_file, vocab)
    val_ids, val_mask, val_y = load_data(val_file, vocab)

    train_loader = DataLoader(
        TensorDataset(train_ids, train_mask, train_y),
        batch_size=64,
        shuffle=True,
    )
    val_loader = DataLoader(
        TensorDataset(val_ids, val_mask, val_y),
        batch_size=128,
        shuffle=False,
    )

    model = CompactTransformerClassifier(
        vocab_size=vocab_size,
        d_model=128,
        nhead=4,
        num_layers=2,
        dim_feedforward=512,
        max_seq_len=MAX_SEQ_LEN,
        num_classes=NUM_CLASSES,
        dropout=0.1,
    ).to(device)

    total_params = sum(p.numel() for p in model.parameters() if p.requires_grad)
    print(f"[Train] CompactTransformerClassifier parameter count: {total_params:,}")

    criterion = nn.CrossEntropyLoss(label_smoothing=0.05)
    optimizer = torch.optim.AdamW(model.parameters(), lr=5e-4, weight_decay=0.01)
    epochs = 12
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=epochs, eta_min=1e-5)

    best_val_acc = 0.0
    best_checkpoint_path = CHECKPOINT_DIR / "best_model.pt"

    for epoch in range(1, epochs + 1):
        model.train()
        total_loss = 0.0
        correct = 0
        total = 0

        for b_ids, b_mask, b_y in train_loader:
            b_ids = b_ids.to(device)
            b_mask = b_mask.to(device)
            b_y = b_y.to(device)

            optimizer.zero_grad()
            logits = model(b_ids, b_mask)
            loss = criterion(logits, b_y)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), max_norm=1.0)
            optimizer.step()

            total_loss += loss.item() * len(b_y)
            preds = logits.argmax(dim=1)
            correct += (preds == b_y).sum().item()
            total += len(b_y)

        scheduler.step()
        train_loss = total_loss / total
        train_acc = correct / total

        # Validation
        model.eval()
        val_loss = 0.0
        val_correct = 0
        val_total = 0
        all_val_logits = []
        all_val_y = []

        with torch.no_grad():
            for b_ids, b_mask, b_y in val_loader:
                b_ids = b_ids.to(device)
                b_mask = b_mask.to(device)
                b_y = b_y.to(device)

                logits = model(b_ids, b_mask)
                loss = criterion(logits, b_y)

                val_loss += loss.item() * len(b_y)
                preds = logits.argmax(dim=1)
                val_correct += (preds == b_y).sum().item()
                val_total += len(b_y)

                all_val_logits.append(logits.cpu())
                all_val_y.append(b_y.cpu())

        val_loss /= val_total
        val_acc = val_correct / val_total

        print(
            f"Epoch {epoch:2d}/{epochs:2d} | "
            f"Train Loss: {train_loss:.4f} Acc: {train_acc*100:.2f}% | "
            f"Val Loss: {val_loss:.4f} Acc: {val_acc*100:.2f}%"
        )

        if val_acc >= best_val_acc:
            best_val_acc = val_acc
            val_logits_tensor = torch.cat(all_val_logits, dim=0)
            val_y_tensor = torch.cat(all_val_y, dim=0)
            temperature = calibrate_temperature(val_logits_tensor, val_y_tensor)

            torch.save(
                {
                    "model_state_dict": model.state_dict(),
                    "vocab_size": vocab_size,
                    "temperature": temperature,
                    "val_acc": val_acc,
                    "val_loss": val_loss,
                    "epoch": epoch,
                },
                best_checkpoint_path,
            )
            print(f"  -> Saved best checkpoint (Val Acc: {val_acc*100:.2f}%) to {best_checkpoint_path}")

    print(f"\n[Train] Training complete. Best Val Acc: {best_val_acc*100:.2f}%")


if __name__ == "__main__":
    main()
