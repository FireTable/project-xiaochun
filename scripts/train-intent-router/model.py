"""
scripts/train-intent-router/model.py

CompactTransformerClassifier for Intent Routing (CHAT vs HEAVY).
- 2 Transformer Encoder layers, 128 embedding dim, 4 attention heads
- Sequence length: 64 tokens
- Masked attention pooling + GELU classification head
- Parameter count: ~1.0M parameters (FP32 ~3.5MB, INT8 ~2.3MB)
"""

from __future__ import annotations

import torch
import torch.nn as nn

CLASSES = ["CHAT", "HEAVY"]
NUM_CLASSES = 2
MAX_SEQ_LEN = 64
DEFAULT_VOCAB_SIZE = 5500
D_MODEL = 128
N_HEAD = 4
DIM_FEEDFORWARD = 512
NUM_LAYERS = 2


class CompactTransformerClassifier(nn.Module):
    def __init__(
        self,
        vocab_size: int = DEFAULT_VOCAB_SIZE,
        d_model: int = D_MODEL,
        nhead: int = N_HEAD,
        num_layers: int = NUM_LAYERS,
        dim_feedforward: int = DIM_FEEDFORWARD,
        max_seq_len: int = MAX_SEQ_LEN,
        num_classes: int = NUM_CLASSES,
        dropout: float = 0.1,
    ) -> None:
        super().__init__()
        self.vocab_size = vocab_size
        self.d_model = d_model
        self.max_seq_len = max_seq_len
        self.num_classes = num_classes

        self.embedding = nn.Embedding(vocab_size, d_model, padding_idx=0)
        self.pos_embedding = nn.Embedding(max_seq_len, d_model)

        encoder_layer = nn.TransformerEncoderLayer(
            d_model=d_model,
            nhead=nhead,
            dim_feedforward=dim_feedforward,
            dropout=dropout,
            activation="gelu",
            batch_first=True,
            norm_first=True,
        )
        self.transformer = nn.TransformerEncoder(
            encoder_layer,
            num_layers=num_layers,
            enable_nested_tensor=False,
        )
        self.norm = nn.LayerNorm(d_model)
        self.attn_proj = nn.Linear(d_model, 1)

        self.classifier = nn.Sequential(
            nn.Linear(d_model, 64),
            nn.GELU(),
            nn.Dropout(dropout),
            nn.Linear(64, num_classes),
        )

    def forward(self, input_ids: torch.Tensor, attention_mask: torch.Tensor) -> torch.Tensor:
        """
        input_ids: [B, S] int64 tensor
        attention_mask: [B, S] int64/float32 tensor (1 for valid token, 0 for padding)
        Returns: logits [B, 2]
        """
        B, S = input_ids.shape
        pos = torch.arange(S, device=input_ids.device).unsqueeze(0).expand(B, S)
        x = self.embedding(input_ids) + self.pos_embedding(pos)

        # PyTorch TransformerEncoder expects True for masked (padding) positions
        key_padding_mask = (attention_mask == 0)
        h = self.transformer(x, src_key_padding_mask=key_padding_mask)
        h = self.norm(h)

        # Masked attention pooling over sequence tokens
        attn_scores = self.attn_proj(h)  # [B, S, 1]
        mask_penalty = (1.0 - attention_mask.unsqueeze(-1).float()) * -10000.0
        attn_scores = attn_scores + mask_penalty
        attn_weights = torch.softmax(attn_scores, dim=1)
        pooled = torch.sum(h * attn_weights, dim=1)  # [B, d_model]

        logits = self.classifier(pooled)  # [B, 2]
        return logits
