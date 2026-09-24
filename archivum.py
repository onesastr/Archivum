#!/usr/bin/env python3

import argparse
import sys
from pathlib import Path

from archivumlib import core

STATUS_LABELS = {
    "moved": "MOVED",
    "planned": "WOULD MOVE",
    "skipped": "SKIP",
    "error": "ERROR",
}


def _print_entry(entry: dict) -> None:
    label = STATUS_LABELS.get(entry["status"], entry["status"])

    if entry["status"] == "skipped":
        print(f"{label}: {entry['reason']}")
    elif entry["destination"]:
        print(
            f"{label}: {entry['source']} -> {entry['destination']}"
        )
    else:
        print(f"{label}: {entry['source']}")


def organize_folder(
    parent: Path,
    mode: str = "modified",
    dry_run: bool = False,
    recursive: bool = False,
) -> None:
    """Organize files into YYYY_MM_DD folders."""

    result = core.organize_by_date(
        {
            "folder": str(parent),
            "mode": mode,
            "recursive": recursive,
        },
        dry_run=dry_run,
    )

    for entry in result["entries"]:
        _print_entry(entry)


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

    try:
        organize_folder(
            Path(args.folder),
            mode=args.mode,
            dry_run=args.dry_run,
            recursive=args.recursive,
        )
    except ValueError as err:
        print(f"Error: {err}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()