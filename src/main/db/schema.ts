export const MIGRATIONS: string[] = [
  `
  CREATE TABLE IF NOT EXISTS volumes (
    path TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    kind TEXT NOT NULL,
    filesystem TEXT,
    total_bytes INTEGER,
    free_bytes INTEGER,
    is_network INTEGER NOT NULL DEFAULT 0,
    favorite INTEGER NOT NULL DEFAULT 0,
    last_seen_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS folders (
    id INTEGER PRIMARY KEY,
    path TEXT NOT NULL UNIQUE,
    parent_id INTEGER REFERENCES folders(id) ON DELETE CASCADE,
    volume_path TEXT,
    name TEXT NOT NULL,
    depth INTEGER NOT NULL DEFAULT 0,
    file_count INTEGER NOT NULL DEFAULT 0,
    dir_count INTEGER NOT NULL DEFAULT 0,
    total_bytes INTEGER NOT NULL DEFAULT 0,
    favorite INTEGER NOT NULL DEFAULT 0,
    scan_state TEXT NOT NULL DEFAULT 'pending',
    scanned_at INTEGER,
    indexed_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_folders_parent ON folders(parent_id);
  CREATE INDEX IF NOT EXISTS idx_folders_volume ON folders(volume_path);
  CREATE INDEX IF NOT EXISTS idx_folders_favorite ON folders(favorite);

  CREATE TABLE IF NOT EXISTS files (
    id INTEGER PRIMARY KEY,
    folder_id INTEGER NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
    path TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    ext TEXT NOT NULL,
    kind TEXT NOT NULL,
    size_bytes INTEGER NOT NULL DEFAULT 0,
    mtime_ms INTEGER NOT NULL DEFAULT 0,
    birthtime_ms INTEGER,
    inode TEXT,
    width INTEGER,
    height INTEGER,
    orientation INTEGER,
    capture_at INTEGER,
    capture_source TEXT NOT NULL DEFAULT 'unknown',
    camera TEXT,
    lens TEXT,
    iso INTEGER,
    aperture REAL,
    shutter REAL,
    focal_length REAL,
    gps_lat REAL,
    gps_lon REAL,
    icc_name TEXT,
    color_space TEXT,
    bits_per_sample INTEGER,
    metadata_state TEXT NOT NULL DEFAULT 'pending',
    thumb_state TEXT NOT NULL DEFAULT 'pending',
    indexed_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_files_folder ON files(folder_id);
  CREATE INDEX IF NOT EXISTS idx_files_capture ON files(capture_at);
  CREATE INDEX IF NOT EXISTS idx_files_kind ON files(kind);
  CREATE INDEX IF NOT EXISTS idx_files_state ON files(metadata_state, thumb_state);
  CREATE INDEX IF NOT EXISTS idx_files_camera ON files(camera);

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
  `
]
