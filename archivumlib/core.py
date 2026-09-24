#!/usr/bin/env python3
"""Core archiving operations shared by the CLI and the web UI."""

import shutil
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

import exifread


DATE_FORMAT = "%Y_%m_%d"

# exifread returns tags keyed as "IFD TAG". Cameras and tools store the
# capture date under any of these, so check them all.
EXIF_DATE_KEYS = (
    "EXIF DateTimeOriginal",
    "EXIF DateTimeDigitized",
    "Image DateTimeOriginal",
    "Image DateTime",
    "Thumbnail DateTime",
)

# Date formats EXIF dates may appear in.
EXIF_DATE_FORMATS = (
    "%Y:%m:%d %H:%M:%S",
    "%Y:%m:%d",
    "%Y-%m-%d %H:%M:%S",
    "%Y-%m-%d",
)


@dataclass
class MoveItem:
    """One source file and what happened (or would happen) to it."""

    source: Path
    destination: Path | None = None
    status: str = "planned"  # planned | moved | skipped | error
    reason: str = ""


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


def _parse_exif_date(value) -> datetime | None:
    """
    Parse a date read by exifread into a datetime.

    Handles trailing null bytes, spaces, and sub-second suffixes that some
    cameras write. Returns None when the value is not a usable date.
    """
    raw = str(value).strip().strip("\x00")

    if not raw:
        return None

    for candidate in (raw, raw[:19]):
        for fmt in EXIF_DATE_FORMATS:
            try:
                return datetime.strptime(candidate, fmt)
            except ValueError:
                continue

    return None


def get_exif_date(path: Path) -> datetime | None:
    """
    Return the capture date stored in a photo's EXIF metadata.

    Tries DateTimeOriginal first, then falls back to DateTimeDigitized and
    the IFD0 DateTime, since many tools and camera pipelines only write one
    of these. Returns None when no usable date is available.
    """
    try:
        with path.open("rb") as f:
            tags = exifread.process_file(f, details=False)

    except Exception:
        return None

    for key in EXIF_DATE_KEYS:
        tag = tags.get(key)

        if tag is None:
            continue

        dt = _parse_exif_date(tag)

        if dt is not None:
            return dt

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
) -> list[MoveItem]:
    """Organize files into YYYY_MM_DD folders and report each move."""

    parent = parent.resolve()

    items = parent.rglob("*") if recursive else parent.iterdir()

    results: list[MoveItem] = []

    for item in items:
        if not item.is_file():
            continue

        try:
            dt = get_file_date(item, mode)

        except ValueError as e:
            results.append(MoveItem(item, status="skipped", reason=str(e)))
            continue

        target_dir = parent / dt.strftime(DATE_FORMAT)
        target = target_dir / item.name

        # Don't move a file that's already in the correct folder.
        if item.parent == target_dir:
            results.append(
                MoveItem(item, target, status="skipped", reason="already in place")
            )
            continue

        if dry_run:
            results.append(MoveItem(item, target, status="planned"))
            continue

        target_dir.mkdir(parents=True, exist_ok=True)

        target = unique_destination(target)

        shutil.move(str(item), str(target))

        results.append(MoveItem(item, target, status="moved"))

    return results


def organize_by_date(config: dict, dry_run: bool) -> dict:
    """Run the organize-by-date tool and return a JSON-safe result."""

    folder = Path(config.get("folder", "")).expanduser()

    if not folder.is_dir():
        raise ValueError(f"Folder does not exist: {folder}")

    mode = config.get("mode", "modified")
    recursive = bool(config.get("recursive", False))

    items = organize_folder(
        folder,
        mode=mode,
        dry_run=dry_run,
        recursive=recursive,
    )

    return {
        "tool": "organize-by-date",
        "dry_run": dry_run,
        "folder": str(folder.resolve()),
        "entries": [
            {
                "source": str(item.source),
                "destination": str(item.destination) if item.destination else None,
                "status": item.status,
                "reason": item.reason,
            }
            for item in items
        ],
    }