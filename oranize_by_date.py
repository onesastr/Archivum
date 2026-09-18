#!/usr/bin/env python3

import argparse
import shutil
from datetime import datetime
from pathlib import Path

import exifread


DATE_FORMAT = "%Y_%m_%d"


def get_modified_date(path: Path) -> datetime:
    """Return the filesystem modification date."""
    return datetime.fromtimestamp(path.stat().st_mtime)


def get_created_date(path: Path) -> datetime:
    """
    Return the filesystem creation date when available.

    macOS provides st_birthtime.
    On systems without st_birthtime, fall back to st_ctime.
    """
    stat = path.stat()

    if hasattr(stat, "st_birthtime"):
        return datetime.fromtimestamp(stat.st_birthtime)

    # Linux: st_ctime is metadata change time, not true creation time.
    return datetime.fromtimestamp(stat.st_ctime)


def get_exif_date(path: Path) -> datetime | None:
    """
    Return the camera capture date from EXIF DateTimeOriginal.

    Returns None if EXIF data or DateTimeOriginal is unavailable.
    """
    try:
        with path.open("rb") as f:
            tags = exifread.process_file(
                f,
                stop_tag="DateTimeOriginal",
                details=False,
            )

        date_tag = tags.get("EXIF DateTimeOriginal")

        if not date_tag:
            return None

        return datetime.strptime(
            str(date_tag),
            "%Y:%m:%d %H:%M:%S",
        )

    except Exception:
        return None


def get_file_date(path: Path, mode: str) -> datetime:
    """Get the date used to organize a file."""

    if mode == "modified":
        return get_modified_date(path)

    if mode == "created":
        return get_created_date(path)

    if mode == "exif":
        exif_date = get_exif_date(path)

        if exif_date is None:
            raise ValueError(
                f"No EXIF capture date found for: {path}"
            )

        return exif_date

    raise ValueError(
        "mode must be 'modified', 'created', or 'exif'"
    )


def unique_destination(dest: Path) -> Path:
    """Return a unique destination path if a file already exists."""

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


def organize_folder(
    parent: Path,
    mode: str = "modified",
    dry_run: bool = False,
    recursive: bool = False,
) -> None:
    """Organize files into YYYY_MM_DD folders."""

    parent = parent.resolve()

    items = parent.rglob("*") if recursive else parent.iterdir()

    for item in items:
        if not item.is_file():
            continue

        try:
            dt = get_file_date(item, mode)

        except ValueError as e:
            print(f"SKIP: {e}")
            continue

        target_dir = parent / dt.strftime(DATE_FORMAT)
        target = target_dir / item.name

        # Don't move a file that's already in the correct folder.
        if item.parent == target_dir:
            continue

        if not dry_run:
            target_dir.mkdir(
                parents=True,
                exist_ok=True,
            )

            target = unique_destination(target)

            shutil.move(
                str(item),
                str(target),
            )

        print(f"{item} -> {target}")


def main():
    parser = argparse.ArgumentParser(
        description=(
            "Organize files into YYYY_MM_DD folders "
            "based on file date."
        )
    )

    parser.add_argument(
        "folder",
        help="Parent folder to organize",
    )

    parser.add_argument(
        "--mode",
        choices=["modified", "created", "exif"],
        default="modified",
        help=(
            "Date source to use: "
            "modified, created, or exif"
        ),
    )

    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show what would move without changing files",
    )

    parser.add_argument(
        "--recursive",
        action="store_true",
        help="Include files in subfolders",
    )

    args = parser.parse_args()

    organize_folder(
        Path(args.folder),
        mode=args.mode,
        dry_run=args.dry_run,
        recursive=args.recursive,
    )


if __name__ == "__main__":
    main()