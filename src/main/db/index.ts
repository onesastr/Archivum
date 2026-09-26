import Database from 'better-sqlite3'
import type { Database as DatabaseType, Statement } from 'better-sqlite3'
import { MIGRATIONS } from './schema'
import type {
  CaptureSource,
  FileEntry,
  FileKind,
  FolderEntry,
  MetadataState,
  ScanState,
  Settings,
  VolumeInfo,
  VolumeKind
} from '../../shared/contract'
import { DEFAULT_SETTINGS } from '../../shared/contract'
import { baseNameOf, dirNameOf, extensionOf } from '../../shared/formats'

export interface FileRecord {
  path: string
  name: string
  ext: string
  kind: FileKind
  sizeBytes: number
  mtimeMs: number
  birthtimeMs: number | null
  inode: string | null
  width: number | null
  height: number | null
  orientation: number | null
  captureAt: number | null
  captureSource: CaptureSource
  camera: string | null
  lens: string | null
  iso: number | null
  aperture: number | null
  shutter: number | null
  focalLength: number | null
  gpsLat: number | null
  gpsLon: number | null
  iccName: string | null
  colorSpace: string | null
  bitsPerSample: number | null
  metadataState: MetadataState
  thumbState: string
}

export interface FolderRecord {
  path: string
  parentPath: string | null
  name: string
  depth: number
  fileCount: number
  dirCount: number
  totalBytes: number
  favorite: boolean
  scanState: ScanState
  scannedAt: number | null
}

type Row = Record<string, unknown>

function toNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function toNullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function toText(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function toBoolean(value: unknown): boolean {
  return value === 1 || value === true
}

export class ArchivumDatabase {
  private readonly handle: DatabaseType

  private readonly statements = {
    upsertVolume: null as unknown as Statement,
    listVolumes: null as unknown as Statement,
    setVolumeFavorite: null as unknown as Statement,
    getFolder: null as unknown as Statement,
    insertFolder: null as unknown as Statement,
    updateFolder: null as unknown as Statement,
    touchFolder: null as unknown as Statement,
    setFolderScanState: null as unknown as Statement,
    setFolderFavorite: null as unknown as Statement,
    childFolders: null as unknown as Statement,
    descendantFolders: null as unknown as Statement,
    favoriteFolders: null as unknown as Statement,
    deleteFilesNotIn: null as unknown as Statement,
    upsertFile: null as unknown as Statement,
    carryFileState: null as unknown as Statement,
    filesInFolders: null as unknown as Statement,
    filesInFolder: null as unknown as Statement,
    allFolderPaths: null as unknown as Statement,
    filesByPaths: null as unknown as Statement,
    pendingMetadata: null as unknown as Statement,
    pendingThumbnails: null as unknown as Statement,
    updateMetadata: null as unknown as Statement,
    setThumbState: null as unknown as Statement,
    setFilesThumbState: null as unknown as Statement,
    countFolders: null as unknown as Statement,
    countFiles: null as unknown as Statement,
    sumBytes: null as unknown as Statement,
    countStale: null as unknown as Statement,
    getSetting: null as unknown as Statement,
    putSetting: null as unknown as Statement,
    allSettings: null as unknown as Statement
  }

  constructor(path: string) {
    this.handle = new Database(path)
    this.handle.pragma('journal_mode = WAL')
    this.handle.pragma('synchronous = NORMAL')
    this.handle.pragma('foreign_keys = ON')
    this.handle.pragma('temp_store = MEMORY')
    this.handle.pragma('cache_size = -32000')
    this.migrate()
    this.prepare()
  }

  close(): void {
    this.handle.close()
  }

  get sizeBytes(): number {
    const pageCount = toNumber(this.handle.pragma('page_count', { simple: true }))
    const pageSize = toNumber(this.handle.pragma('page_size', { simple: true }), 4096)
    return pageCount * pageSize
  }

  private migrate(): void {
    const current = toNumber(this.handle.pragma('user_version', { simple: true }))
    for (let version = current; version < MIGRATIONS.length; version += 1) {
      const run = this.handle.transaction(() => {
        this.handle.exec(MIGRATIONS[version])
        this.handle.pragma(`user_version = ${version + 1}`)
      })
      run()
    }
  }

  private prepare(): void {
    this.statements.upsertVolume = this.handle.prepare(`
      INSERT INTO volumes (path, label, kind, filesystem, total_bytes, free_bytes, is_network, favorite, last_seen_at)
      VALUES (@path, @label, @kind, @filesystem, @totalBytes, @freeBytes, @isNetwork, @favorite, @lastSeenAt)
      ON CONFLICT(path) DO UPDATE SET
        label = excluded.label,
        kind = excluded.kind,
        filesystem = excluded.filesystem,
        total_bytes = excluded.total_bytes,
        free_bytes = excluded.free_bytes,
        is_network = excluded.is_network,
        last_seen_at = excluded.last_seen_at
    `)
    this.statements.listVolumes = this.handle.prepare('SELECT * FROM volumes ORDER BY favorite DESC, path ASC')
    this.statements.setVolumeFavorite = this.handle.prepare('UPDATE volumes SET favorite = @favorite WHERE path = @path')

    this.statements.getFolder = this.handle.prepare('SELECT * FROM folders WHERE path = @path')
    this.statements.insertFolder = this.handle.prepare(`
      INSERT INTO folders (path, parent_id, volume_path, name, depth, indexed_at)
      VALUES (@path, @parentId, @volumePath, @name, @depth, @indexedAt)
      ON CONFLICT(path) DO NOTHING
    `)
    this.statements.updateFolder = this.handle.prepare(`
      UPDATE folders SET
        file_count = @fileCount, dir_count = @dirCount, total_bytes = @totalBytes,
        scan_state = @scanState, scanned_at = @scannedAt
      WHERE path = @path
    `)
    this.statements.touchFolder = this.handle.prepare('UPDATE folders SET indexed_at = @indexedAt WHERE path = @path')
    this.statements.setFolderScanState = this.handle.prepare(
      'UPDATE folders SET scan_state = @scanState WHERE path = @path'
    )
    this.statements.setFolderFavorite = this.handle.prepare('UPDATE folders SET favorite = @favorite WHERE path = @path')
    this.statements.childFolders = this.handle.prepare('SELECT * FROM folders WHERE parent_id = @parentId ORDER BY name COLLATE NOCASE ASC')
    this.statements.descendantFolders = this.handle.prepare(
      "SELECT * FROM folders WHERE path = @prefix OR path LIKE @like ORDER BY path ASC"
    )
    this.statements.favoriteFolders = this.handle.prepare('SELECT * FROM folders WHERE favorite = 1 ORDER BY path ASC')

    // The path list is passed through json_each rather than a variable-length
    // `?` list: a folder can hold far more files than SQLite's default 999
    // bound-parameter limit, and an empty array still deletes the whole folder.
    this.statements.deleteFilesNotIn = this.handle.prepare(
      'DELETE FROM files WHERE folder_id = @folderId AND path NOT IN (SELECT value FROM json_each(@paths))'
    )
    this.statements.upsertFile = this.handle.prepare(`
      INSERT INTO files (
        folder_id, path, name, ext, kind, size_bytes, mtime_ms, birthtime_ms, inode,
        width, height, orientation, capture_at, capture_source, camera, lens, iso, aperture,
        shutter, focal_length, gps_lat, gps_lon, icc_name, color_space, bits_per_sample,
        metadata_state, thumb_state, indexed_at
      ) VALUES (
        @folderId, @path, @name, @ext, @kind, @sizeBytes, @mtimeMs, @birthtimeMs, @inode,
        @width, @height, @orientation, @captureAt, @captureSource, @camera, @lens, @iso, @aperture,
        @shutter, @focalLength, @gpsLat, @gpsLon, @iccName, @colorSpace, @bitsPerSample,
        @metadataState, @thumbState, @indexedAt
      )
      ON CONFLICT(path) DO UPDATE SET
        folder_id = excluded.folder_id,
        name = excluded.name,
        kind = excluded.kind,
        size_bytes = excluded.size_bytes,
        mtime_ms = excluded.mtime_ms,
        birthtime_ms = excluded.birthtime_ms,
        inode = excluded.inode,
        indexed_at = excluded.indexed_at
    `)
    this.statements.carryFileState = this.handle.prepare(`
      UPDATE files SET
        metadata_state = 'pending',
        width = NULL, height = NULL, orientation = NULL,
        capture_at = NULL, capture_source = 'unknown',
        camera = NULL, lens = NULL, iso = NULL, aperture = NULL, shutter = NULL,
        focal_length = NULL, gps_lat = NULL, gps_lon = NULL,
        icc_name = NULL, color_space = NULL, bits_per_sample = NULL,
        thumb_state = 'pending'
      WHERE path = @path AND (size_bytes != @sizeBytes OR mtime_ms != @mtimeMs)
    `)
    this.statements.filesInFolders = this.handle.prepare('SELECT * FROM files WHERE folder_id IN (SELECT id FROM folders WHERE path IN (SELECT value FROM json_each(@paths)))')
    this.statements.filesInFolder = this.handle.prepare(
      'SELECT * FROM files WHERE folder_id = @folderId ORDER BY name COLLATE NOCASE ASC'
    )
    this.statements.allFolderPaths = this.handle.prepare('SELECT path FROM folders')
    this.statements.filesByPaths = this.handle.prepare('SELECT * FROM files WHERE path IN (SELECT value FROM json_each(@paths))')
    this.statements.pendingMetadata = this.handle.prepare(
      "SELECT * FROM files WHERE metadata_state = 'pending' AND kind != 'other' ORDER BY capture_at IS NULL, path ASC LIMIT @limit"
    )
    this.statements.pendingThumbnails = this.handle.prepare(
      "SELECT * FROM files WHERE thumb_state = 'pending' AND kind IN ('image', 'raw') ORDER BY id ASC LIMIT @limit"
    )
    this.statements.updateMetadata = this.handle.prepare(`
      UPDATE files SET
        width = @width, height = @height, orientation = @orientation,
        capture_at = @captureAt, capture_source = @captureSource, camera = @camera, lens = @lens,
        iso = @iso, aperture = @aperture, shutter = @shutter, focal_length = @focalLength,
        gps_lat = @gpsLat, gps_lon = @gpsLon, icc_name = @iccName, color_space = @colorSpace,
        bits_per_sample = @bitsPerSample, metadata_state = @metadataState
      WHERE path = @path
    `)
    this.statements.setThumbState = this.handle.prepare('UPDATE files SET thumb_state = @state WHERE path = @path')
    this.statements.setFilesThumbState = this.handle.prepare(
      "UPDATE files SET thumb_state = 'ready' WHERE path IN (SELECT value FROM json_each(@paths)) AND thumb_state != 'ready'"
    )

    this.statements.countFolders = this.handle.prepare('SELECT COUNT(*) AS count FROM folders')
    this.statements.countFiles = this.handle.prepare('SELECT COUNT(*) AS count FROM files')
    this.statements.sumBytes = this.handle.prepare('SELECT COALESCE(SUM(size_bytes), 0) AS bytes FROM files')
    this.statements.countStale = this.handle.prepare("SELECT COUNT(*) AS count FROM files WHERE metadata_state = 'pending'")

    this.statements.getSetting = this.handle.prepare('SELECT value FROM settings WHERE key = @key')
    this.statements.putSetting = this.handle.prepare(`
      INSERT INTO settings (key, value, updated_at) VALUES (@key, @value, @updatedAt)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `)
    this.statements.allSettings = this.handle.prepare('SELECT key, value FROM settings')
  }

  upsertVolume(volume: {
    path: string
    label: string
    kind: VolumeKind
    filesystem: string | null
    totalBytes: number | null
    freeBytes: number | null
    isNetwork: boolean
  }): void {
    this.statements.upsertVolume.run({
      path: volume.path,
      label: volume.label,
      kind: volume.kind,
      filesystem: volume.filesystem,
      totalBytes: volume.totalBytes,
      freeBytes: volume.freeBytes,
      isNetwork: volume.isNetwork ? 1 : 0,
      favorite: 0,
      lastSeenAt: Date.now()
    })
  }

  listVolumes(): VolumeInfo[] {
    const rows = this.statements.listVolumes.all() as Row[]
    return rows.map((row) => ({
      path: String(row.path),
      label: String(row.label),
      kind: String(row.kind) as VolumeKind,
      filesystem: toText(row.filesystem),
      totalBytes: toNullableNumber(row.total_bytes),
      freeBytes: toNullableNumber(row.free_bytes),
      isNetwork: toBoolean(row.is_network),
      isFavorite: toBoolean(row.favorite)
    }))
  }

  setVolumeFavorite(path: string, favorite: boolean): void {
    this.statements.setVolumeFavorite.run({ path, favorite: favorite ? 1 : 0 })
  }

  getFolderId(path: string): number | null {
    const row = this.statements.getFolder.get({ path }) as Row | undefined
    return row ? toNumber(row.id, -1) : null
  }

  /** Inserts the folder and any missing ancestors so the tree is walkable from any depth. */
  ensureFolder(path: string, volumePath: string | null = null): number {
    const existing = this.getFolderId(path)
    if (existing !== null) return existing

    const parentPath = path === '/' ? null : dirNameOf(path)
    let parentId: number | null = null
    if (parentPath !== null && parentPath !== path) {
      parentId = this.ensureFolder(parentPath, volumePath)
    }

    this.statements.insertFolder.run({
      path,
      parentId,
      volumePath,
      name: baseNameOf(path) || path,
      depth: path.split('/').filter(Boolean).length,
      indexedAt: Date.now()
    })

    const id = this.getFolderId(path)
    if (id === null) throw new Error(`failed to insert folder ${path}`)
    return id
  }

  updateFolderStats(record: {
    path: string
    fileCount: number
    dirCount: number
    totalBytes: number
    scanState: ScanState
    scannedAt: number | null
  }): void {
    this.ensureFolder(record.path)
    this.statements.updateFolder.run(record)
  }

  setFolderScanState(path: string, scanState: ScanState): void {
    this.ensureFolder(path)
    this.statements.setFolderScanState.run({ path, scanState })
  }

  setFolderFavorite(path: string, favorite: boolean): void {
    this.ensureFolder(path, null)
    this.statements.setFolderFavorite.run({ path, favorite: favorite ? 1 : 0 })
  }

  private toFolderEntry(row: Row): FolderEntry {
    const path = String(row.path)
    return {
      path,
      name: String(row.name),
      parentPath: path === '/' ? null : dirNameOf(path),
      depth: toNumber(row.depth),
      hasChildren: toNumber(row.dir_count) > 0,
      fileCount: toNumber(row.file_count),
      dirCount: toNumber(row.dir_count),
      totalBytes: toNumber(row.total_bytes),
      favorite: toBoolean(row.favorite),
      scanState: String(row.scan_state) as ScanState,
      scannedAt: toNullableNumber(row.scanned_at)
    }
  }

  listChildFolders(parentPath: string): FolderEntry[] {
    const parentId = this.getFolderId(parentPath)
    if (parentId === null) return []
    const rows = this.statements.childFolders.all({ parentId }) as Row[]
    return rows.map((row) => this.toFolderEntry(row))
  }

  listDescendantFolders(rootPath: string): FolderEntry[] {
    const like = `${rootPath.replace(/([%_])/g, '\\$1')}/%`
    const rows = this.statements.descendantFolders.all({ prefix: rootPath, like }) as Row[]
    return rows.map((row) => this.toFolderEntry(row))
  }

  listFavoriteFolders(): FolderEntry[] {
    const rows = this.statements.favoriteFolders.all() as Row[]
    return rows.map((row) => this.toFolderEntry(row))
  }

  listFavoriteFolderPaths(): string[] {
    return this.listFavoriteFolders().map((folder) => folder.path)
  }

  getFolder(path: string): FolderEntry | null {
    const row = this.statements.getFolder.get({ path }) as Row | undefined
    return row ? this.toFolderEntry(row) : null
  }

  private toFileRecord(row: Row): FileRecord {
    return {
      path: String(row.path),
      name: String(row.name),
      ext: String(row.ext),
      kind: String(row.kind) as FileKind,
      sizeBytes: toNumber(row.size_bytes),
      mtimeMs: toNumber(row.mtime_ms),
      birthtimeMs: toNullableNumber(row.birthtime_ms),
      inode: toText(row.inode),
      width: toNullableNumber(row.width),
      height: toNullableNumber(row.height),
      orientation: toNullableNumber(row.orientation),
      captureAt: toNullableNumber(row.capture_at),
      captureSource: String(row.capture_source) as CaptureSource,
      camera: toText(row.camera),
      lens: toText(row.lens),
      iso: toNullableNumber(row.iso),
      aperture: toNullableNumber(row.aperture),
      shutter: toNullableNumber(row.shutter),
      focalLength: toNullableNumber(row.focal_length),
      gpsLat: toNullableNumber(row.gps_lat),
      gpsLon: toNullableNumber(row.gps_lon),
      iccName: toText(row.icc_name),
      colorSpace: toText(row.color_space),
      bitsPerSample: toNullableNumber(row.bits_per_sample),
      metadataState: String(row.metadata_state) as MetadataState,
      thumbState: String(row.thumb_state)
    }
  }

  private toFileEntry(record: FileRecord): FileEntry {
    return {
      path: record.path,
      name: record.name,
      ext: record.ext,
      kind: record.kind,
      sizeBytes: record.sizeBytes,
      mtimeMs: record.mtimeMs,
      birthtimeMs: record.birthtimeMs,
      width: record.width,
      height: record.height,
      orientation: record.orientation,
      captureAt: record.captureAt,
      captureSource: record.captureSource,
      camera: record.camera,
      lens: record.lens,
      iso: record.iso,
      aperture: record.aperture,
      shutter: record.shutter,
      focalLength: record.focalLength,
      gps:
        record.gpsLat !== null && record.gpsLon !== null
          ? { latitude: record.gpsLat, longitude: record.gpsLon }
          : null,
      iccName: record.iccName,
      colorSpace: record.colorSpace,
      hasThumbnail: record.thumbState === 'ready',
      metadataState: record.metadataState
    }
  }

  /**
   * Reconciles a folder's file list against the index. Rows whose size and mtime are
   * unchanged keep their EXIF and thumbnail state, so an incremental rescan of a
   * 100k-file tree does almost no work beyond the readdir.
   */
  replaceFilesInFolder(folderPath: string, records: FileRecord[]): void {
    const folderId = this.ensureFolder(folderPath)
    const now = Date.now()
    const run = this.handle.transaction(() => {
      for (const record of records) {
        this.statements.carryFileState.run({
          path: record.path,
          sizeBytes: record.sizeBytes,
          mtimeMs: record.mtimeMs
        })
        this.statements.upsertFile.run({ ...record, folderId, indexedAt: now })
      }
      this.statements.deleteFilesNotIn.run({
        folderId,
        paths: JSON.stringify(records.map((record) => record.path))
      })
    })
    run()
  }

  getFilesInFolder(folderPath: string): FileEntry[] {
    const folderId = this.getFolderId(folderPath)
    if (folderId === null) return []
    const rows = this.statements.filesInFolder.all({ folderId }) as Row[]
    return rows.map((row) => this.toFileEntry(this.toFileRecord(row)))
  }

  getFilesInFolders(paths: string[]): FileEntry[] {
    if (paths.length === 0) return []
    const rows = this.statements.filesInFolders.all({ paths: JSON.stringify(paths) }) as Row[]
    return rows.map((row) => this.toFileEntry(this.toFileRecord(row)))
  }

  getFilesByPaths(paths: string[]): Map<string, FileEntry> {
    const result = new Map<string, FileEntry>()
    if (paths.length === 0) return result
    const rows = this.statements.filesByPaths.all({ paths: JSON.stringify(paths) }) as Row[]
    for (const row of rows) {
      const entry = this.toFileEntry(this.toFileRecord(row))
      result.set(entry.path, entry)
    }
    return result
  }

  getPendingMetadata(limit: number): FileRecord[] {
    return (this.statements.pendingMetadata.all({ limit }) as Row[]).map((row) =>
      this.toFileRecord(row)
    )
  }

  getPendingThumbnails(limit: number): FileRecord[] {
    return (this.statements.pendingThumbnails.all({ limit }) as Row[]).map((row) =>
      this.toFileRecord(row)
    )
  }

  updateFileMetadata(path: string, patch: Partial<FileRecord> & { metadataState: MetadataState }): void {
    const current = this.statements.filesByPaths.all({ paths: JSON.stringify([path]) })[0] as Row | undefined
    const base = current ? this.toFileRecord(current) : null
    this.statements.updateMetadata.run({
      path,
      width: patch.width ?? base?.width ?? null,
      height: patch.height ?? base?.height ?? null,
      orientation: patch.orientation ?? base?.orientation ?? null,
      captureAt: patch.captureAt ?? base?.captureAt ?? null,
      captureSource: patch.captureSource ?? base?.captureSource ?? 'unknown',
      camera: patch.camera ?? base?.camera ?? null,
      lens: patch.lens ?? base?.lens ?? null,
      iso: patch.iso ?? base?.iso ?? null,
      aperture: patch.aperture ?? base?.aperture ?? null,
      shutter: patch.shutter ?? base?.shutter ?? null,
      focalLength: patch.focalLength ?? base?.focalLength ?? null,
      gpsLat: patch.gpsLat ?? base?.gpsLat ?? null,
      gpsLon: patch.gpsLon ?? base?.gpsLon ?? null,
      iccName: patch.iccName ?? base?.iccName ?? null,
      colorSpace: patch.colorSpace ?? base?.colorSpace ?? null,
      bitsPerSample: patch.bitsPerSample ?? base?.bitsPerSample ?? null,
      metadataState: patch.metadataState
    })
  }

  setThumbState(path: string, state: 'ready' | 'pending' | 'error'): void {
    this.statements.setThumbState.run({ path, state })
  }

  setThumbStatesReady(paths: string[]): void {
    if (paths.length === 0) return
    this.statements.setFilesThumbState.run({ paths: JSON.stringify(paths) })
  }

  stats(): { folderCount: number; fileCount: number; totalBytes: number; staleCount: number } {
    const folders = this.statements.countFolders.get() as Row
    const files = this.statements.countFiles.get() as Row
    const bytes = this.statements.sumBytes.get() as Row
    const stale = this.statements.countStale.get() as Row
    return {
      folderCount: toNumber(folders.count),
      fileCount: toNumber(files.count),
      totalBytes: toNumber(bytes.bytes),
      staleCount: toNumber(stale.count)
    }
  }

  listAllFolderPaths(): string[] {
    return (this.statements.allFolderPaths.all() as Row[]).map((row) => String(row.path))
  }

  getSettings(): Settings {
    const stored = new Map<string, string>()
    for (const row of this.statements.allSettings.all() as Row[]) {
      stored.set(String(row.key), String(row.value))
    }
    const parse = <T>(key: string, fallback: T): T => {
      const raw = stored.get(key)
      if (raw == null) return fallback
      try {
        return JSON.parse(raw) as T
      } catch {
        return fallback
      }
    }
    return {
      ...DEFAULT_SETTINGS,
      thumbnailSize: parse('thumbnailSize', DEFAULT_SETTINGS.thumbnailSize),
      colorPreview: parse('colorPreview', DEFAULT_SETTINGS.colorPreview),
      defaultExpandedPaths: parse('defaultExpandedPaths', DEFAULT_SETTINGS.defaultExpandedPaths),
      lastFolder: parse('lastFolder', DEFAULT_SETTINGS.lastFolder),
      viewMode: parse('viewMode', DEFAULT_SETTINGS.viewMode),
      sortBy: parse('sortBy', DEFAULT_SETTINGS.sortBy),
      sortDirection: parse('sortDirection', DEFAULT_SETTINGS.sortDirection),
      showSidecars: parse('showSidecars', DEFAULT_SETTINGS.showSidecars)
    }
  }

  patchSettings(patch: Partial<Settings>): Settings {
    const now = Date.now()
    const run = this.handle.transaction(() => {
      for (const [key, value] of Object.entries(patch)) {
        if (!(key in DEFAULT_SETTINGS)) continue
        this.statements.putSetting.run({ key, value: JSON.stringify(value), updatedAt: now })
      }
    })
    run()
    return this.getSettings()
  }
}

export function toFileRecordFromStat(input: {
  path: string
  sizeBytes: number
  mtimeMs: number
  birthtimeMs: number | null
  inode: string | null
  kind: FileKind
}): FileRecord {
  const name = baseNameOf(input.path)
  return {
    path: input.path,
    name,
    ext: extensionOf(name),
    kind: input.kind,
    sizeBytes: input.sizeBytes,
    mtimeMs: input.mtimeMs,
    birthtimeMs: input.birthtimeMs,
    inode: input.inode,
    width: null,
    height: null,
    orientation: null,
    captureAt: null,
    captureSource: 'unknown',
    camera: null,
    lens: null,
    iso: null,
    aperture: null,
    shutter: null,
    focalLength: null,
    gpsLat: null,
    gpsLon: null,
    iccName: null,
    colorSpace: null,
    bitsPerSample: null,
    metadataState: 'pending',
    thumbState: 'pending'
  }
}
