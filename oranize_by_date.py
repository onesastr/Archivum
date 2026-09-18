#!/usr/bin/env python3
import argparse
import shutil
from datetime import datetime
from pathlib import Path

DATE_FORMAT = "%Y_%m_%d"


def get_file_date(path: Path, mode: str) -> datetime:
    stat = path.stat()
    if mode == "modified":
        return datetime.fromtimestamp(stat.st_mtime)
    if mode == "created":
        return datetime.fromtimestamp(stat.st_ctime)
    raise ValueError("mode must be 'modified' or 'created'")


def unique_destination(dest: Path) -> Path:
    if not dest.exists():
        return dest
    stem = dest.stem
    suffix = dest.suffix
    parent = dest.parent
    i = 1
    while True:
        candidate = parent / f"{stem} ({i}){suffix}"
        if not candidate.exists():
            return candidate
        i += 1


def organize_folder(parent: Path, mode: str = "modified", dry_run: bool = False, recursive: bool = False) -> None:
    parent = parent.resolve()

    items = parent.rglob("*") if recursive else parent.iterdir()
    for item in items:
        if not item.is_file():
            continue

        dt = get_file_date(item, mode)
        target_dir = parent / dt.strftime(DATE_FORMAT)
        target = target_dir / item.name

        if item.parent == target_dir:
            continue

        if not dry_run:
            target_dir.mkdir(parents=True, exist_ok=True)
            target = unique_destination(target)
            shutil.move(str(item), str(target))

        print(f"{item} -> {target}")


def main():
    parser = argparse.ArgumentParser(description="Organize files into YYYY_MM_DD folders based on file date.")
    parser.add_argument("folder", help="Parent folder to organize")
    parser.add_argument("--mode", choices=["modified", "created"], default="modified", help="Which file date to use")
    parser.add_argument("--dry-run", action="store_true", help="Show what would move without changing files")
    parser.add_argument("--recursive", action="store_true", help="Include files in subfolders")
    args = parser.parse_args()

    organize_folder(Path(args.folder), mode=args.mode, dry_run=args.dry_run, recursive=args.recursive)


if __name__ == "__main__":
    main()