import { app, dialog, ipcMain, shell, type BrowserWindow } from 'electron'
import type {
  AppInfo,
  FileEntry,
  FileMetadata,
  FolderEntry,
  FolderListing,
  IpcArgs,
  IpcChannel,
  IpcResult,
  PreviewPayload,
  ScanProgress,
  Settings,
  ThumbnailBatch,
  VolumeInfo,
  WindowState
} from '../shared/contract'
import { currentPlatform, isWaylandSession, type AppServices } from './services'
import { assertPathList, assertSafePath, normalizePath } from './services/paths'
import { classifyExtension, isRenderableImage } from '../shared/formats'
import { statIdentity } from './services/metadata'

type GetWindow = () => BrowserWindow | null

export function registerIpc(services: AppServices, getWindow: GetWindow): void {
  const handle = <C extends IpcChannel>(
    channel: C,
    handler: (args: IpcArgs<C>) => IpcResult<C> | Promise<IpcResult<C>>
  ): void => {
    ipcMain.removeHandler(channel)
    ipcMain.handle(channel, async (_event, raw: unknown) => {
      try {
        return await handler((raw ?? undefined) as IpcArgs<C>)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        console.error(`[ipc] ${channel} failed: ${message}`)
        throw new Error(message)
      }
    })
  }

  const windowState = (): WindowState => {
    const window = getWindow()
    return {
      maximized: window?.isMaximized() ?? false,
      fullScreen: window?.isFullScreen() ?? false,
      platform: currentPlatform(),
      nativeWayland: isWaylandSession()
    }
  }

  handle('app:info', (): AppInfo => {
    return {
      platform: currentPlatform(),
      arch: process.arch,
      electronVersion: process.versions.electron,
      nodeVersion: process.versions.node,
      chromeVersion: process.versions.chrome,
      sessionType: process.env.XDG_SESSION_TYPE ?? 'unknown',
      nativeWayland: isWaylandSession(),
      dbPath: services.dbPath,
      userDataPath: services.userDataPath,
      appVersion: app.getVersion()
    }
  })

  handle('window:minimize', () => {
    getWindow()?.minimize()
  })

  handle('window:toggleMaximize', () => {
    const window = getWindow()
    if (!window) return false
    if (window.isMaximized()) window.unmaximize()
    else window.maximize()
    return window.isMaximized()
  })

  handle('window:close', () => {
    getWindow()?.close()
  })

  handle('window:state', windowState)

  handle('dialog:pickFolder', async ({ title }): Promise<string | null> => {
    const window = getWindow()
    const result = window
      ? await dialog.showOpenDialog(window, {
          title,
          properties: ['openDirectory', 'createDirectory', 'dontAddToRecent']
        })
      : await dialog.showOpenDialog({ title, properties: ['openDirectory'] })
    if (result.canceled || result.filePaths.length === 0) return null
    return normalizePath(result.filePaths[0])
  })

  handle('shell:openPath', async ({ path }) => shell.openPath(assertSafePath(path)))

  handle('shell:showInFolder', ({ path }) => {
    shell.showItemInFolder(assertSafePath(path))
  })

  handle('volumes:list', (): Promise<VolumeInfo[]> => services.listVolumes())

  handle('volumes:setFavorite', ({ path, favorite }): VolumeInfo[] => {
    services.db.setVolumeFavorite(normalizePath(path), favorite)
    return services.db.listVolumes()
  })

  handle('folders:favorites', (): FolderEntry[] => services.db.listFavoriteFolders())

  handle('folders:children', ({ path }): FolderEntry[] =>
    services.db.listChildFolders(normalizePath(path))
  )

  handle('folders:list', async ({ path }): Promise<FolderListing> => {
    const target = normalizePath(path)
    const fromCache = !services.needsRevalidation(target)

    if (!fromCache) {
      await services.scan.scanOne(target)
      services.markRevalidated(target)
    }

    const started = Date.now()
    const folders = services.db.listChildFolders(target)
    const files = services.db.getFilesInFolder(target)
    return {
      path: target,
      parentPath: target === '/' ? null : parentOf(target),
      folders,
      files,
      listingMs: Date.now() - started,
      fromCache
    }
  })

  handle('folders:setFavorite', ({ path, favorite }): FolderEntry | null => {
    const target = normalizePath(path)
    services.db.setFolderFavorite(target, favorite)
    services.syncWatchRoots()
    return services.db.getFolder(target)
  })

  handle('files:metadata', async ({ paths }): Promise<Record<string, FileMetadata>> => {
    const safe = assertPathList(paths)

    // Rows the index already settled are returned instantly; only the remainder
    // needs a file read, so scrolling a browsed folder costs nothing.
    const cached = services.db.getFilesByPaths(safe)
    const result: Record<string, FileMetadata> = {}
    const missing: string[] = []

    for (const path of safe) {
      const entry = cached.get(path)
      if (entry && entry.metadataState === 'ready') {
        result[path] = toMetadata(entry)
      } else {
        missing.push(path)
      }
    }

    if (missing.length > 0) {
      const computed = await services.metadata.readMany(missing)
      for (const path of missing) {
        const meta = computed.get(path)
        if (!meta) continue
        services.db.updateFileMetadata(path, {
          metadataState: meta.state,
          width: meta.width,
          height: meta.height,
          orientation: meta.orientation,
          bitsPerSample: meta.bitsPerSample,
          captureAt: meta.captureAt,
          captureSource: meta.captureSource,
          camera: meta.camera,
          lens: meta.lens,
          iso: meta.iso,
          aperture: meta.aperture,
          shutter: meta.shutter,
          focalLength: meta.focalLength,
          gpsLat: meta.gps?.latitude ?? null,
          gpsLon: meta.gps?.longitude ?? null,
          iccName: meta.icc?.name ?? null,
          colorSpace: meta.icc?.colorSpace ?? null
        })
        result[path] = meta
      }
    }

    return result
  })

  handle('preview:get', async ({ path }): Promise<PreviewPayload> =>
    services.preview.resolve(assertSafePath(path))
  )

  handle('thumbs:ensure', async ({ paths }): Promise<ThumbnailBatch> => {
    const safe = assertPathList(paths)
    const batch: ThumbnailBatch = { requested: safe.length, queued: 0, cacheHits: 0 }
    const completed: string[] = []

    for (const target of safe) {
      const kind = classifyExtension(extensionOf(target))
      if (!isRenderableImage(kind)) continue
      const identity = await statIdentity(target).catch(() => null)
      if (identity === null) continue
      services.render.remember(identity)
      const result = await services.preview.ensureThumbnail(identity, kind)
      if (result === null) continue
      if (result.cacheHit) batch.cacheHits += 1
      else batch.queued += 1
      completed.push(target)
    }

    if (completed.length > 0) {
      services.db.setThumbStatesReady(completed)
      getWindow()?.webContents.send('thumbs:ready', { paths: completed })
    }
    return batch
  })

  handle('index:scan', ({ path, recursive, includeSidecars }) => {
    const target = normalizePath(path)
    services.db.setFolderFavorite(target, true)
    services.syncWatchRoots()
    return services.scan.begin({ path: target, recursive, includeSidecars })
  })

  handle('index:cancel', ({ scanId }) => {
    services.scan.cancel(scanId)
  })

  handle('index:status', () => {
    const stats = services.db.stats()
    const progress: ScanProgress | null = services.progress()
    return {
      scanning: services.scan.isScanning(),
      progress,
      ...stats,
      dbSizeBytes: services.db.sizeBytes,
      watchedRoots: services.watch.currentRoots()
    }
  })

  handle('watch:setRoots', ({ paths }) => {
    services.watch.setRoots(assertPathList(paths))
  })

  handle('settings:get', (): Settings => services.db.getSettings())

  handle('settings:patch', ({ patch }): Settings => services.db.patchSettings(patch))
}

function parentOf(path: string): string {
  const index = path.lastIndexOf('/')
  return index <= 0 ? '/' : path.slice(0, index)
}

function extensionOf(path: string): string {
  const index = path.lastIndexOf('.')
  return index <= 0 ? '' : path.slice(index + 1).toLowerCase()
}

function toMetadata(entry: FileEntry): FileMetadata {
  return {
    path: entry.path,
    state: entry.metadataState,
    width: entry.width,
    height: entry.height,
    orientation: entry.orientation,
    bitsPerSample: null,
    camera: entry.camera,
    cameraMake: null,
    cameraModel: null,
    lens: entry.lens,
    serial: null,
    iso: entry.iso,
    aperture: entry.aperture,
    shutter: entry.shutter,
    focalLength: entry.focalLength,
    focalLength35: null,
    captureAt: entry.captureAt,
    captureSource: entry.captureSource,
    gps: entry.gps,
    icc: entry.iccName
      ? { name: entry.iccName, colorSpace: entry.colorSpace ?? 'RGB', isSrgb: false, sizeBytes: 0 }
      : null,
    raw: null,
    extra: {}
  }
}
