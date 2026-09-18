# Archivum

Archivum organizes files into date-based folders using each file's modification date or filesystem creation/change date.

## Requirements

- Python 3.9 or newer
- No third-party packages required

## Usage

Preview the changes before moving anything:

```bash
python archivum.py "/path/to/folder" --dry-run
```

Organize files by modification date:

```bash
python archivum.py "/path/to/folder"
```

Use filesystem creation/change date:

```bash
python archivum.py "/path/to/folder" --mode created
```

Include files within subdirectories:

```bash
python archivum.py "/path/to/folder" --recursive
```

## Behavior

- Files move into folders named `YYYY_MM_DD`.
- If a target filename already exists, Archivum preserves both files by adding ` (1)`, ` (2)`, and so on.
- Files already in their appropriate date folder are skipped.
- Always use `--dry-run` first when organizing an important folder.

## Note on creation dates

`--mode created` uses Python's `st_ctime`. On Windows this is generally the file creation time. On macOS and Linux, it can instead represent metadata-change time, depending on the filesystem and platform.
