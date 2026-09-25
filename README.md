# Archivum

Archivum is a local photo-archiving toolbox. It scans a folder of pictures and
plans batch operations — organize by date, renumber, randomize order, clean
junk, or dedupe — always as a **dry run first**, then lets you **apply** and
**undo** at any time.

The app ships as a desktop application for Windows, macOS, and Linux, built on
Electron with a React + TypeScript interface (Tailwind-styled, no backend).

## Quick start (developers)

```bash
npm install
npm run dev          # launches the Electron app + renderer dev server
```

For a packaged build:

```bash
npm run typecheck    # node + web typechecks must both pass
npm run build
```

The renderer communicates with the main process over a typed IPC bridge
(`window.archivum`), injected by the preload script. The UI is mode-driven:
pick a folder, choose a batch mode, dry-run to preview the plan, apply when it
looks right, undo if you change your mind.

## Batch modes

| Mode       | What it does                                              |
| ---------- | --------------------------------------------------------- |
| **date**      | Move images into `YYYY_MM_DD` folders by capture date     |
| **renumber**  | Renumber files in sequence (e.g. `0001.jpg`, `0002.jpg`)  |
| **randomize** | Shuffle file order and renumber them                      |
| **junk**      | Flag and clean non-image junk files                       |
| **dedupe**    | Group duplicates by content hash, keeping the first       |

Every mode runs as a dry run by default. The preview shows each planned
move (`source → destination` plus a note) and a summary of what would happen.
Nothing is written to disk until you press **Apply**, and **Undo** reverts the
last applied plan.

## Date sources

When organizing by date (`date` mode), Archivum picks the capture date in this
priority:

1. **EXIF** — camera capture date (`DateTimeOriginal`, then `DateTimeDigitized`
   and IFD0 `DateTime`).
2. **Modified** — filesystem modification time (`st_mtime`).
3. **Created** — filesystem creation/birth time when the platform provides one
   (falls back to `st_ctime` on platforms without birthtime).

The EXIF fallback chain means files carrying only an `Image DateTime` entry
(common with downloaded or converted images) are still organized correctly.

## Legacy Python CLIs

The first versions of Archivum were command-line Python utilities. They still
exist in the repository for scripting use:

```bash
python archivum.py "/path/to/folder" --dry-run          # organize by date (preview)
python archivum.py "/path/to/folder" --mode exif        # organize by EXIF capture date
python randomize-jpegs.py "/path/to/folder" --dry-run   # renumber/randomize JPEGs (preview)
python webui.py --port 8000                             # old local web UI
```

These require Python 3.9+ and `exifread` (`pip install -r requirements.txt`).
New work happens in the Electron app; the CLIs are kept for compatibility.

## Development layout

```
src/
  main/           Electron main process + core organizing logic
  preload/        contextBridge: exposes window.archivum (typed IPC)
  shared/         shared types (DryRun / plan entries / apply results)
  renderer/       React UI (App.tsx), Tailwind-styled
electron.vite.config.ts
package.json
```

Add a new batch mode by extending `src/main/lib/core.ts` (`buildPlan`) and the
mode list in `src/renderer/src/App.tsx`. The IPC bridge in
`src/main/index.ts` + `src/preload/index.ts` forwards the mode to the core,
and the renderer's dry-run → apply → undo flow works for every mode without
additional IPC channels.

## License

Add your preferred license here.
