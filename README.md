# Archivum

Archivum is a small photo-archiving toolbox with both a command-line interface and a local web UI.

It currently ships with two automation tools:

* **Organize by date** — move files into date-based folders using one of three date sources
* **Randomize JPEG order** — shuffle `.jpg` files and renumber them in sequence

New tools can be added to `archivumlib/tools.py`; the web UI renders them automatically.

## Date sources

* **Modified** — filesystem modification date
* **Created** — filesystem creation date when available, with a platform-dependent fallback
* **EXIF** — camera capture date. Reads `DateTimeOriginal` first, then falls back to `DateTimeDigitized` and the IFD0 `DateTime`, since cameras and processing tools write the date into any of these. Resulting datetimes are parsed tolerantly (sub-second suffixes and other small irregularities are handled).

This EXIF fallback behavior means files that carry only an `Image DateTime` entry (common with downloaded or converted images) are organized correctly instead of being skipped.

## Requirements

* Python 3.9 or newer
* [ExifRead](https://pypi.org/project/ExifRead/) for EXIF date support

## Installation

Because modern Python installations may use an externally managed environment, Archivum recommends using a virtual environment.

From the Archivum project folder:

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
```

The virtual environment can be added to `.gitignore`:

```text
.venv/
```

To leave the virtual environment:

```bash
deactivate
```

When returning to the project, activate it again:

```bash
source .venv/bin/activate
```

## Web UI

The web UI is the recommended way to drive the tools. It loads a list of available tools, lets you fill in a form for each, previews the changes (dry run), and only then applies them.

Folder fields have a **Browse…** button that opens a file picker, so you can navigate the filesystem and select a folder instead of typing its path. The picker supports breadcrumb navigation, an up button, and a home shortcut. You can still type or paste a path directly if you prefer.

```bash
python webui.py
```

Open the printed URL (default `http://127.0.0.1:8000`).

Options:

```bash
python webui.py --port 9000        # different port
python webui.py --host 127.0.0.1   # bind address (default localhost)
python webui.py --no-browser      # don't try to open a browser
```

The server is bound to `127.0.0.1` by default and is intended for local use only. It will move, rename, and create files at whatever paths you provide.

### Adding a new tool

Tools are registered in `archivumlib/tools.py`. A tool declares a JSON-safe `run(config, dry_run)` function and the form fields the UI should render. Because the UI renders every tool from this metadata, adding a new automation tool requires no front-end changes.

## Usage

### Preview changes

Use `--dry-run` to see what Archivum would do without moving any files:

```bash
python archivum.py "/path/to/folder" --dry-run
```

### Organize by modification date

This is the default mode:

```bash
python archivum.py "/path/to/folder"
```

Or explicitly:

```bash
python archivum.py "/path/to/folder" --mode modified
```

### Organize by filesystem creation date

```bash
python archivum.py "/path/to/folder" --mode created
```

### Organize by camera EXIF date

Use the camera's EXIF capture date:

```bash
python archivum.py "/path/to/folder" --mode exif
```

If a file has no usable EXIF date, Archivum skips that file and reports it.

### Include subdirectories

By default, Archivum only processes files directly inside the specified folder.

Use `--recursive` to include files in subdirectories:

```bash
python archivum.py "/path/to/folder" --recursive
```

Options can be combined:

```bash
python archivum.py "/path/to/folder" --mode exif --recursive --dry-run
```

### Randomize JPEG order

Randomly renumber the `.jpg` files in a folder:

```bash
python randomize-jpegs.py "/path/to/folder"            # -> 1.jpg, 2.jpg, ...
python randomize-jpegs.py "/path/to/folder" --start 10
python randomize-jpegs.py "/path/to/folder" --seed 42  # reproducible order
python randomize-jpegs.py "/path/to/folder" --dry-run  # preview only
```

## Date Modes

Archivum supports three date sources:

| Mode       | Date source                           | Description                                                                        |
| ---------- | ------------------------------------- | ---------------------------------------------------------------------------------- |
| `modified` | `st_mtime`                            | Filesystem modification date                                                       |
| `created`  | `st_birthtime` when available         | Filesystem creation/birth date, with a platform-dependent fallback                 |
| `exif`     | EXIF capture date                     | Camera-recorded date, with several EXIF date tags tried                             |

### Modified

The default mode uses the filesystem modification timestamp.

```bash
python archivum.py "/path/to/folder" --mode modified
```

### Created

The `created` mode uses the filesystem's creation/birth timestamp when Python's platform provides one.

On macOS, Archivum uses `st_birthtime` when available.

On systems where `st_birthtime` is unavailable, Archivum falls back to `st_ctime`. On Linux, `st_ctime` represents filesystem metadata change time rather than true file creation time.

```bash
python archivum.py "/path/to/folder" --mode created
```

### EXIF

The `exif` mode reads the camera's capture date from EXIF metadata. It prefers `EXIF DateTimeOriginal`, but also accepts `DateTimeDigitized` and the IFD0 `DateTime`, because many cameras and photo tools only write one of these.

This is particularly useful for photographs because it uses the date recorded by the camera rather than the date the file was copied, edited, or downloaded.

```bash
python archivum.py "/path/to/folder" --mode exif
```

Files without a usable EXIF date are skipped rather than assigned a potentially incorrect date.

## Output Structure

Files are moved into folders named:

```text
YYYY_MM_DD
```

For example:

```text
Photos/
├── 2026_09_15/
│   ├── IMG_1234.JPG
│   └── IMG_1234.CR3
├── 2026_09_16/
│   ├── IMG_1235.JPG
│   └── IMG_1235.CR3
└── 2026_09_17/
    └── IMG_1236.CR3
```

## Behavior

* Files are moved into folders based on the selected date mode.
* Folders use the `YYYY_MM_DD` format.
* If a target filename already exists, Archivum preserves both files by adding ` (1)`, ` (2)`, and so on.
* Files already inside their appropriate date folder are skipped.
* `--dry-run` previews changes without moving files.
* Without `--recursive`, only files directly inside the specified folder are processed.
* With `--recursive`, files inside subdirectories are also processed.
* Files without a usable EXIF capture date are skipped when using `--mode exif`.

## Recommended Workflow

When organizing an important folder, preview the changes first:

```bash
python archivum.py "/path/to/folder" --mode exif --dry-run
```

Review the output.

If everything looks correct, run the command again without `--dry-run`:

```bash
python archivum.py "/path/to/folder" --mode exif
```

For a larger directory containing nested folders:

```bash
python archivum.py "/path/to/folder" --mode exif --recursive --dry-run
```

Then, after verifying the results:

```bash
python archivum.py "/path/to/folder" --mode exif --recursive
```

## License

Add your preferred license here.
