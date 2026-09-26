import { join } from 'node:path'
import { app, type BrowserWindow } from 'electron'
import type { ScanProgress, VolumeInfo, WatchEvent } from '../shared/contract'
import { ArchivumDatabase } from './db'
import { AssetCache } from './services/cache'
import { MetadataService } from './services/metadata'
import { MetadataWorker } from './services/metadata-worker'
import { PreviewService } from './services/preview'
import { RawDecoder } from './services/raw'
import { RenderService } from './services/render'
import { ScanService } from './services/scanner'
import { VolumeService } from './services/volumes'
import { WatchService } from './services/watcher'

export type EventEmitter = (channel: string, payload: unknown) => void

const WINDOW_STATE_EVENTS = [
  'maximize',
  'unmaximize',
  'enter-full-screen',
  'leave-full-screen',
  'restore'
] as const

/**
 * Owns every long-lived service so the IPC layer, the asset protocol and the
 * background workers share one database handle and one bounded render queue.
 */
export class AppServices {
  readonly db: ArchivumDatabase
  readonly cache: AssetCache
  readonly raw: RawDecoder
  readonly render: RenderService
  readonly metadata: MetadataService
  readonly preview: PreviewService
  readonly volumes: VolumeService
  readonly scan: ScanService
  readonly watch: WatchService
  readonly worker: MetadataWorker
  readonly dbPath: string
  readonly userDataPath: string

  /** Paths already re-read from disk this session, so offline shares self-heal once. */
  private readonly revalidated = new Set<string>()
  private volumesCache: VolumeInfo[] = []
  private lastProgress: ScanProgress | null = null
  private disposed = false

  private constructor(
    db: ArchivumDatabase,
    userDataPath: string,
    private readonly emit: EventEmitter
  ) {
    this.userDataPath = userDataPath
    this.dbPath = join(userDataPath, 'archivum.db')
    this.db = db
    this.cache = new AssetCache(userDataPath)
    this.raw = new RawDecoder(() => app.getAppPath())
    this.render = new RenderService(this.cache, this.raw)
    this.metadata = new MetadataService()
    this.preview = new PreviewService(this.cache, this.render, this.metadata, this.raw)
    this.volumes = new VolumeService(db)
    this.scan = new ScanService(db, (progress) => {
      this.lastProgress = progress.state === 'running' ? progress : this.lastProgress
      this.emit('index:progress', progress)
      // A finished scan leaves thousands of rows without EXIF; fill them in now.
      if (progress.state === 'done') void this.worker.drain()
    })
    this.worker = new MetadataWorker(db, this.metadata, (paths) => {
      this.emit('files:updated', { paths })
    })
    this.watch = new WatchService((event: WatchEvent) => {
      this.revalidated.delete(parentOf(event.path))
      this.emit('watch:changed', event)
    })
  }

  static async create(userDataPath: string, emit: EventEmitter): Promise<AppServices> {
    const services = new AppServices(
      new ArchivumDatabase(join(userDataPath, 'archivum.db')),
      userDataPath,
      emit
    )
    await services.cache.ensure()
    services.volumesCache = await services.volumes.list()
    services.watch.setRoots(services.db.listFavoriteFolderPaths())
    return services
  }

  attachWindow(window: BrowserWindow): void {
    for (const event of WINDOW_STATE_EVENTS) {
      window.on(event as 'maximize', () => {
        window.webContents.send('window:stateChanged', {
          maximized: window.isMaximized(),
          fullScreen: window.isFullScreen(),
          platform: currentPlatform(),
          nativeWayland: isWaylandSession()
        })
      })
    }
  }

  progress(): ScanProgress | null {
    return this.lastProgress
  }

  listVolumes(): Promise<VolumeInfo[]> {
    return this.volumes.list()
  }

  volumeCache(): VolumeInfo[] {
    return this.volumesCache
  }

  /** Network shares can change behind our back, so they are re-read once per session. */
  needsRevalidation(path: string): boolean {
    if (this.revalidated.has(path)) return false
    const folder = this.db.getFolder(path)
    if (folder === null || folder.scannedAt === null) return true
    return this.volumes.findContaining(this.volumesCache, path)?.isNetwork ?? false
  }

  markRevalidated(path: string): void {
    this.revalidated.add(path)
  }

  syncWatchRoots(): void {
    this.watch.setRoots(this.db.listFavoriteFolderPaths())
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    this.worker.stop()
    await this.watch.close()
    this.db.close()
  }
}

export function currentPlatform(): AppInfoPlatform {
  return process.platform === 'darwin'
    ? 'darwin'
    : process.platform === 'win32'
      ? 'win32'
      : 'linux'
}

export type AppInfoPlatform = 'darwin' | 'win32' | 'linux'

export function isWaylandSession(): boolean {
  return process.platform === 'linux' && (process.env.XDG_SESSION_TYPE ?? '').toLowerCase() === 'wayland'
}

function parentOf(path: string): string {
  const index = path.lastIndexOf('/')
  return index <= 0 ? '/' : path.slice(0, index)
}
