"""Shared helpers for the emage-onnx pack.

The pack never modifies the sibling emage-onnx-export checkout. It only READS:
  * <export-dir>/onnx/*.onnx           (baseline models, for comparison)
  * <export-dir>/PantoMatrix/.git      (to extract the model code at MODEL_COMMIT)
and writes everything under  packages/emage-onnx/out/  (gitignored).
"""
import os
import subprocess
import sys
import tarfile
import io

PACK_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.abspath(os.path.join(PACK_DIR, "..", ".."))
DEFAULT_OUT = os.path.join(PACK_DIR, "out")
CACHE_DIR = os.path.join(PACK_DIR, ".cache")

# Same constants as emage-onnx-export/export_onnx.py (README-documented flow).
MODEL_COMMIT = "0bbb03d"          # PantoMatrix commit that matches the HF weights H-Liu1997/emage_audio
PANTO_URL = "https://github.com/H-Liu1997/PantoMatrix.git"
HF_REPO = "H-Liu1997/emage_audio"
WINDOW_FRAMES = 64
SEED_FRAMES = 4
SAMPLES_PER_FRAME = 16000 // 30   # 533
WINDOW_AUDIO_LEN = WINDOW_FRAMES * SAMPLES_PER_FRAME  # 34112
MOTION_DIM = 337


def default_export_dir():
    """emage-onnx-export is expected next to the Project-XiaoChun checkout."""
    env = os.environ.get("EMAGE_EXPORT_DIR")
    if env:
        return os.path.abspath(env)
    return os.path.abspath(os.path.join(REPO_ROOT, "..", "emage-onnx-export"))


def ensure_pantomatrix_code(export_dir):
    """Return a directory containing `models/` + `emage_utils/` at MODEL_COMMIT.

    Uses `git archive` from the (read-only) PantoMatrix clone inside emage-onnx-export, or clones
    PantoMatrix into the pack cache when no clone is available. The export repo's working tree and
    index are never touched (unlike `git checkout <rev> -- models/` which export_onnx.py performs).
    """
    dst = os.path.join(CACHE_DIR, f"PantoMatrix_{MODEL_COMMIT}")
    if os.path.isdir(os.path.join(dst, "models", "emage_audio")):
        return dst
    os.makedirs(dst, exist_ok=True)
    src = os.path.join(export_dir, "PantoMatrix")
    if not os.path.isdir(os.path.join(src, ".git")):
        src = os.path.join(CACHE_DIR, "PantoMatrix.git-clone")
        if not os.path.isdir(src):
            print(f"Cloning {PANTO_URL} -> {src}")
            subprocess.check_call(["git", "clone", "--quiet", PANTO_URL, src])
    data = subprocess.check_output(
        ["git", "-C", src, "archive", MODEL_COMMIT, "models", "emage_utils"])
    with tarfile.open(fileobj=io.BytesIO(data)) as tf:
        tf.extractall(dst)
    print(f"Extracted PantoMatrix@{MODEL_COMMIT} models/ + emage_utils/ -> {dst}")
    return dst


def mb(path):
    return os.path.getsize(path) / 1e6


def log(msg):
    print(msg, flush=True)
