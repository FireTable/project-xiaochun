#!/usr/bin/env python3
"""
prepare_datasets.py — Prepares balanced ZH / EN / CS 4-class full-duplex turn dataset
in `/tmp/xc-duplex-turn-cache/prepared/` (NEVER stores large tarballs inside the repo).

Sources:
  1. ASLP-lab/Easy-Turn-Trainset (streamed tar.gz -> inner .tar shards, 4 classes:
     COMPLETE, INCOMPLETE, BACKCHANNEL, WAIT_INTERRUPT)
  2. ASLP-lab/Easy-Turn-Testset (800-clip curated Chinese evaluation benchmark)
  3. pipecat-ai/smart-turn-data-v3.2-train & test (filtered for English & Mandarin)
  4. Synthesized multi-voice EN & EN-ZH Code-Switching BACKCHANNEL / WAIT_INTERRUPT
     via Edge-TTS (`scripts/train-duplex-turn/synth_en_cs.ts`), augmented with speed/pitch
     perturbation, pink/room noise, random trailing silence (0..250ms), and prefix padding,
     keeping a clean stratified 15% EN/CS holdout split with zero speaker/utterance leakage!

Exact label index order:
  0: COMPLETE
  1: INCOMPLETE
  2: BACKCHANNEL
  3: WAIT_INTERRUPT
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import shutil
import tarfile
import urllib.request
from collections import Counter, defaultdict
from pathlib import Path

import librosa
import numpy as np
import pyarrow.parquet as pq
import soundfile as sf
from huggingface_hub import hf_hub_download, snapshot_download
from scipy.signal import resample_poly

CLASSES = ["COMPLETE", "INCOMPLETE", "BACKCHANNEL", "WAIT_INTERRUPT"]
CLASS_TO_ID = {c: i for i, c in enumerate(CLASSES)}
SR = 16000

CACHE_ROOT = Path("/tmp/xc-duplex-turn-cache")
PREP_DIR = CACHE_ROOT / "prepared"
WAV_CACHE_DIR = PREP_DIR / "wav16k"


def stable_hash_float(key: str) -> float:
    h = hashlib.sha256(key.encode("utf-8")).digest()
    val = int.from_bytes(h[:8], "little")
    return val / float(1 << 64)


def ensure_mono_16k(audio: np.ndarray, sr: int) -> np.ndarray:
    if audio.ndim == 2:
        audio = audio.mean(axis=1)
    audio = audio.astype(np.float32, copy=False)
    if sr != SR:
        g = int(np.gcd(sr, SR))
        up = SR // g
        down = sr // g
        audio = resample_poly(audio, up, down).astype(np.float32)
    return audio


def is_valid_audio(audio: np.ndarray, min_sec: float = 0.12, max_sec: float = 15.0) -> bool:
    if audio.size < int(min_sec * SR) or audio.size > int(max_sec * SR):
        return False
    if not np.isfinite(audio).all():
        return False
    rms = float(np.sqrt(np.mean(audio * audio)))
    return rms > 1e-4


def save_wav16k(path: Path, audio: np.ndarray) -> float:
    path.parent.mkdir(parents=True, exist_ok=True)
    clipped = np.clip(audio, -1.0, 1.0).astype(np.float32, copy=False)
    sf.write(str(path), clipped, SR, subtype="PCM_16")
    return round(float(clipped.size) / SR, 3)


def make_pink_noise(length: int, rng: np.random.Generator) -> np.ndarray:
    white = rng.standard_normal(length).astype(np.float32)
    freqs = np.fft.rfftfreq(length, d=1.0 / SR)
    scale = np.ones_like(freqs)
    nz = freqs > 0
    scale[nz] = 1.0 / np.sqrt(freqs[nz])
    scale[0] = 0.0
    pink = np.fft.irfft(np.fft.rfft(white) * scale, n=length).astype(np.float32)
    std = float(np.std(pink))
    if std > 1e-8:
        pink /= std
    return pink


def apply_room_ir(audio: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    """Lightweight synthetic room early-reflections convolution."""
    ir_len = int(0.055 * SR)
    ir = np.zeros(ir_len, dtype=np.float32)
    ir[0] = 1.0
    for _ in range(4):
        tap = int(rng.integers(int(0.004 * SR), ir_len))
        ir[tap] += float(rng.uniform(0.04, 0.16)) * (1.0 - tap / ir_len)
    conv = np.convolve(audio, ir, mode="full")[: audio.size + int(0.02 * SR)]
    peak_in = float(np.max(np.abs(audio))) + 1e-8
    peak_out = float(np.max(np.abs(conv))) + 1e-8
    return (conv * (peak_in / peak_out)).astype(np.float32)


def augment_tts_waveform(
    audio: np.ndarray,
    rng: np.random.Generator,
    mode: str,
) -> np.ndarray:
    """
    Realistic microphone + acoustic perturbation for synthesized EN/CS clips:
      - 'holdout': gentle room noise + random trailing silence 0..250ms + mild prefix pad
      - 'clean_noisy': original speed/pitch + gentle pink/room noise + trailing silence 0..250ms + prefix pad
      - 'perturb_speed_pitch': speed/pitch perturbation + room IR + pink noise + trailing silence 0..250ms
    """
    y = audio.astype(np.float32, copy=True)

    if mode == "perturb_speed_pitch":
        # Speed perturbation (0.91 .. 1.09)
        speed = float(rng.uniform(0.91, 1.09))
        new_len = max(1600, int(round(y.size / speed)))
        x_old = np.linspace(0.0, 1.0, y.size, dtype=np.float64)
        x_new = np.linspace(0.0, 1.0, new_len, dtype=np.float64)
        y = np.interp(x_new, x_old, y).astype(np.float32)
        # Mild pitch shift (-1.4 .. +1.4 semitones) on half of perturbed samples
        if rng.random() < 0.6:
            steps = float(rng.uniform(-1.4, 1.4))
            y = librosa.effects.pitch_shift(y, sr=SR, n_steps=steps).astype(np.float32)
        if rng.random() < 0.65:
            y = apply_room_ir(y, rng)
    elif mode == "clean_noisy":
        if rng.random() < 0.4:
            y = apply_room_ir(y, rng)
    elif mode == "holdout":
        if rng.random() < 0.35:
            y = apply_room_ir(y, rng)

    # Random prefix padding (0 .. 180 ms) & trailing silence (0 .. 250 ms)
    prefix_samples = int(rng.integers(0, int(0.18 * SR)))
    trailing_samples = int(rng.integers(0, int(0.25 * SR) + 1))
    y = np.concatenate([
        np.zeros(prefix_samples, dtype=np.float32),
        y,
        np.zeros(trailing_samples, dtype=np.float32),
    ])

    # Normalize speech RMS to realistic mic level (0.04 .. 0.16)
    speech_rms = float(np.sqrt(np.mean(y * y))) + 1e-8
    target_rms = float(rng.uniform(0.04, 0.15))
    y = y * (target_rms / speech_rms)

    # Add gentle pink / room ambient noise (SNR 20 .. 36 dB)
    snr_db = float(rng.uniform(20.0, 36.0))
    noise = make_pink_noise(y.size, rng)
    noise_rms = target_rms / (10.0 ** (snr_db / 20.0))
    y = y + noise * noise_rms

    peak = float(np.max(np.abs(y)))
    if peak > 0.96:
        y = y * (0.96 / peak)
    return y.astype(np.float32)


def stream_easy_turn_tar(
    tar_filename: str,
    label: str,
    target_count: int,
    max_inner_shards: int,
    source_tag: str,
    rng: np.random.Generator,
    max_per_shard: int = 120,
    min_sec_quota: tuple[float, int] | None = None,
) -> list[dict]:
    """
    Streams `ASLP-lab/Easy-Turn-Trainset/trainset/<tar_filename>` over HTTP using `tarfile`
    streaming mode (`r|gz`) and extracts up to `target_count` samples across many inner shards
    (`max_per_shard` per shard) for broad speaker/channel diversity without multi-GB downloads.
    """
    out_dir = WAV_CACHE_DIR / "easy_turn_train" / source_tag
    manifest_cache = out_dir / "items.jsonl"
    if manifest_cache.exists():
        cached = [json.loads(line) for line in manifest_cache.read_text().splitlines() if line.strip()]
        if len(cached) >= min(target_count, 200):
            print(f"[Easy-Turn] Reusing {len(cached)} cached clips for {source_tag}")
            return cached[:target_count]

    out_dir.mkdir(parents=True, exist_ok=True)
    url = f"https://huggingface.co/datasets/ASLP-lab/Easy-Turn-Trainset/resolve/main/trainset/{tar_filename}"
    print(f"[Easy-Turn] Streaming {tar_filename} (target={target_count}, max_shards={max_inner_shards})...")

    items: list[dict] = []
    shards_read = 0
    long_taken = 0
    short_taken = 0
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        with tarfile.open(fileobj=resp, mode="r|gz") as outer_tf:
            for outer_m in outer_tf:
                if not outer_m.isfile() or not outer_m.name.endswith(".tar"):
                    continue
                shards_read += 1
                fobj = outer_tf.extractfile(outer_m)
                if fobj is None:
                    continue

                grouped: dict[str, dict[str, bytes]] = defaultdict(dict)
                with tarfile.open(fileobj=fobj, mode="r|") as inner_tf:
                    for inner_m in inner_tf:
                        if not inner_m.isfile():
                            continue
                        stem, ext = os.path.splitext(inner_m.name)
                        if ext in (".wav", ".txt", ".lang", ".speaker"):
                            raw = inner_tf.extractfile(inner_m)
                            if raw is not None:
                                grouped[stem][ext] = raw.read()

                stems = list(grouped.keys())
                rng.shuffle(stems)
                shard_taken = 0
                shard_short_taken = 0
                for stem in stems:
                    parts = grouped[stem]
                    if ".wav" not in parts:
                        continue
                    try:
                        wav, sr = sf.read(io.BytesIO(parts[".wav"]), dtype="float32")
                        wav = ensure_mono_16k(wav, sr)
                    except Exception:
                        continue
                    if not is_valid_audio(wav, min_sec=0.15, max_sec=10.0):
                        continue

                    if min_sec_quota is not None:
                        min_dur, long_cap = min_sec_quota
                        short_cap = max(0, target_count - long_cap)
                        dur_est = float(wav.size) / SR
                        if dur_est >= min_dur:
                            if long_taken >= long_cap:
                                continue
                            long_taken += 1
                        else:
                            if short_taken >= short_cap or shard_short_taken >= max(15, max_per_shard // 4):
                                continue
                            short_taken += 1
                            shard_short_taken += 1

                    lang_raw = parts.get(".lang", b"<CN>").decode(errors="ignore").strip()
                    lang = "EN" if "EN" in lang_raw else "ZH"
                    speaker = parts.get(".speaker", b"<NONE>").decode(errors="ignore").strip() or "<NONE>"
                    text = parts.get(".txt", b"").decode(errors="ignore").strip()

                    clip_id = f"{source_tag}_{len(items):05d}"
                    wav_path = out_dir / f"{clip_id}.wav"
                    dur = save_wav16k(wav_path, wav)

                    items.append({
                        "id": clip_id,
                        "wav_path": str(wav_path),
                        "label": label,
                        "label_id": CLASS_TO_ID[label],
                        "lang": lang,
                        "speaker": speaker if speaker != "<NONE>" else f"{source_tag}_{outer_m.name}_{stem}",
                        "text": text,
                        "source": source_tag,
                        "duration_sec": dur,
                    })
                    shard_taken += 1
                    if shard_taken >= max_per_shard or len(items) >= target_count:
                        break

                print(f"  [{source_tag}] shard {shards_read} ({outer_m.name}) -> total={len(items)}")
                if len(items) >= target_count or shards_read >= max_inner_shards:
                    break

    manifest_cache.write_text("\n".join(json.dumps(x, ensure_ascii=False) for x in items) + "\n")
    return items


def prepare_easy_turn_testset() -> list[dict]:
    base = CACHE_ROOT / "Easy-Turn-Testset"
    if not (base / "testset").exists():
        snapshot_download("ASLP-lab/Easy-Turn-Testset", repo_type="dataset", local_dir=str(base))

    testset_dir = base / "testset"
    list_map = [
        (testset_dir / "complete" / "complete_test.list", "COMPLETE"),
        (testset_dir / "incomplete" / "incomplete_real_test.list", "INCOMPLETE"),
        (testset_dir / "backchannel" / "backchannel_test.list", "BACKCHANNEL"),
        (testset_dir / "wait" / "wait_test.list", "WAIT_INTERRUPT"),
    ]
    out_dir = WAV_CACHE_DIR / "easy_turn_test"
    out_dir.mkdir(parents=True, exist_ok=True)
    items: list[dict] = []

    for list_path, label in list_map:
        for line in list_path.read_text().splitlines():
            if not line.strip():
                continue
            row = json.loads(line)
            src_wav = testset_dir / row["wav"].lstrip("./")
            wav, sr = sf.read(str(src_wav), dtype="float32")
            wav = ensure_mono_16k(wav, sr)
            clip_id = f"et_test_{row['key']}"
            dst_wav = out_dir / f"{clip_id}.wav"
            if not dst_wav.exists():
                dur = save_wav16k(dst_wav, wav)
            else:
                dur = round(float(wav.size) / SR, 3)

            lang = "EN" if "EN" in str(row.get("lang", "")) else "ZH"
            items.append({
                "id": clip_id,
                "wav_path": str(dst_wav),
                "label": label,
                "label_id": CLASS_TO_ID[label],
                "lang": lang,
                "speaker": row.get("speaker", "<NONE>"),
                "text": row.get("txt", ""),
                "source": row.get("extra", {}).get("dataset", "easy_turn_test"),
                "duration_sec": dur,
            })

    print(f"[Easy-Turn-Testset] Prepared {len(items)} clips.")
    return items


def download_smart_turn_shard(repo: str, filename: str, dest_dir: Path) -> Path:
    dest_dir.mkdir(parents=True, exist_ok=True)
    return Path(hf_hub_download(repo, filename, repo_type="dataset", local_dir=str(dest_dir)))


def prepare_smart_turn(
    repo: str,
    shard_files: list[str],
    cache_subdir: str,
    targets_per_cell: dict[tuple[str, str], int] | None,
) -> list[dict]:
    """
    Reads `pipecat-ai/smart-turn-data-v3.2-{train,test}` parquet shards sequentially, filters for
    English (`eng`) and Mandarin (`zho`, `cmn`), maps `endpoint_bool` -> `COMPLETE`/`INCOMPLETE`,
    and stops early once `targets_per_cell` is met.
    """
    out_dir = WAV_CACHE_DIR / cache_subdir
    manifest_cache = out_dir / "items.jsonl"
    if manifest_cache.exists():
        cached = [json.loads(line) for line in manifest_cache.read_text().splitlines() if line.strip()]
        if cached:
            print(f"[smart-turn:{cache_subdir}] Reusing {len(cached)} cached clips")
            return cached

    out_dir.mkdir(parents=True, exist_ok=True)
    parquet_dir = CACHE_ROOT / f"smart_turn_{cache_subdir}"

    counts: Counter[tuple[str, str]] = Counter()
    items: list[dict] = []

    for fn in shard_files:
        pq_path = download_smart_turn_shard(repo, fn, parquet_dir)
        pf = pq.ParquetFile(str(pq_path))
        for rg_idx in range(pf.num_row_groups):
            tbl = pf.read_row_group(rg_idx, columns=["audio", "id", "language", "endpoint_bool", "synthetic", "dataset"])
            langs = tbl["language"].to_pylist()
            eps = tbl["endpoint_bool"].to_pylist()
            ids = tbl["id"].to_pylist()
            dsets = tbl["dataset"].to_pylist()
            audios = tbl["audio"].to_pylist()

            for i in range(len(langs)):
                raw_lang = langs[i]
                if raw_lang == "eng":
                    lang = "EN"
                elif raw_lang in ("zho", "cmn", "zh"):
                    lang = "ZH"
                else:
                    continue

                label = "COMPLETE" if eps[i] else "INCOMPLETE"
                cell = (lang, label)
                if targets_per_cell is not None and counts[cell] >= targets_per_cell.get(cell, 0):
                    continue

                audio_bytes = audios[i]["bytes"]
                try:
                    wav, sr = sf.read(io.BytesIO(audio_bytes), dtype="float32")
                    wav = ensure_mono_16k(wav, sr)
                except Exception:
                    continue
                if not is_valid_audio(wav, min_sec=0.15, max_sec=12.0):
                    continue

                clip_id = f"st_{cache_subdir}_{ids[i]}"
                wav_path = out_dir / f"{clip_id}.wav"
                dur = save_wav16k(wav_path, wav)
                counts[cell] += 1
                items.append({
                    "id": clip_id,
                    "wav_path": str(wav_path),
                    "label": label,
                    "label_id": CLASS_TO_ID[label],
                    "lang": lang,
                    "speaker": f"st_{ids[i]}",
                    "text": "",
                    "source": f"smart_turn_{dsets[i]}",
                    "duration_sec": dur,
                })

            if targets_per_cell is not None and all(
                counts[c] >= n for c, n in targets_per_cell.items()
            ):
                break
        if targets_per_cell is not None and all(
            counts[c] >= n for c, n in targets_per_cell.items()
        ):
            break

    manifest_cache.write_text("\n".join(json.dumps(x, ensure_ascii=False) for x in items) + "\n")
    print(f"[smart-turn:{cache_subdir}] Prepared {len(items)} clips: {dict(counts)}")
    return items


def prepare_synth_tts(rng: np.random.Generator) -> tuple[list[dict], list[dict], list[dict]]:
    """
    Loads synthesized Edge-TTS clips from `synth_tts/manifest.jsonl`, splits strictly into
    (train, val, holdout_en_cs) with ZERO speaker and ZERO phrase-text leakage, and applies
    realistic acoustic augmentations AFTER splitting.
    """
    tts_manifest = CACHE_ROOT / "synth_tts" / "manifest.jsonl"
    if not tts_manifest.exists():
        raise FileNotFoundError(
            f"Missing {tts_manifest}. Run `node --experimental-strip-types scripts/train-duplex-turn/synth_en_cs.ts` first."
        )

    rows = [json.loads(line) for line in tts_manifest.read_text().splitlines() if line.strip()]
    aug_dir = WAV_CACHE_DIR / "synth_tts_aug"
    cache_check = aug_dir / "split_done.json"
    if cache_check.exists():
        meta = json.loads(cache_check.read_text())
        if meta.get("n_source") == len(rows):
            tr = [json.loads(l) for l in (aug_dir / "tts_train.jsonl").read_text().splitlines() if l.strip()]
            va = [json.loads(l) for l in (aug_dir / "tts_val.jsonl").read_text().splitlines() if l.strip()]
            ho = [json.loads(l) for l in (aug_dir / "tts_holdout.jsonl").read_text().splitlines() if l.strip()]
            print(f"[synth_tts] Reusing cached split: train={len(tr)}, val={len(va)}, holdout={len(ho)}")
            return tr, va, ho

    aug_dir.mkdir(parents=True, exist_ok=True)

    # Split train-pool unique phrase texts cleanly into train (88%) vs val (12%) so val phrases are unseen!
    train_pool_phrases = sorted({(r["label"], r["lang"], r["text"]) for r in rows if r["split"] == "train"})
    val_phrase_set: set[tuple[str, str, str]] = set()
    by_cell = defaultdict(list)
    for key in train_pool_phrases:
        by_cell[(key[0], key[1])].append(key)
    for _, keys in by_cell.items():
        keys_sorted = sorted(keys, key=lambda k: stable_hash_float(f"{k[0]}|{k[1]}|{k[2]}"))
        n_val = max(1, int(round(len(keys_sorted) * 0.14)))
        for k in keys_sorted[:n_val]:
            val_phrase_set.add(k)

    # Verify zero overlap between holdout and train/val on both phrase and voice
    holdout_phrases = {r["text"] for r in rows if r["split"] == "holdout"}
    train_phrases = {r["text"] for r in rows if r["split"] == "train"}
    holdout_voices = {r["voice"] for r in rows if r["split"] == "holdout"}
    train_voices = {r["voice"] for r in rows if r["split"] == "train"}
    assert holdout_phrases.isdisjoint(train_phrases), "Phrase leakage between holdout and train!"
    assert holdout_voices.isdisjoint(train_voices), "Speaker voice leakage between holdout and train!"

    tts_train: list[dict] = []
    tts_val: list[dict] = []
    tts_holdout: list[dict] = []

    for row in rows:
        wav, sr = sf.read(row["wav_path"], dtype="float32")
        wav = ensure_mono_16k(wav, sr)
        base_meta = {
            "label": row["label"],
            "label_id": CLASS_TO_ID[row["label"]],
            "lang": row["lang"],
            "speaker": row["voice"],
            "text": row["text"],
            "source": "edge_tts_synth",
        }

        if row["split"] == "holdout":
            clip_rng = np.random.default_rng(int(stable_hash_float(row["id"]) * (1 << 31)))
            aug_wav = augment_tts_waveform(wav, clip_rng, mode="holdout")
            out_wav = aug_dir / f"{row['id']}_holdout.wav"
            dur = save_wav16k(out_wav, aug_wav)
            tts_holdout.append({**base_meta, "id": f"{row['id']}_holdout", "wav_path": str(out_wav), "duration_sec": dur})
        elif (row["label"], row["lang"], row["text"]) in val_phrase_set:
            clip_rng = np.random.default_rng(int(stable_hash_float(row["id"]) * (1 << 31)))
            aug_wav = augment_tts_waveform(wav, clip_rng, mode="holdout")
            out_wav = aug_dir / f"{row['id']}_val.wav"
            dur = save_wav16k(out_wav, aug_wav)
            tts_val.append({**base_meta, "id": f"{row['id']}_val", "wav_path": str(out_wav), "duration_sec": dur})
        else:
            # Generate 2 diverse augmented training variants per base train clip
            for v_idx, mode in enumerate(("clean_noisy", "perturb_speed_pitch")):
                aug_wav = augment_tts_waveform(wav, rng, mode=mode)
                cid = f"{row['id']}_v{v_idx}"
                out_wav = aug_dir / f"{cid}.wav"
                dur = save_wav16k(out_wav, aug_wav)
                tts_train.append({**base_meta, "id": cid, "wav_path": str(out_wav), "duration_sec": dur})

    (aug_dir / "tts_train.jsonl").write_text("\n".join(json.dumps(x, ensure_ascii=False) for x in tts_train) + "\n")
    (aug_dir / "tts_val.jsonl").write_text("\n".join(json.dumps(x, ensure_ascii=False) for x in tts_val) + "\n")
    (aug_dir / "tts_holdout.jsonl").write_text("\n".join(json.dumps(x, ensure_ascii=False) for x in tts_holdout) + "\n")
    cache_check.write_text(json.dumps({"n_source": len(rows)}))
    print(f"[synth_tts] Split complete (zero speaker/phrase leakage): train={len(tts_train)}, val={len(tts_val)}, holdout={len(tts_holdout)}")
    return tts_train, tts_val, tts_holdout


def prepare_synth_zh_turns(rng: np.random.Generator) -> tuple[list[dict], list[dict]]:
    """
    Loads synthesized ZH COMPLETE/INCOMPLETE Edge-TTS clips from `/tmp/xc-duplex-turn-cache/synth_zh_turns/manifest.jsonl`,
    splits deterministically by phrase (zero phrase leakage between train and val), and augments cleanly.
    """
    manifest = CACHE_ROOT / "synth_zh_turns" / "manifest.jsonl"
    if not manifest.exists():
        print("[synth_zh_turns] manifest not found, skipping.")
        return [], []

    rows = [json.loads(line) for line in manifest.read_text().splitlines() if line.strip()]
    # Skip Edge-TTS INCOMPLETE (Edge-TTS forces falling terminal prosody even without punctuation)
    rows = [r for r in rows if r.get("label") in ("COMPLETE", "BACKCHANNEL")]
    aug_dir = WAV_CACHE_DIR / "synth_zh_turns_aug"
    cache_check = aug_dir / "split_done.json"
    if cache_check.exists():
        meta = json.loads(cache_check.read_text())
        if meta.get("n_source") == len(rows):
            tr = [json.loads(l) for l in (aug_dir / "zh_train.jsonl").read_text().splitlines() if l.strip()]
            va = [json.loads(l) for l in (aug_dir / "zh_val.jsonl").read_text().splitlines() if l.strip()]
            print(f"[synth_zh_turns] Reusing cached split: train={len(tr)}, val={len(va)}")
            return tr, va

    aug_dir.mkdir(parents=True, exist_ok=True)
    phrases = sorted({(r["label"], r["text"]) for r in rows})
    val_phrases = {
        k for k in phrases if stable_hash_float(f"zh_turn|{k[0]}|{k[1]}") < 0.14
    }

    tr_out, va_out = [], []
    for row in rows:
        wav, sr = sf.read(row["wav_path"], dtype="float32")
        wav = ensure_mono_16k(wav, sr)
        base_meta = {
            "label": row["label"],
            "label_id": CLASS_TO_ID[row["label"]],
            "lang": "ZH",
            "speaker": row["voice"],
            "text": row["text"],
            "source": "edge_tts_zh_turn",
        }
        if (row["label"], row["text"]) in val_phrases:
            clip_rng = np.random.default_rng(int(stable_hash_float(row["id"]) * (1 << 31)))
            aug_wav = augment_tts_waveform(wav, clip_rng, mode="holdout")
            out_wav = aug_dir / f"{row['id']}_val.wav"
            dur = save_wav16k(out_wav, aug_wav)
            va_out.append({**base_meta, "id": f"{row['id']}_val", "wav_path": str(out_wav), "duration_sec": dur})
        else:
            for v_idx, mode in enumerate(("clean_noisy", "perturb_speed_pitch")):
                aug_wav = augment_tts_waveform(wav, rng, mode=mode)
                cid = f"{row['id']}_v{v_idx}"
                out_wav = aug_dir / f"{cid}.wav"
                dur = save_wav16k(out_wav, aug_wav)
                tr_out.append({**base_meta, "id": cid, "wav_path": str(out_wav), "duration_sec": dur})

    (aug_dir / "zh_train.jsonl").write_text("\n".join(json.dumps(x, ensure_ascii=False) for x in tr_out) + "\n")
    (aug_dir / "zh_val.jsonl").write_text("\n".join(json.dumps(x, ensure_ascii=False) for x in va_out) + "\n")
    cache_check.write_text(json.dumps({"n_source": len(rows)}))
    print(f"[synth_zh_turns] Split complete: train={len(tr_out)}, val={len(va_out)}")
    return tr_out, va_out


def normalize_training_waveforms(train_rows: list[dict], rng: np.random.Generator) -> list[dict]:
    """
    Eliminates leading-silence, RMS volume, and digital-vs-room noise floor shortcuts on
    TRAINING clips ONLY (`val` and all `test` benchmarks remain raw ground-truth audio):
      1. Trims excess dead leading silence before voice onset and prepends random 0..360ms lead-in
         uniformly across all 4 classes (prevents WAIT_INTERRUPT from memorizing 0.3s lead silence).
      2. Equalizes active RMS into a wide uniform range (0.03 .. 0.14) across real & syn clips.
      3. Adds gentle ambient pink/room noise (SNR 23..42 dB) on 55% of clips.
    """
    norm_dir = WAV_CACHE_DIR / "train_norm"
    norm_dir.mkdir(parents=True, exist_ok=True)
    out_rows: list[dict] = []

    for row in train_rows:
        src = row.get("source", "")
        if not (src.startswith("et_") or src.startswith("smart_turn_") or src == "edge_tts_zh_turn"):
            out_rows.append(row)
            continue

        out_wav = norm_dir / f"{row['id']}_norm.wav"
        if out_wav.exists():
            dur = round(sf.info(str(out_wav)).duration, 3)
            out_rows.append({**row, "wav_path": str(out_wav), "duration_sec": dur})
            continue

        wav, sr = sf.read(row["wav_path"], dtype="float32")
        wav = ensure_mono_16k(wav, sr)

        # Strip dead leading silence (> 40ms) only for clips comfortably under 8.0s
        if wav.size < int(7.6 * SR):
            peak = float(np.max(np.abs(wav))) + 1e-8
            thresh = max(0.0035, 0.04 * peak)
            nz = np.where(np.abs(wav) > thresh)[0]
            if len(nz) > 0 and nz[0] > int(0.04 * SR):
                onset = max(0, int(nz[0]) - int(0.03 * SR))
                wav = wav[onset:]
            lead_ms = int(rng.integers(0, int(0.36 * SR)))
            if lead_ms > 0:
                wav = np.concatenate([np.zeros(lead_ms, dtype=np.float32), wav])

        # Compute RMS over active region; cover both quiet real mics (0.022) & loud TTS (0.165)
        active_mask = np.abs(wav) > (0.03 * (float(np.max(np.abs(wav))) + 1e-8))
        active_rms = float(np.sqrt(np.mean(wav[active_mask] ** 2))) if active_mask.any() else (float(np.sqrt(np.mean(wav * wav))) + 1e-8)
        target_rms = float(rng.uniform(0.022, 0.165))
        wav = wav * (target_rms / max(active_rms, 1e-6))

        if rng.random() < 0.55:
            snr_db = float(rng.uniform(23.0, 42.0))
            noise = make_pink_noise(wav.size, rng)
            noise_rms = target_rms / (10.0 ** (snr_db / 20.0))
            wav = wav + noise * noise_rms

        pk = float(np.max(np.abs(wav)))
        if pk > 0.96:
            wav = wav * (0.96 / pk)

        dur = save_wav16k(out_wav, wav)
        out_rows.append({**row, "wav_path": str(out_wav), "duration_sec": dur})

    print(f"[TrainNorm] Normalized {len(out_rows)} training clips (lead-in + RMS + noise invariance)")
    return out_rows


def split_grouped(items: list[dict], val_frac: float = 0.12) -> tuple[list[dict], list[dict]]:
    """Speaker-grouped deterministic train/val split."""
    train_out: list[dict] = []
    val_out: list[dict] = []
    for item in items:
        spk_key = f"{item['source']}|{item['speaker']}"
        if stable_hash_float(spk_key) < val_frac:
            val_out.append(item)
        else:
            train_out.append(item)
    return train_out, val_out


def write_jsonl(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(json.dumps(r, ensure_ascii=False) for r in rows) + "\n")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--smart-turn-train-shards", type=int, default=8)
    parser.add_argument("--smart-turn-test-shards", type=int, default=2)
    args = parser.parse_args()

    rng = np.random.default_rng(args.seed)
    PREP_DIR.mkdir(parents=True, exist_ok=True)

    # 1. Easy-Turn-Trainset (streamed across MANY inner shards per class for high speaker diversity)
    et_items: list[dict] = []
    et_items.extend(stream_easy_turn_tar("complete_real.tar.gz", "COMPLETE", 2450, 32, "et_complete_real", rng, max_per_shard=90))
    et_items.extend(stream_easy_turn_tar("complete_syn.tar.gz", "COMPLETE", 1000, 4, "et_complete_syn", rng, max_per_shard=350))
    et_items.extend(stream_easy_turn_tar("incomplete_real.tar.gz", "INCOMPLETE", 2450, 32, "et_incomplete_real", rng, max_per_shard=90))
    et_items.extend(stream_easy_turn_tar("incomplete_syn.tar.gz", "INCOMPLETE", 1000, 4, "et_incomplete_syn", rng, max_per_shard=350))
    et_items.extend(
        stream_easy_turn_tar(
            "backchannel_real.tar.gz",
            "BACKCHANNEL",
            1350,
            25,
            "et_backchannel_real",
            rng,
            max_per_shard=140,
            min_sec_quota=(0.65, 900),
        )
    )
    et_items.extend(stream_easy_turn_tar("backchannel_syn.tar.gz", "BACKCHANNEL", 1200, 20, "et_backchannel_syn", rng, max_per_shard=140))
    et_items.extend(stream_easy_turn_tar("wait.tar.gz", "WAIT_INTERRUPT", 2100, 20, "et_wait", rng, max_per_shard=130))

    et_train, et_val = split_grouped(et_items, val_frac=0.11)

    # 2. smart-turn-data-v3.2-train (EN + ZH COMPLETE / INCOMPLETE)
    st_train_shards = [f"data/train-{i:05d}-of-00083.parquet" for i in range(args.smart_turn_train_shards)]
    st_items = prepare_smart_turn(
        "pipecat-ai/smart-turn-data-v3.2-train",
        st_train_shards,
        "smart_turn_train",
        targets_per_cell={
            ("EN", "COMPLETE"): 1950,
            ("EN", "INCOMPLETE"): 1950,
            ("ZH", "COMPLETE"): 950,
            ("ZH", "INCOMPLETE"): 950,
        },
    )
    st_train, st_val = split_grouped(st_items, val_frac=0.11)

    # 3. Synthesized multi-voice EN & CS BACKCHANNEL + WAIT_INTERRUPT + ZH COMPLETE/INCOMPLETE
    tts_train, tts_val, tts_holdout = prepare_synth_tts(rng)
    zh_tts_train, zh_tts_val = prepare_synth_zh_turns(rng)

    # Merge train & val, and normalize raw Easy-Turn / smart-turn training waveforms cleanly
    train_all = normalize_training_waveforms(et_train + st_train + tts_train + zh_tts_train, rng)
    val_all = et_val + st_val + tts_val + zh_tts_val
    rng.shuffle(train_all)

    # 4. Evaluation test sets
    easy_turn_test = prepare_easy_turn_testset()
    st_test_shards = [f"data/train-{i:05d}-of-00010.parquet" for i in range(args.smart_turn_test_shards)]
    smart_turn_test = prepare_smart_turn(
        "pipecat-ai/smart-turn-data-v3.2-test",
        st_test_shards,
        "smart_turn_test",
        targets_per_cell=None,
    )

    write_jsonl(PREP_DIR / "train.jsonl", train_all)
    write_jsonl(PREP_DIR / "val.jsonl", val_all)
    write_jsonl(PREP_DIR / "holdout_en_cs.jsonl", tts_holdout)
    write_jsonl(PREP_DIR / "easy_turn_test.jsonl", easy_turn_test)
    write_jsonl(PREP_DIR / "smart_turn_test.jsonl", smart_turn_test)

    def summarize(rows: list[dict]) -> dict:
        return {
            "total": len(rows),
            "by_label": dict(Counter(r["label"] for r in rows)),
            "by_lang": dict(Counter(r["lang"] for r in rows)),
            "by_label_lang": {f"{k[0]}:{k[1]}": v for k, v in sorted(Counter((r["label"], r["lang"]) for r in rows).items())},
        }

    summary = {
        "classes": CLASSES,
        "train": summarize(train_all),
        "val": summarize(val_all),
        "holdout_en_cs": summarize(tts_holdout),
        "easy_turn_test": summarize(easy_turn_test),
        "smart_turn_test": summarize(smart_turn_test),
    }
    (PREP_DIR / "dataset_summary.json").write_text(json.dumps(summary, indent=2, ensure_ascii=False))
    print("\n=== Dataset Preparation Summary ===")
    print(json.dumps(summary, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
