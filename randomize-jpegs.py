#!/usr/bin/env python3
"""
randomize-jpegs.py

Randomly shuffles the order of .jpg files in a folder and renames
them in sequence: 1.jpg, 2.jpg, 3.jpg, ...

Usage:
    python3 randomize-jpegs.py /path/to/folder
    python3 randomize-jpegs.py /path/to/folder --start 1 --seed 42
    python3 randomize-jpegs.py /path/to/folder --dry-run

Options:
    --start N     Start numbering at N instead of 1
    --seed N      Random seed, for reproducibility
    --dry-run     Show what would happen without renaming anything
"""

import argparse
import sys
from pathlib import Path

from archivumlib import randomize


def main():
    parser = argparse.ArgumentParser(description="Randomly renumber jpeg files in a folder.")
    parser.add_argument("folder", type=str, help="Path to the folder containing jpegs")
    parser.add_argument("--start", type=int, default=1, help="Starting number (default: 1)")
    parser.add_argument("--seed", type=int, default=None, help="Random seed for reproducibility")
    parser.add_argument("--dry-run", action="store_true", help="Preview without renaming")
    args = parser.parse_args()

    folder = Path(args.folder).expanduser()
    if not folder.is_dir():
        print(f"Error: '{folder}' is not a valid directory.")
        sys.exit(1)

    result = randomize.randomize_jpegs(
        {
            "folder": str(folder),
            "start": args.start,
            "seed": args.seed,
        },
        dry_run=args.dry_run,
    )

    entries = result["entries"]

    if not entries:
        print(f"No .jpg files found in {folder}")
        sys.exit(0)

    print(f"Found {len(entries)} jpeg(s) in {folder}\n")

    for entry in entries:
        print(f"{Path(entry['source']).name}  ->  {Path(entry['destination']).name}")

    if args.dry_run:
        print("\nDry run: no files were renamed.")
        return

    print(f"\nDone. Renamed {len(entries)} file(s).")


if __name__ == "__main__":
    main()