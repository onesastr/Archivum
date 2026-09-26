# LibRaw binaries

`RawDecoder` spawns a LibRaw command-line binary rather than linking a native
Node addon, so Archivum needs no Electron ABI rebuild on every Electron upgrade
and the same code path works from a packaged AppImage.

Expected layout, one directory per platform and architecture:

    resources/libraw/linux-x64/dcraw_emu
    resources/libraw/linux-arm64/dcraw_emu
    resources/libraw/mac-x64/dcraw_emu
    resources/libraw/mac-arm64/dcraw_emu

Each file must be executable. Build them from a LibRaw source tree with

    make -j"$(nproc)"
    find . -name dcraw_emu -exec cp {} /path/to/archivum/resources/libraw/<target>/ \;

Until a binary for the running platform is present, RAW files still index and
their EXIF is still read, but the grid shows a placeholder and the preview pane
reports "LibRaw is not available in this build".
