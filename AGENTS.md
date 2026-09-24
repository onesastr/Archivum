# AGENTS.md

Guidance for AI coding agents working in this repository.

## Project overview

Archivum is a photo-archiving toolbox: it organizes picture files into
`YYYY_MM_DD` folders by date and can randomly renumber `.jpg` files. It ships
two front ends sharing one library:

- Command-line scripts (`archivum.py`, `randomize-jpegs.py`)
- A local web UI (`webui.py`) built only on the Python standard library
  (`http.server`), plus a small JSON API consumed by the front end in
  `webui/static/`.

The web UI is also packaged as a double-clickable desktop app for Windows,
macOS, and Linux via PyInstaller and a GitHub Actions workflow.

## Layout

```
archivum.py            CLI: organize-by-date
randomize-jpegs.py     CLI: randomize JPEG order
webui.py               Entry point for the web UI and the packaged desktop app
webui/static/          index.html, app.js, style.css (served by webui.py)
archivumlib/
  core.py              Shared date/organize logic; imports exifread
  randomize.py         Shared JPEG renumbering logic
  tools.py             Tool registry the web UI renders dynamically
  __init__.py          Empty package init
Archivum.spec          PyInstaller build definition
.github/workflows/     build.yml: tag push -> builds + GitHub Release
requirements.txt       Only dependency: exifread
```

## Running the project

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

python webui.py                  # web UI  -> http://127.0.0.1:8000
python archivum.py "FOLDER" --dry-run
python randomize-jpegs.py "FOLDER" --dry-run
```

`webui.py` opens the default browser on startup and, if the requested port is
busy, automatically binds the next free port instead of failing.

## Building the desktop app

```bash
pip install pyinstaller
pyinstaller --noconfirm --clean Archivum.spec
```

Outputs: `dist/Archivum.exe` (Windows), `dist/Archivum.app` (macOS,
windowed), `dist/Archivum` (Linux).

The GitHub workflow in `.github/workflows/build.yml` runs this on all three
OSes whenever a `v*` tag is pushed, and attaches the binaries to a GitHub
Release.

### Package specifics to keep intact

- `webui.py` must resolve its data directory from `sys._MEIPASS` when frozen
  (`sys.frozen`), else from `__file__` — do not regress this or static
  assets stop loading in the packaged app.
- The spec bundles `webui/static -> webui/static` and imports
  `collect_submodules("archivumlib")` plus an explicit `hiddenimports`
  entry for `exifread`. When adding new tools, keep them as modules under
  `archivumlib/` so collection stays automatic.
- `Archivum.spec` uses `console=False` so no terminal window appears on
  Windows/macOS; Linux ignores it.

## Architecture conventions

- Keep `webui.py` and the front end on the Python standard library — no new
  web framework dependencies.
- Tools are registered in `archivumlib/tools.py` via `register_tool(Tool(...))`.
  A tool's `run(config, dry_run)` must return a JSON-safe dict with an
  `entries` list of `{"source", "destination", "status", "reason"}`. Adding a
  tool there renders it in the UI automatically (no front-end changes).
- `dry_run=True` is always a preview: never mutate files.
- All user-facing API responses from `webui.py` are JSON; errors use sensible
  HTTP status codes (400/403/404/500).
- Use docstrings for modules and nontrivial functions; avoid inline comments.

## Verification

There is no test suite in this repository. Verify changes by:

```bash
python webui.py --no-browser --port 8123   # then curl endpoints
curl http://127.0.0.1:8123/api/tools
curl http://127.0.0.1:8123/static/app.js
```

and, when packaging changes are involved, a local `pyinstaller --noconfirm
--clean Archivum.spec` run plus a smoke test of the resulting `dist/Archivum`
binary.