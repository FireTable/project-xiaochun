"""Distill the published 768 EMAGE step into a width-512 student.

The teacher is the app path, not the training path: face branch unused, cross-attention
layers 0..3 removed, first 4 frames are the seed and the other 60 are masked.
Generation stores fp16 logits. Validation uses every val window: argmax agreement
(lower body) and whether the teacher's argmax sits in the student's top-10
(upper body and hands are sampled from that pool).
"""
import argparse
import json
import os
import time

import numpy as np
import soundfile as sf
import torch
import torch.nn.functional as F
from torch import nn

ROOT = r"E:\xiaochun\character-policy-main"
TEACHER_DIR = r"E:\xiaochun\emage-audio-768"
CACHE = r"E:\xiaochun\outputs\distill512\cache"
OUT = r"E:\xiaochun\outputs\distill512"
META = os.path.join(ROOT, "datasets", "data_json", "beat2_s20_l64_speaker2.json")
WINDOW = 64
SEED = 4
AUDIO = 64 * (16000 // 30)  # 34112, same as the app
DROP = {0, 1, 2, 3}
HEADS = ("upper", "hands", "lower")

os.chdir(ROOT)
import sys
sys.path.insert(0, ROOT)
from emage_utils.rotation_conversions import axis_angle_to_rotation_6d
from models.emage_audio.configuration_emage_audio import EmageAudioConfig
from models.emage_audio.modeling_emage_audio import EmageAudioModel


def gpu_setup():
    torch.backends.cuda.matmul.allow_tf32 = True
    torch.backends.cudnn.allow_tf32 = True
    torch.backends.cudnn.benchmark = True
    torch.set_float32_matmul_precision("high")


class BodyStep(nn.Module):
    def __init__(self, model):
        super().__init__()
        self.m = model

    def forward(self, audio, speaker_id, masked_motion, mask):
        m = self.m
        audio2body = m.audio_encoder_body(audio)
        _, t, _ = audio2body.shape
        speaker = m.speaker_embedding_body(speaker_id).repeat(1, t, 1)
        masked = torch.where(mask == 1, m.mask_embedding.expand_as(masked_motion), masked_motion)
        hint = m.bodyhints_body(m.motion_encoder(masked))
        motion = m.position_embeddings(m.moton_proj(hint)) + speaker
        motion = m.motion_self_encoder(motion.permute(1, 0, 2)).permute(1, 0, 2)
        audio_proj = m.audio_body_motion_proj(audio2body)
        motion = m.position_embeddings(motion + speaker)
        cross = m.audio_motion_cross_attn(
            tgt=motion.permute(1, 0, 2), memory=audio_proj.permute(1, 0, 2)
        ).permute(1, 0, 2)
        motion = motion + cross
        upper = m.motion2latent_upper(motion)
        hands = m.motion2latent_hands(motion)
        lower = m.motion2latent_lower(motion)
        sp = speaker.permute(1, 0, 2)
        up = m.body_motion_decoder_upper(
            tgt=upper.permute(1, 0, 2) + sp, memory=(hands + lower).permute(1, 0, 2)
        ).permute(1, 0, 2)
        hd = m.body_motion_decoder_hands(
            tgt=hands.permute(1, 0, 2) + sp, memory=(upper + lower).permute(1, 0, 2)
        ).permute(1, 0, 2)
        lw = m.body_motion_decoder_lower(
            tgt=lower.permute(1, 0, 2) + sp, memory=(upper + hands).permute(1, 0, 2)
        ).permute(1, 0, 2)
        return (
            m.motion_cls_upper(m.motion_out_proj_upper(upper + up)),
            m.motion_cls_hands(m.motion_out_proj_hands(hands + hd)),
            m.motion_cls_lower(m.motion_out_proj_lower(lower + lw)),
        )


def drop_cross(model):
    layers = list(model.audio_motion_cross_attn.layers)
    model.audio_motion_cross_attn.layers = nn.ModuleList([layer for i, layer in enumerate(layers) if i not in DROP])
    model.audio_motion_cross_attn.num_layers = len(model.audio_motion_cross_attn.layers)


def ensure_teacher():
    os.makedirs(TEACHER_DIR, exist_ok=True)
    weights = os.path.join(TEACHER_DIR, "pytorch_model.bin")
    if os.path.exists(weights) and os.path.getsize(weights) > 500_000_000:
        return
    from huggingface_hub import hf_hub_download
    for name in ("config.json", "pytorch_model.bin"):
        hf_hub_download("haiyangliu0/emage_audio", name, local_dir=TEACHER_DIR)


def load_teacher():
    ensure_teacher()
    model = EmageAudioModel.from_pretrained(TEACHER_DIR).cuda().eval()
    drop_cross(model)
    for p in model.parameters():
        p.requires_grad_(False)
    return BodyStep(model).eval()


def make_student(width):
    cfg = EmageAudioConfig.from_pretrained(TEACHER_DIR)
    cfg.hidden_size = width
    model = EmageAudioModel(cfg).cuda()
    drop_cross(model)
    return BodyStep(model)


def build_cache():
    os.makedirs(CACHE, exist_ok=True)
    marker = os.path.join(CACHE, "ready.json")
    if os.path.exists(marker):
        return json.load(open(marker, encoding="utf-8"))
    items = json.load(open(META, encoding="utf-8"))
    groups = {}
    for i, item in enumerate(items):
        groups.setdefault(item["motion_path"], []).append((i, item))
    audio = np.lib.format.open_memmap(os.path.join(CACHE, "audio.f32"), mode="w+", dtype=np.float32, shape=(len(items), AUDIO))
    motion = np.lib.format.open_memmap(os.path.join(CACHE, "motion.f32"), mode="w+", dtype=np.float32, shape=(len(items), WINDOW, 337))
    modes = [None] * len(items)
    t0 = time.time()
    for nfiles, (motion_path, group) in enumerate(groups.items(), 1):
        npz_path = os.path.normpath(os.path.join(ROOT, motion_path))
        wav_path = os.path.normpath(os.path.join(ROOT, group[0][1]["audio_path"]))
        blob = np.load(npz_path)
        poses = blob["poses"].astype(np.float32)
        trans = blob["trans"].astype(np.float32)
        foot_path = npz_path.replace("smplxflame_30", "footcontact").replace(".npz", ".npy")
        foot = np.load(foot_path).astype(np.float32) if os.path.exists(foot_path) else None
        wav, sr = sf.read(wav_path, dtype="float32", always_2d=False)
        if wav.ndim > 1:
            wav = wav.mean(axis=1)
        if sr != 16000:
            raise RuntimeError(f"{wav_path} sr {sr}")
        pose_t = torch.from_numpy(poses).cuda()
        with torch.inference_mode():
            rot6d = axis_angle_to_rotation_6d(pose_t.reshape(-1, 55, 3)).reshape(pose_t.shape[0], 330).float().cpu().numpy()
        for index, item in group:
            s, e = item["start_idx"], item["end_idx"]
            if e - s != WINDOW:
                raise RuntimeError(f"window {e - s} != {WINDOW}")
            clip = rot6d[s:e]
            tr = trans[s:e]
            ft = foot[s:e] if foot is not None else np.zeros((WINDOW, 4), np.float32)
            motion[index] = np.concatenate([clip, tr, ft], axis=-1)
            a0 = s * (16000 // 30)
            piece = wav[a0:a0 + AUDIO]
            if piece.shape[0] < AUDIO:
                padded = np.zeros(AUDIO, np.float32)
                padded[:piece.shape[0]] = piece
                piece = padded
            audio[index] = piece
            modes[index] = item["mode"]
        if nfiles % 20 == 0:
            print(f"cache files {nfiles}/{len(groups)} {time.time() - t0:.1f}s", flush=True)
    audio.flush()
    motion.flush()
    if any(m is None for m in modes):
        raise RuntimeError("cache missed a window")
    mode_arr = np.array(modes)
    np.save(os.path.join(CACHE, "mode.npy"), mode_arr)
    info = {k: int((mode_arr == k).sum()) for k in ("train", "val", "test")}
    info["seconds"] = round(time.time() - t0, 1)
    json.dump(info, open(marker, "w", encoding="utf-8"))
    print("cache", info, flush=True)
    return info


def splits():
    mode = np.load(os.path.join(CACHE, "mode.npy"))
    return {name: np.flatnonzero(mode == name) for name in ("train", "val", "test")}


def open_logits(split, n, mode):
    path = os.path.join(CACHE, f"logits_{split}.f16")
    return np.lib.format.open_memmap(path, mode=mode, dtype=np.float16, shape=(n, 3, WINDOW, 256))


def app_mask(batch, motion):
    mask = torch.ones(batch, WINDOW, 337, device="cuda")
    mask[:, :SEED] = 0
    return motion, mask


@torch.inference_mode()
def generate(batch):
    gpu_setup()
    build_cache()
    ids = splits()
    teacher = load_teacher()
    audio = np.load(os.path.join(CACHE, "audio.f32"), mmap_mode="r")
    motion = np.load(os.path.join(CACHE, "motion.f32"), mmap_mode="r")
    for name in ("train", "val"):
        index = ids[name]
        logits = open_logits(name, len(index), "w+")
        t0 = time.time()
        seen = 0
        cursor = 0
        while cursor < len(index):
            pick = index[cursor:cursor + batch]
            try:
                a = torch.from_numpy(np.array(audio[pick], copy=True)).cuda(non_blocking=True)
                m = torch.from_numpy(np.array(motion[pick], copy=True)).cuda(non_blocking=True)
                m, mask = app_mask(a.shape[0], m)
                speaker = torch.zeros(a.shape[0], 1, dtype=torch.long, device="cuda")
                out = teacher(a, speaker, m, mask)
                torch.cuda.synchronize()
                packed = torch.stack(out, dim=1).half().cpu().numpy()
            except torch.cuda.OutOfMemoryError:
                torch.cuda.empty_cache()
                if batch == 1:
                    raise
                batch //= 2
                print(f"gen oom, batch -> {batch}", flush=True)
                continue
            logits[cursor:cursor + len(pick)] = packed
            cursor += len(pick)
            seen += len(pick)
        logits.flush()
        rate = seen / max(time.time() - t0, 1e-6)
        print(f"gen {name} windows {seen} {rate:.1f} windows/s", flush=True)
    report_labels()


def report_labels():
    ids = splits()
    val = np.load(os.path.join(CACHE, "logits_val.f16"), mmap_mode="r")
    x = torch.from_numpy(np.array(val, copy=True))
    finite = torch.isfinite(x).all().item()
    agree_self = (x.argmax(-1) == x.float().argmax(-1)).all().item()
    codes = x.argmax(-1)
    summary = {"finite": bool(finite), "fp16_argmax_same": bool(agree_self), "val_windows": int(len(ids["val"]))}
    for i, name in enumerate(HEADS):
        used = torch.unique(codes[:, i]).numel()
        summary[f"{name}_codes"] = int(used)
    json.dump(summary, open(os.path.join(OUT, "labels.json"), "w", encoding="utf-8"), indent=2)
    print("labels", summary, flush=True)


def kl_loss(student_logits, teacher_logits, temperature):
    loss = 0
    log_p = F.log_softmax(student_logits / temperature, dim=-1)
    q = F.softmax(teacher_logits / temperature, dim=-1)
    loss = F.kl_div(log_p, q, reduction="none").sum(-1).mean()
    return loss * (temperature * temperature)


@torch.inference_mode()
def score(student, temperature_unused=None):
    ids = splits()
    index = ids["val"]
    teacher_logits = np.load(os.path.join(CACHE, "logits_val.f16"), mmap_mode="r")
    audio = np.load(os.path.join(CACHE, "audio.f32"), mmap_mode="r")
    motion = np.load(os.path.join(CACHE, "motion.f32"), mmap_mode="r")
    hit = {name: 0.0 for name in HEADS}
    agree = {name: 0.0 for name in HEADS}
    jacc = {name: 0.0 for name in HEADS}
    total = 0
    was_training = student.training
    student.eval()
    for start in range(0, len(index), 32):
        pick = index[start:start + 32]
        a = torch.from_numpy(np.array(audio[pick], copy=True)).cuda(non_blocking=True)
        m = torch.from_numpy(np.array(motion[pick], copy=True)).cuda(non_blocking=True)
        m, mask = app_mask(a.shape[0], m)
        speaker = torch.zeros(a.shape[0], 1, dtype=torch.long, device="cuda")
        pred = torch.stack(student(a, speaker, m, mask), dim=1)
        tgt = torch.from_numpy(np.array(teacher_logits[start:start + len(pick)], copy=True)).cuda().float()
        pred_i = pred.argmax(-1)
        tgt_i = tgt.argmax(-1)
        pred_top = pred.topk(10, dim=-1).indices
        tgt_top = tgt.topk(10, dim=-1).indices
        inter = (pred_top.unsqueeze(-1) == tgt_top.unsqueeze(-2)).any(-1).sum(-1).float()
        for h, name in enumerate(HEADS):
            agree[name] += (pred_i[:, h] == tgt_i[:, h]).float().sum().item()
            hit[name] += (pred_top[:, h] == tgt_i[:, h].unsqueeze(-1)).any(-1).float().sum().item()
            jacc[name] += (inter[:, h] / (20 - inter[:, h])).sum().item()
        total += pred_i.shape[0] * WINDOW
    if was_training:
        student.train()
    frames = max(total, 1)
    return {
        name: {
            "argmax": round(agree[name] / frames, 4),
            "teacher_in_top10": round(hit[name] / frames, 4),
            "top10_jaccard": round(jacc[name] / frames, 4),
        }
        for name in HEADS
    }


def train(width, steps, batch, lr, temperature):
    gpu_setup()
    os.makedirs(OUT, exist_ok=True)
    build_cache()
    if not os.path.exists(os.path.join(CACHE, "logits_train.f16")):
        generate(batch=batch)
    student = make_student(width).train()
    params = [p for p in student.parameters() if p.requires_grad]
    opt = torch.optim.AdamW(params, lr=lr, betas=(0.9, 0.999), weight_decay=0.0)
    train_ids = splits()["train"]
    audio = np.load(os.path.join(CACHE, "audio.f32"), mmap_mode="r")
    motion = np.load(os.path.join(CACHE, "motion.f32"), mmap_mode="r")
    logits = np.load(os.path.join(CACHE, "logits_train.f16"), mmap_mode="r")
    rng = np.random.default_rng(222)
    t0 = time.time()
    best = -1.0
    for step in range(1, steps + 1):
        pick = rng.choice(len(train_ids), size=batch, replace=False)
        rows = train_ids[pick]
        a = torch.from_numpy(np.array(audio[rows], copy=True)).cuda(non_blocking=True)
        m = torch.from_numpy(np.array(motion[rows], copy=True)).cuda(non_blocking=True)
        target = torch.from_numpy(np.array(logits[pick], copy=True)).cuda().float()
        m, mask = app_mask(batch, m)
        speaker = torch.zeros(batch, 1, dtype=torch.long, device="cuda")
        opt.zero_grad(set_to_none=True)
        pred = torch.stack(student(a, speaker, m, mask), dim=1)
        loss = (kl_loss(pred[:, 0], target[:, 0], temperature) + kl_loss(pred[:, 1], target[:, 1], temperature) + kl_loss(pred[:, 2], target[:, 2], temperature)) / 3
        if not torch.isfinite(loss):
            print(f"step {step} nonfinite loss, skip", flush=True)
            opt.zero_grad(set_to_none=True)
            continue
        loss.backward()
        torch.nn.utils.clip_grad_norm_(params, 1.0)
        opt.step()
        if step % 100 == 0 or step == 1:
            rate = step / max(time.time() - t0, 1e-6)
            print(f"step {step} loss {loss.item():.4f} {rate:.2f} steps/s", flush=True)
        if step % 1000 == 0 or step == steps:
            metrics = score(student)
            mean_argmax = sum(metrics[n]["argmax"] for n in HEADS) / 3
            print(f"val {step} {json.dumps(metrics)}", flush=True)
            ckpt = os.path.join(OUT, "last.pt")
            torch.save({"step": step, "width": width, "model": student.m.state_dict(), "metrics": metrics}, ckpt)
            if mean_argmax > best:
                best = mean_argmax
                torch.save({"step": step, "width": width, "model": student.m.state_dict(), "metrics": metrics}, os.path.join(OUT, "best.pt"))


def validate(ckpt):
    gpu_setup()
    blob = torch.load(ckpt, map_location="cuda")
    student = make_student(blob["width"]).eval()
    student.m.load_state_dict(blob["model"])
    metrics = score(student)
    print(json.dumps({"step": blob["step"], "metrics": metrics}, indent=2), flush=True)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=("cache", "gen", "train", "validate"))
    ap.add_argument("--width", type=int, default=512)
    ap.add_argument("--steps", type=int, default=30000)
    ap.add_argument("--batch", type=int, default=32)
    ap.add_argument("--lr", type=float, default=1e-4)
    ap.add_argument("--temperature", type=float, default=2.0)
    ap.add_argument("--ckpt", default=os.path.join(OUT, "best.pt"))
    args = ap.parse_args()
    os.makedirs(OUT, exist_ok=True)
    if args.cmd == "cache":
        print(build_cache(), flush=True)
    elif args.cmd == "gen":
        generate(args.batch)
    elif args.cmd == "train":
        train(args.width, args.steps, args.batch, args.lr, args.temperature)
    else:
        validate(args.ckpt)
