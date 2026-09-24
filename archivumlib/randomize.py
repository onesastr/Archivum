"""Random renumbering of .jpg files, shared by the CLI and web UI."""

import random
from pathlib import Path


def randomize_plan(
    folder: Path, start: int = 1, seed: int | None = None
) -> tuple[Path, list[tuple[Path, Path]]]:
    """Build the shuffled (source -> destination) plan for a folder."""

    folder = folder.expanduser().resolve()

    files = sorted(
        p for p in folder.iterdir()
        if p.is_file() and p.suffix.lower() == ".jpg"
    )

    if not files:
        return folder, []

    shuffled = files[:]
    random.Random(seed).shuffle(shuffled)

    plan = []
    for i, src in enumerate(shuffled, start=start):
        plan.append((src, folder / f"{i}{src.suffix.lower()}"))

    return folder, plan


def _execute_plan(plan: list[tuple[Path, Path]]) -> None:
    """Rename through temporary names so two files never collide."""
    temp_names = [
        f"__tmp_rename_{idx}__{src.suffix.lower()}"
        for idx, (src, _) in enumerate(plan)
    ]
    for (src, _), tmp in zip(plan, temp_names):
        src.rename(src.parent / tmp)
    for (_, dst), tmp in zip(plan, temp_names):
        (dst.parent / tmp).rename(dst)


def randomize_jpegs(config: dict, dry_run: bool) -> dict:
    """Run the randomize tool and return a JSON-safe result."""

    folder = Path(config.get("folder", "")).expanduser()

    if not folder.is_dir():
        raise ValueError(f"Folder does not exist: {folder}")

    folder, plan = randomize_plan(
        folder,
        start=int(config.get("start", 1)),
        seed=config.get("seed"),
    )

    if not dry_run and plan:
        _execute_plan(plan)

    return {
        "tool": "randomize-jpegs",
        "dry_run": dry_run,
        "folder": str(folder),
        "entries": [
            {
                "source": str(src),
                "destination": str(dst),
                "status": "moved" if not dry_run else "planned",
                "reason": "",
            }
            for src, dst in plan
        ],
    }
