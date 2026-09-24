# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller build spec for the Archivum desktop app.

Packages webui.py and every static asset into a single clickable executable:

- Windows: dist/Archivum.exe   (no console window)
- macOS:   dist/Archivum.app   (double-clickable app bundle)
- Linux:   dist/Archivum       (plain executable; windowed mode is ignored
                                on *nix, so no .app is produced there)

Build locally with:

    python -m pip install -r requirements.txt pyinstaller
    pyinstaller --clean --noconfirm Archivum.spec
"""

from PyInstaller.utils.hooks import collect_submodules

# archivumlib/__init__.py imports nothing, but webui.py imports
# archivumlib.tools which pulls in core and randomize. Collecting all
# submodules keeps future tools from being missed without a spec change.
hiddenimports = collect_submodules("archivumlib")
# exifread is imported at the top of archivumlib/core.py; list it explicitly
# so a frozen build fails loudly if the dependency is ever missing.
hiddenimports += ["exifread"]

# Static site files the web server serves at runtime (index.html, app.js,
# style.css). In a onefile build these are unpacked to sys._MEIPASS, which
# webui.py already resolves.
datas = [("webui/static", "webui/static")]

a = Analysis(
    ["webui.py"],
    pathex=[],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="Archivum",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

# macOS only: wraps the executable in a double-clickable .app bundle.
# A no-op on Windows and Linux.
app = BUNDLE(
    exe,
    name="Archivum.app",
    icon=None,
    bundle_identifier="com.onesastr.archivum",
)