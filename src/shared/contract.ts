export type Platform = 'darwin' | 'win32' | 'linux' | 'other'

export type VolumeKind = 'root' | 'local' | 'removable' | 'network'

export type FileKind = 'raw' | 'image' | 'video' | 'sidecar' | 'other'

export type CaptureSource = 'exif' | 'filename' | 'modified' | 'created' | 'unknown'

export type ScanState = 'pending' | 'scanning' | 'fresh' | 'stale' | 'error'

export type MetadataState = 'pending' | 'ready' | 'unsupported' | 'error'

export interface AppInfo {
  platform: Platform
  arch: string
  electronVersion: string
  nodeVersion: string
  chromeVersion: string
  sessionType: string
  nativeWayland: boolean
  dbPath: string
  userDataPath: string
  appVersion: string
}

export interface VolumeInfo {
  path: string
  label: string
  kind: VolumeKind
  filesystem: string | null
  totalBytes: number | null
  freeBytes: number | null
  isNetwork: boolean
  isFavorite: boolean
}

export interface FolderEntry {
  path: string
  name: string
  parentPath: string | null
  depth: number
  hasChildren: boolean
  fileCount: number
  dirCount: number
  totalBytes: number
  favorite: boolean
  scanState: ScanState
  scannedAt: number | null
}

export interface FileEntry {
  path: string
  name: string
  ext: string
  kind: FileKind
  sizeBytes: number
  mtimeMs: number
  birthtimeMs: number | null
  width: number | null
  height: number | null
  orientation: number | null
  captureAt: number | null
  captureSource: CaptureSource
  camera: string | null
  lens: string | null
  iso: number | null
  aperture: number | null
  /** Exposure time in seconds. */
  shutter: number | null
  focalLength: number | null
  gps: { latitude: number; longitude: number } | null
  iccName: string | null
  colorSpace: string | null
  hasThumbnail: boolean
  metadataState: MetadataState
}

export interface FolderListing {
  path: string
  parentPath: string | null
  folders: FolderEntry[]
  files: FileEntry[]
  listingMs: number
  fromCache: boolean
}

export interface FileMetadata {
  path: string
  state: MetadataState
  width: number | null
  height: number | null
  orientation: number | null
  bitsPerSample: number | null
  camera: string | null
  cameraMake: string | null
  cameraModel: string | null
  lens: string | null
  serial: string | null
  iso: number | null
  aperture: number | null
  /** Exposure time in seconds. */
  shutter: number | null
  focalLength: number | null
  focalLength35: number | null
  captureAt: number | null
  captureSource: CaptureSource
  gps: { latitude: number; longitude: number } | null
  icc: IccInfo | null
  raw: RawInfo | null
  extra: Record<string, string>
}

export interface RawInfo {
  format: string | null
  width: number | null
  height: number | null
  bitsPerSample: number | null
  isRaw: boolean
}

export interface IccInfo {
  name: string | null
  colorSpace: string
  isSrgb: boolean
  sizeBytes: number
}

export interface PreviewPayload {
  path: string
  url: string | null
  kind: FileKind
  width: number | null
  height: number | null
  orientation: number | null
  icc: IccInfo | null
  hasPreview: boolean
  reason: string | null
  colorManaged: boolean
}

export interface ScanRequest {
  path: string
  recursive: boolean
  includeSidecars: boolean
}

export interface ScanProgress {
  scanId: string
  root: string
  foldersDone: number
  foldersTotal: number
  filesIndexed: number
  bytesIndexed: number
  currentPath: string | null
  state: 'running' | 'done' | 'cancelled' | 'error'
  error: string | null
  startedAt: number
  finishedAt: number | null
}

export interface IndexStatus {
  scanning: boolean
  progress: ScanProgress | null
  folderCount: number
  fileCount: number
  totalBytes: number
  staleCount: number
  dbSizeBytes: number
  watchedRoots: string[]
}

export interface WatchEvent {
  path: string
  type: 'added' | 'changed' | 'removed'
  kind: FileKind | 'folder'
}

export interface ThumbnailBatch {
  requested: number
  queued: number
  cacheHits: number
}

export interface Settings {
  thumbnailSize: number
  colorPreview: 'srgb' | 'passthrough'
  defaultExpandedPaths: string[]
  lastFolder: string | null
  viewMode: 'grid' | 'loupe'
  sortBy: 'name' | 'date' | 'size' | 'kind'
  sortDirection: 'asc' | 'desc'
  showSidecars: boolean
}

export interface WindowState {
  maximized: boolean
  fullScreen: boolean
  platform: Platform
  nativeWayland: boolean
}

export interface IpcContract {
  'app:info': { args: void; result: AppInfo }
  'window:minimize': { args: void; result: void }
  'window:toggleMaximize': { args: void; result: boolean }
  'window:close': { args: void; result: void }
  'window:state': { args: void; result: WindowState }
  'dialog:pickFolder': { args: { title: string }; result: string | null }
  'shell:openPath': { args: { path: string }; result: string }
  'shell:showInFolder': { args: { path: string }; result: void }
  'volumes:list': { args: void; result: VolumeInfo[] }
  'volumes:setFavorite': { args: { path: string; favorite: boolean }; result: VolumeInfo[] }
  'folders:list': { args: { path: string }; result: FolderListing }
  'folders:children': { args: { path: string }; result: FolderEntry[] }
  'folders:favorites': { args: void; result: FolderEntry[] }
  'folders:setFavorite': { args: { path: string; favorite: boolean }; result: FolderEntry | null }
  'files:metadata': { args: { paths: string[] }; result: Record<string, FileMetadata> }
  'preview:get': { args: { path: string }; result: PreviewPayload }
  'thumbs:ensure': { args: { paths: string[] }; result: ThumbnailBatch }
  'index:scan': { args: ScanRequest; result: { scanId: string } }
  'index:cancel': { args: { scanId: string }; result: void }
  'index:status': { args: void; result: IndexStatus }
  'watch:setRoots': { args: { paths: string[] }; result: void }
  'settings:get': { args: void; result: Settings }
  'settings:patch': { args: { patch: Partial<Settings> }; result: Settings }
}

export type IpcChannel = keyof IpcContract

export type IpcArgs<C extends IpcChannel> = IpcContract[C]['args']

export type IpcResult<C extends IpcChannel> = IpcContract[C]['result']

export interface IpcEventMap {
  'index:progress': ScanProgress
  'watch:changed': WatchEvent
  'thumbs:ready': { paths: string[] }
  'files:updated': { paths: string[] }
  'window:stateChanged': WindowState
}

export type IpcEventName = keyof IpcEventMap

export const CHANNELS: readonly IpcChannel[] = [
  'app:info',
  'window:minimize',
  'window:toggleMaximize',
  'window:close',
  'window:state',
  'dialog:pickFolder',
  'shell:openPath',
  'shell:showInFolder',
  'volumes:list',
  'volumes:setFavorite',
  'folders:list',
  'folders:children',
  'folders:favorites',
  'folders:setFavorite',
  'files:metadata',
  'preview:get',
  'thumbs:ensure',
  'index:scan',
  'index:cancel',
  'index:status',
  'watch:setRoots',
  'settings:get',
  'settings:patch'
]

export const EVENT_CHANNELS: readonly IpcEventName[] = [
  'index:progress',
  'watch:changed',
  'thumbs:ready',
  'files:updated',
  'window:stateChanged'
]

export const THUMB_SCHEME = 'archivum'

export const THUMB_SIZES = { grid: 320, preview: 1024 } as const

export const DEFAULT_SETTINGS: Settings = {
  thumbnailSize: 320,
  colorPreview: 'srgb',
  defaultExpandedPaths: [],
  lastFolder: null,
  viewMode: 'grid',
  sortBy: 'name',
  sortDirection: 'asc',
  showSidecars: false
}
