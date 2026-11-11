#!/usr/bin/env python3
"""
Split emage_step_int8.onnx into fixed-size chunks for parallel HTTP/2/3 downloading
and mobile network retry resilience, producing out/final/chunks/<model>.json + .0..N.
"""
import argparse
import hashlib
import json
import math
import os
import sys

DEFAULT_CHUNK_SIZE = 8 * 1024 * 1024  # 8 MiB per chunk (8 chunks for ~63.47 MiB)


def sha256_file(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def split_onnx(input_path: str, output_dir: str, chunk_size: int = DEFAULT_CHUNK_SIZE) -> str:
    if not os.path.isfile(input_path):
        print(f"Error: input file not found: {input_path}", file=sys.stderr)
        sys.exit(1)

    os.makedirs(output_dir, exist_ok=True)
    base_name = os.path.basename(input_path)
    total_size = os.path.getsize(input_path)
    expected_sha256 = sha256_file(input_path)
    chunk_count = math.ceil(total_size / chunk_size)

    # Remove stale chunks for this base_name if chunk_count shrank
    for existing in os.listdir(output_dir):
        if existing.startswith(f"{base_name}.") and existing != f"{base_name}.json":
            os.remove(os.path.join(output_dir, existing))

    print(
        f"Splitting {base_name} ({total_size / (1024 * 1024):.2f} MiB, sha256={expected_sha256[:16]}...) "
        f"into {chunk_count} chunks of <= {chunk_size / (1024 * 1024):.1f} MiB..."
    )

    chunks = []
    reconstructed_hash = hashlib.sha256()
    offset = 0

    with open(input_path, "rb") as f_in:
        for i in range(chunk_count):
            data = f_in.read(chunk_size)
            actual_size = len(data)
            chunk_name = f"{base_name}.{i}"
            chunk_path = os.path.join(output_dir, chunk_name)
            with open(chunk_path, "wb") as f_out:
                f_out.write(data)
            reconstructed_hash.update(data)
            chunks.append({
                "name": chunk_name,
                "offset": offset,
                "size": actual_size,
            })
            print(f"  [{i + 1}/{chunk_count}] {chunk_name} ({actual_size / (1024 * 1024):.2f} MiB, offset={offset})")
            offset += actual_size

    if offset != total_size or reconstructed_hash.hexdigest() != expected_sha256:
        print("Error: chunk verification failed (size or sha256 mismatch)!", file=sys.stderr)
        sys.exit(2)

    manifest = {
        "version": "1.0.0",
        "file": base_name,
        "sha256": expected_sha256,
        "totalSize": total_size,
        "chunkSize": chunk_size,
        "chunkCount": chunk_count,
        "chunks": chunks,
    }
    manifest_path = os.path.join(output_dir, f"{base_name}.json")
    with open(manifest_path, "w", encoding="utf-8") as f_manifest:
        json.dump(manifest, f_manifest, indent=2)
        f_manifest.write("\n")

    print(f"Verified SHA-256 match! Manifest written to {manifest_path}")
    return manifest_path


def main() -> None:
    here = os.path.dirname(os.path.abspath(__file__))
    parser = argparse.ArgumentParser(description="Split EMAGE step ONNX into parallel download chunks.")
    parser.add_argument(
        "--input",
        default=os.path.join(here, "out", "final", "emage_step_int8.onnx"),
        help="Path to input .onnx file",
    )
    parser.add_argument(
        "--output-dir",
        default=os.path.join(here, "out", "final", "chunks"),
        help="Directory to write manifest + chunks",
    )
    parser.add_argument(
        "--chunk-mib",
        type=int,
        default=8,
        help="Chunk size in MiB (default: 8)",
    )
    args = parser.parse_args()
    split_onnx(args.input, args.output_dir, args.chunk_mib * 1024 * 1024)


if __name__ == "__main__":
    main()
