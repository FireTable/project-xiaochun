"""
model.py — Whisper-tiny Encoder + Attention Pooling 4-class Bilingual Turn Classifier.

Exact architecture:
  - Backbone: `openai/whisper-tiny` encoder (`384`-d), sliced positional embeddings
    to `max_source_positions = 400` for `[B, 80, 800]` (8.0s end-aligned left-zero-padded)
  - Head: `LayerNorm(384)` -> `AttentionPooling(Softmax(W h))` -> `Linear(384, 128)`
    -> `GELU` -> `Dropout(0.15)` -> `Linear(128, 4)`

Label order:
  0: COMPLETE
  1: INCOMPLETE
  2: BACKCHANNEL
  3: WAIT_INTERRUPT
"""

from __future__ import annotations

import torch
import torch.nn as nn
from transformers import WhisperModel

CLASSES = ["COMPLETE", "INCOMPLETE", "BACKCHANNEL", "WAIT_INTERRUPT"]
NUM_CLASSES = 4
WHISPER_SAMPLE_RATE = 16000
WHISPER_MAX_SAMPLES = 128000
WHISPER_N_MELS = 80
WHISPER_N_FRAMES = 800
WHISPER_ENCODER_FRAMES = 400


class WhisperTurnClassifier(nn.Module):
    def __init__(self, pretrained_name: str = "openai/whisper-tiny", dropout: float = 0.15) -> None:
        super().__init__()
        whisper = WhisperModel.from_pretrained(pretrained_name)
        self.encoder = whisper.encoder
        del whisper

        d_model = self.encoder.config.d_model  # 384 for whisper-tiny

        # Adapt Whisper's 30s (1500-frame) encoder positional embeddings cleanly to 8.0s (400-frame)
        orig_pos = self.encoder.embed_positions.weight.data[:WHISPER_ENCODER_FRAMES].clone()
        new_pos = nn.Embedding(WHISPER_ENCODER_FRAMES, d_model)
        new_pos.weight.data.copy_(orig_pos)
        new_pos.weight.requires_grad = False
        self.encoder.embed_positions = new_pos
        self.encoder.config.max_source_positions = WHISPER_ENCODER_FRAMES

        self.norm = nn.LayerNorm(d_model)
        self.attn_proj = nn.Linear(d_model, 1)
        self.head = nn.Sequential(
            nn.Linear(d_model, 128),
            nn.GELU(),
            nn.Dropout(dropout),
            nn.Linear(128, NUM_CLASSES),
        )

    def forward(self, input_features: torch.Tensor) -> torch.Tensor:
        enc_out = self.encoder(input_features=input_features).last_hidden_state  # [B, 400, 384]
        h = self.norm(enc_out)
        attn_weights = torch.softmax(self.attn_proj(h), dim=1)  # [B, 400, 1]
        pooled = torch.sum(attn_weights * h, dim=1)  # [B, 384]
        logits = self.head(pooled)  # [B, 4]
        return logits


def left_pad_or_tail_trim(waveform: "np.ndarray", max_samples: int = WHISPER_MAX_SAMPLES) -> "np.ndarray":
    """
    Smart-turn convention:
      - If waveform > 8.0s (128,000 samples), take the TRAILING 128,000 samples so utterance end aligns at t = 8.0s.
      - If waveform < 8.0s, LEFT-zero-pad so audio ends at t = 8.0s.
    """
    import numpy as np

    w = np.asarray(waveform, dtype=np.float32)
    if w.size >= max_samples:
        return np.ascontiguousarray(w[-max_samples:])
    out = np.zeros(max_samples, dtype=np.float32)
    out[-w.size :] = w
    return out
