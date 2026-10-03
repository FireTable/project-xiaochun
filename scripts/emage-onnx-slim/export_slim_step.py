#!/usr/bin/env python3
"""STEP 1: export a SLIM emage_step that outputs ONLY cls_upper / cls_hands / cls_lower.

What is dropped compared to emage_step.onnx from emage-onnx-export:
  * the whole face branch (audio_encoder_face, bodyhints_face, audio_face_motion_proj,
    face_motion_decoder, face_out_proj, speaker_embedding_face)  -> rec_face is gone
  * the in-graph argmax -> VQ decode (face/upper/hands/lower) -> 6D -> axis-angle -> 55 joint
    assembly chain -> rot6d, lower_dec and seed are gone (seed is computed host-side, see js/)

The body path is a line-by-line copy of EmageAudioModel.forward (body part only), so cls_* are
mathematically identical to the full model. INT8 uses the exact README call:
    quantize_dynamic(fp32, int8, weight_type=QInt8, op_types_to_quantize=["MatMul"])

Usage:
    python export_slim_step.py [--export-dir ../../../emage-onnx-export] [--out-dir out] [--no-quantize]
"""
import argparse
import os
import sys

import slim_common as C

ap = argparse.ArgumentParser()
ap.add_argument("--export-dir", default=C.default_export_dir())
ap.add_argument("--out-dir", default=C.DEFAULT_OUT)
ap.add_argument("--no-quantize", action="store_true")
args = ap.parse_args()

os.makedirs(args.out_dir, exist_ok=True)
panto = C.ensure_pantomatrix_code(args.export_dir)
sys.path.insert(0, panto)

import numpy as np  # noqa: E402
import torch  # noqa: E402
import torch.nn as nn  # noqa: E402
import onnxruntime as ort  # noqa: E402
from models.emage_audio import EmageAudioModel  # noqa: E402


class SlimStepWrapper(nn.Module):
    """Body-only copy of EmageAudioModel.forward. Returns (cls_upper, cls_hands, cls_lower)."""

    def __init__(self, m):
        super().__init__()
        self.m = m

    def forward(self, audio, speaker_id, masked_motion, mask):
        m = self.m
        audio2body_fea = m.audio_encoder_body(audio)
        bs, t, _ = audio2body_fea.shape
        speaker_motion_fea_proj = m.speaker_embedding_body(speaker_id).repeat(1, t, 1)

        masked_embeddings = m.mask_embedding.expand_as(masked_motion)
        masked_motion = torch.where(mask == 1, masked_embeddings, masked_motion)

        body_hint = m.motion_encoder(masked_motion)
        body_hint_body = m.bodyhints_body(body_hint)

        masked_motion_proj = m.moton_proj(body_hint_body)
        masked_motion_proj = m.position_embeddings(masked_motion_proj)
        masked_motion_proj = speaker_motion_fea_proj + masked_motion_proj
        motion_fea = m.motion_self_encoder(masked_motion_proj.permute(1, 0, 2)).permute(1, 0, 2)

        audio2body_fea_proj = m.audio_body_motion_proj(audio2body_fea)
        motion_fea = motion_fea + speaker_motion_fea_proj
        motion_fea = m.position_embeddings(motion_fea)
        audio2body_fea_cross = m.audio_motion_cross_attn(
            tgt=motion_fea.permute(1, 0, 2), memory=audio2body_fea_proj.permute(1, 0, 2)).permute(1, 0, 2)
        motion_fea = motion_fea + audio2body_fea_cross

        upper_latent = m.motion2latent_upper(motion_fea)
        hands_latent = m.motion2latent_hands(motion_fea)
        lower_latent = m.motion2latent_lower(motion_fea)

        sp = speaker_motion_fea_proj.permute(1, 0, 2)
        up_ref = m.body_motion_decoder_upper(
            tgt=upper_latent.permute(1, 0, 2) + sp, memory=(hands_latent + lower_latent).permute(1, 0, 2)).permute(1, 0, 2)
        hd_ref = m.body_motion_decoder_hands(
            tgt=hands_latent.permute(1, 0, 2) + sp, memory=(upper_latent + lower_latent).permute(1, 0, 2)).permute(1, 0, 2)
        lw_ref = m.body_motion_decoder_lower(
            tgt=lower_latent.permute(1, 0, 2) + sp, memory=(upper_latent + hands_latent).permute(1, 0, 2)).permute(1, 0, 2)

        upper_latent = m.motion_out_proj_upper(upper_latent + up_ref)
        hands_latent = m.motion_out_proj_hands(hands_latent + hd_ref)
        lower_latent = m.motion_out_proj_lower(lower_latent + lw_ref)

        return (m.motion_cls_upper(upper_latent),
                m.motion_cls_hands(hands_latent),
                m.motion_cls_lower(lower_latent))


def main():
    C.log("Loading PyTorch model (H-Liu1997/emage_audio, from HF cache if present)...")
    model = EmageAudioModel.from_pretrained(C.HF_REPO).to("cpu").eval()
    wrapper = SlimStepWrapper(model).eval()

    torch.manual_seed(0)
    inputs = [
        torch.randn(1, C.WINDOW_AUDIO_LEN),
        torch.zeros(1, 1, dtype=torch.long),
        torch.randn(1, C.WINDOW_FRAMES, C.MOTION_DIM),
        torch.ones(1, C.WINDOW_FRAMES, C.MOTION_DIM),
    ]
    # Check 1: wrapper == full model forward (PyTorch), on a window with a seed (mask partly 0)
    probe = [x.clone() for x in inputs]
    probe[3][:, :4] = 0
    with torch.no_grad():
        ref = model(probe[0], probe[1], probe[2], probe[3], use_audio=True)
        got = wrapper(*probe)
    d = [float((ref[k] - g).abs().max()) for k, g in zip(["cls_upper", "cls_hands", "cls_lower"], got)]
    C.log(f"[check] PyTorch wrapper vs full forward max|diff| cls_upper/hands/lower = {d}")
    assert max(d) < 1e-5, "wrapper deviates from model.forward"

    fp32 = os.path.join(args.out_dir, "emage_step_slim.onnx")
    C.log(f"Exporting {fp32}")
    with torch.no_grad():
        torch.onnx.export(
            wrapper, tuple(inputs), fp32,
            input_names=["audio", "speaker_id", "masked_motion", "mask"],
            output_names=["cls_upper", "cls_hands", "cls_lower"],
            opset_version=17, dynamo=False, do_constant_folding=True)
    C.log(f"  fp32 slim: {C.mb(fp32):.2f} MB")

    # Check 2: ONNX vs PyTorch
    so = ort.SessionOptions(); so.log_severity_level = 3
    sess = ort.InferenceSession(fp32, so, providers=["CPUExecutionProvider"])
    feed = {"audio": probe[0].numpy(), "speaker_id": probe[1].numpy(),
            "masked_motion": probe[2].numpy(), "mask": probe[3].numpy()}
    o = sess.run(None, feed)
    d = [float(np.abs(a - g.numpy()).max()) for a, g in zip(o, got)]
    C.log(f"[check] ONNX slim fp32 vs PyTorch max|diff| = {d}")

    if not args.no_quantize:
        from onnxruntime.quantization import quantize_dynamic, QuantType
        int8 = os.path.join(args.out_dir, "emage_step_slim_int8.onnx")
        C.log(f"INT8 dynamic quantization (README call: QInt8, op_types_to_quantize=['MatMul']) -> {int8}")
        quantize_dynamic(fp32, int8, weight_type=QuantType.QInt8, op_types_to_quantize=["MatMul"])
        C.log(f"  int8 slim: {C.mb(int8):.2f} MB  (fp32 {C.mb(fp32):.2f} MB)")


if __name__ == "__main__":
    main()
