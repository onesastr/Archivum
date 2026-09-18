#!/usr/bin/env python3
"""
random_rename_jpegs.py

Randomly shuffles the order of .jpg files in a folder and renames
them in sequence: 1.jpg, 2.jpg, 3.jpg, ...

Usage:
    python3 random_rename_jpegs.py /path/to/folder
    python3 random_rename_jpegs.py /path/to/folder --start 1 --seed 42
    python3 random_rename_jpegs.py /path/to/folder --dry-run

Options:
    --start N     Start numbering at N instead of 1
    --seed N      Random seed, for reproducibility
    --dry-run     Show what would happen without renaming anything
"""

import argparse
import random
import sys
from pathlib import Path

JPEG_EXT = ".jpg"


def find_jpegs(folder: Path):
    return sorted(
        [p for p in folder.iterdir() if p.is_file() and p.suffix.lower() == JPEG_EXT]
    )


def main():
    parser = argparse.ArgumentParser(description="Randomly renumber jpeg files in a folder.")
    parser.add_argument("folder", type=str, help="Path to the folder containing jpegs")
    parser.add_argument("--start", type=int, default=1, help="Starting number (default: 1)")
    parser.add_argument("--seed", type=int, default=None, help="Random seed for reproducibility")
    parser.add_argument("--dry-run", action="store_true", help="Preview without renaming")
    args = parser.parse_args()

    folder = Path(args.folder).expanduser().resolve()
    if not folder.is_dir():
        print(f"Error: '{folder}' is not a valid directory.")
        sys.exit(1)

    files = find_jpegs(folder)
    if not files:
        print(f"No .jpg files found in {folder}")
        sys.exit(0)

    if args.seed is not None:
        random.seed(args.seed)

    shuffled = files[:]
    random.shuffle(shuffled)

    # Build the mapping first, keeping each file's original extension.
    plan = []
    for i, src in enumerate(shuffled, start=args.start):
        ext = src.suffix.lower()
        dst = folder / f"{i}{ext}"
        plan.append((src, dst))

    # Rename in two passes through temporary names to avoid collisions
    # (e.g. if 2.jpg already exists and is about to become 5.jpg).
    temp_plan = []
    for idx, (src, dst) in enumerate(plan):
        tmp = folder / f"__tmp_rename_{idx}__{src.suffix.lower()}"
        temp_plan.append((src, tmp, dst))

    print(f"Found {len(files)} jpeg(s) in {folder}\n")

    for src, tmp, dst in temp_plan:
        print(f"{src.name}  ->  {dst.name}")

    if args.dry_run:
        print("\nDry run: no files were renamed.")
        return

    # Pass 1: move everything to unique temp names.
    for src, tmp, _ in temp_plan:
        src.rename(tmp)

    # Pass 2: move from temp names to final numbered names.
    for _, tmp, dst in temp_plan:
        tmp.rename(dst)

    print(f"\nDone. Renamed {len(temp_plan)} file(s).")


if __name__ == "__main__":
    main()
