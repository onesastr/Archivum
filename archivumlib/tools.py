#!/usr/bin/env python3
"""Registry of automation tools exposed to the CLI and web UI.

To add a new automated organization tool, define a run function in a module
and register it here with ``register_tool``. The web UI renders each tool's
form automatically from its field metadata, so no UI changes are needed.
"""

from dataclasses import dataclass
from typing import Callable

from . import core, randomize

RunFn = Callable[[dict, bool], dict]


@dataclass(frozen=True)
class Tool:
    """Description of one automation tool.

    ``run`` receives the form configuration plus whether this is a dry run
    (preview) and must return a JSON-safe dict with an ``entries`` list of
    ``{source, destination, status, reason}``.
    """

    id: str
    name: str
    description: str
    supports_dry_run: bool
    fields: tuple
    run: RunFn

    def meta(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "description": self.description,
            "supports_dry_run": self.supports_dry_run,
            "fields": self.fields,
        }


_TOOLS: dict[str, Tool] = {}


def register_tool(tool: Tool) -> Tool:
    _TOOLS[tool.id] = tool
    return tool


def all_tools() -> list[Tool]:
    return list(_TOOLS.values())


def get_tool(tool_id: str) -> Tool:
    try:
        return _TOOLS[tool_id]
    except KeyError:
        raise ValueError(f"Unknown tool: {tool_id}")


def run_tool(tool_id: str, config: dict, dry_run: bool) -> dict:
    return get_tool(tool_id).run(config, dry_run)


register_tool(
    Tool(
        id="organize-by-date",
        name="Organize by date",
        description=(
            "Move files into YYYY_MM_DD folders using the modification, "
            "creation, or EXIF camera capture date."
        ),
        supports_dry_run=True,
        fields=(
            {
                "name": "folder",
                "label": "Folder",
                "type": "folder",
                "required": True,
                "placeholder": "/path/to/photos",
            },
            {
                "name": "mode",
                "label": "Date mode",
                "type": "select",
                "default": "exif",
                "options": [
                    {"value": "modified", "label": "Modified"},
                    {"value": "created", "label": "Created"},
                    {"value": "exif", "label": "EXIF (camera date)"},
                ],
            },
            {
                "name": "recursive",
                "label": "Include subfolders",
                "type": "bool",
                "default": False,
            },
        ),
        run=core.organize_by_date,
    )
)

register_tool(
    Tool(
        id="randomize-jpegs",
        name="Randomize JPEG order",
        description=(
            "Shuffle .jpg files in a folder and renumber them in sequence "
            "(1.jpg, 2.jpg, ...)."
        ),
        supports_dry_run=True,
        fields=(
            {
                "name": "folder",
                "label": "Folder",
                "type": "folder",
                "required": True,
                "placeholder": "/path/to/jpgs",
            },
            {
                "name": "start",
                "label": "Starting number",
                "type": "number",
                "default": 1,
            },
            {
                "name": "seed",
                "label": "Random seed",
                "type": "number",
                "default": None,
            },
        ),
        run=randomize.randomize_jpegs,
    )
)