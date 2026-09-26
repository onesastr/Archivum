import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  FileEntry,
  FileMetadata,
  FolderEntry,
  FolderListing,
  ScanProgress,
  Settings,
  VolumeInfo
} from '@shared/contract'
import { DEFAULT_SETTINGS } from '@shared/contract'

export interface Toast {
  id: number
  title: string
  detail: string | null
  tone: 'info' | 'error'
}

export interface TreeNode {
  path: string
  label: string
  kind: 'volume' | 'folder' | 'group'
  children: TreeNode[]
  loaded: boolean
  loading: boolean
  hasChildren: boolean
  fileCount: number
  favorite: boolean
  network: boolean
}

const api = window.archivum

export interface LibraryState {
  settings: Settings
  volumes: VolumeInfo[]
  favorites: FolderEntry[]
  tree: TreeNode[]
  expanded: Set<string>
  listing: FolderListing | null
  loading: boolean
  selectedFolder: string | null
  selectedFile: FileEntry | null
  metadata: Record<string, FileMetadata>
  previewUrl: string | null
  previewReason: string | null
  scan: ScanProgress | null
  toasts: Toast[]
  selectFolder: (path: string) => Promise<void>
  toggleExpanded: (path: string) => Promise<void>
  selectFile: (file: FileEntry | null) => void
  addFolder: () => Promise<void>
  rescan: () => Promise<void>
  sortBy: Settings['sortBy']
  setSortBy: (value: Settings['sortBy']) => void
  setThumbSize: (value: number) => void
  showSidecars: boolean
  setShowSidecars: (value: boolean) => void
  patchSettings: (patch: Partial<Settings>) => Promise<void>
  files: FileEntry[]
  refreshMetadata: (paths: string[]) => void
  dismissToast: (id: number) => void
  notify: (toast: Omit<Toast, 'id'>) => void
}

let toastId = 0

export function useLibrary(): LibraryState {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [volumes, setVolumes] = useState<VolumeInfo[]>([])
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [childrenOf, setChildrenOf] = useState<Map<string, FolderEntry[]>>(new Map())
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null)
  const [listing, setListing] = useState<FolderListing | null>(null)
  const [loading, setLoading] = useState(false)
  const [selectedFile, setSelectedFile] = useState<FileEntry | null>(null)
  const [metadata, setMetadata] = useState<Record<string, FileMetadata>>({})
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [previewReason, setPreviewReason] = useState<string | null>(null)
  const [scan, setScan] = useState<ScanProgress | null>(null)
  const [toasts, setToasts] = useState<Toast[]>([])
  const requestRef = useRef(0)

  const notify = useCallback((toast: Omit<Toast, 'id'>) => {
    const id = (toastId += 1)
    setToasts((current) => [...current, { ...toast, id }])
    setTimeout(() => {
      setToasts((current) => current.filter((entry) => entry.id !== id))
    }, 6000)
  }, [])

  const dismissToast = useCallback((id: number) => {
    setToasts((current) => current.filter((entry) => entry.id !== id))
  }, [])

  useEffect(() => {
    void (async () => {
      const loadedSettings = await api.settings.get()
      setSettings(loadedSettings)
      setExpanded(new Set(loadedSettings.defaultExpandedPaths))
      await refreshRoots()

      const first = loadedSettings.lastFolder ?? favorites[0]?.path ?? volumes[0]?.path ?? null
      if (first) await selectFolderInternal(first, false)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const [favorites, setFavorites] = useState<FolderEntry[]>([])

  /**
   * Re-reads the volume list, the favorite folder list and the watcher roots.
   * These three are always kept in step: a folder is watched precisely because
   * it is a favorite.
   */
  const refreshRoots = useCallback(async () => {
    const [loadedVolumes, loadedFavorites] = await Promise.all([
      api.volumes.list(),
      api.folders.favorites()
    ])
    setVolumes(loadedVolumes)
    setFavorites(loadedFavorites)
    await api.watch.setRoots(loadedFavorites.map((folder) => folder.path))
  }, [])

  const selectFolderInternal = useCallback(
    async (path: string, remember: boolean) => {
      const token = (requestRef.current += 1)
      setLoading(true)
      try {
        const result = await api.folders.list(path)
        if (token !== requestRef.current) return
        setListing(result)
        setSelectedFolder(result.path)
        setSelectedFile(null)
        setPreviewUrl(null)
        setPreviewReason(null)
        setChildrenOf((current) => {
          const next = new Map(current)
          next.set(result.path, result.folders)
          return next
        })
        if (remember) {
          const next = await api.settings.patch({ lastFolder: result.path })
          setSettings(next)
        }
      } catch (error) {
        notify({
          tone: 'error',
          title: 'Could not open folder',
          detail: error instanceof Error ? error.message : String(error)
        })
      } finally {
        if (token === requestRef.current) setLoading(false)
      }
    },
    [notify]
  )

  const selectFolder = useCallback(
    async (path: string) => {
      await selectFolderInternal(path, true)
    },
    [selectFolderInternal]
  )

  const toggleExpanded = useCallback(
    async (path: string) => {
      setExpanded((current) => {
        const next = new Set(current)
        if (next.has(path)) next.delete(path)
        else next.add(path)
        void api.settings.patch({ defaultExpandedPaths: [...next] })
        return next
      })

      if (childrenOf.has(path)) return
      try {
        const result = await api.folders.list(path)
        setChildrenOf((current) => {
          const next = new Map(current)
          next.set(path, result.folders)
          return next
        })
        setExpanded((current) => {
          const next = new Set(current)
          next.add(path)
          void api.settings.patch({ defaultExpandedPaths: [...next] })
          return next
        })
      } catch (error) {
        notify({
          tone: 'error',
          title: 'Could not expand folder',
          detail: error instanceof Error ? error.message : String(error)
        })
      }
    },
    [childrenOf, notify]
  )

  const selectFile = useCallback((file: FileEntry | null) => {
    setSelectedFile(file)
    if (file === null) {
      setPreviewUrl(null)
      setPreviewReason(null)
      return
    }
    setPreviewUrl(null)
    setPreviewReason('loading')
    void (async () => {
      try {
        const payload = await api.preview.get(file.path)
        setPreviewUrl(payload.url)
        setPreviewReason(payload.hasPreview ? null : payload.reason)
      } catch (error) {
        setPreviewUrl(null)
        setPreviewReason(error instanceof Error ? error.message : 'preview failed')
      }
    })()
  }, [])

  const refreshMetadata = useCallback((paths: string[]) => {
    if (paths.length === 0) return
    void (async () => {
      const result = await api.files.metadata(paths)
      setMetadata((current) => ({ ...current, ...result }))
    })()
  }, [])

  useEffect(() => {
    const off = api.events.on('index:progress', setScan)
    return off
  }, [])

  useEffect(() => {
    const off = api.events.on('files:updated', (payload) => {
      if (payload.paths.length === 0) return
      const relevant = payload.paths.filter((path) => listing?.files.some((file) => file.path === path))
      if (relevant.length > 0) {
        void api.files.metadata(relevant).then((result) => {
          setMetadata((current) => ({ ...current, ...result }))
        })
      }
    })
    return off
  }, [listing])

  const addFolder = useCallback(async () => {
    const picked = await api.dialog.pickFolder('Add a folder to Archivum')
    if (picked === null) return
    try {
      // An explicitly added folder is a favorite root: that is what the watcher
      // keys off, and what keeps the folder listed once it is no longer under a
      // detected volume.
      await api.folders.setFavorite(picked, true)
      await refreshRoots()
      await api.index.scan({ path: picked, recursive: true, includeSidecars: false })
      setExpanded((current) => {
        const next = new Set(current)
        next.add(picked)
        void api.settings.patch({ defaultExpandedPaths: [...next] })
        return next
      })
      await selectFolderInternal(picked, true)
    } catch (error) {
      notify({
        tone: 'error',
        title: 'Could not index folder',
        detail: error instanceof Error ? error.message : String(error)
      })
    }
  }, [notify, refreshRoots, selectFolderInternal])

  const rescan = useCallback(async () => {
    if (selectedFolder === null) return
    try {
      await api.index.scan({ path: selectedFolder, recursive: true, includeSidecars: false })
    } catch (error) {
      notify({
        tone: 'error',
        title: 'Scan already running',
        detail: error instanceof Error ? error.message : String(error)
      })
    }
  }, [notify, selectedFolder])

  const patchSettings = useCallback(async (patch: Partial<Settings>) => {
    const next = await api.settings.patch(patch)
    setSettings(next)
  }, [])

  const files = useMemo(() => {
    const all = (listing?.files ?? []).filter(
      (file) => settings.showSidecars || file.kind !== 'sidecar'
    )
    const sorted = [...all]
    sorted.sort((left, right) => {
      const direction = settings.sortDirection === 'asc' ? 1 : -1
      switch (settings.sortBy) {
        case 'date': {
          const a = left.captureAt ?? left.mtimeMs
          const b = right.captureAt ?? right.mtimeMs
          return (a - b) * direction || left.name.localeCompare(right.name)
        }
        case 'size':
          return (left.sizeBytes - right.sizeBytes) * direction
        case 'kind':
          return left.kind.localeCompare(right.kind) * direction || left.name.localeCompare(right.name)
        default:
          return left.name.localeCompare(right.name, undefined, { numeric: true }) * direction
      }
    })
    return sorted
  }, [listing, settings.showSidecars, settings.sortBy, settings.sortDirection])

  const tree = useMemo(
    () => buildTree(volumes, favorites, childrenOf),
    [volumes, favorites, childrenOf]
  )

  return {
    settings,
    volumes,
    favorites,
    tree,
    expanded,
    listing,
    loading,
    selectedFolder,
    selectedFile,
    metadata,
    previewUrl,
    previewReason,
    scan,
    toasts,
    files,
    selectFolder,
    toggleExpanded,
    selectFile,
    addFolder,
    rescan,
    sortBy: settings.sortBy,
    setSortBy: (value) => void patchSettings({ sortBy: value }),
    setThumbSize: (value) => void patchSettings({ thumbnailSize: value }),
    showSidecars: settings.showSidecars,
    setShowSidecars: (value) => void patchSettings({ showSidecars: value }),
    patchSettings,
    refreshMetadata,
    dismissToast,
    notify
  }
}

function buildTree(
  volumes: VolumeInfo[],
  favorites: FolderEntry[],
  childrenOf: Map<string, FolderEntry[]>
): TreeNode[] {
  const makeFolder = (entry: FolderEntry, network: boolean): TreeNode => ({
    path: entry.path,
    label: entry.name,
    kind: 'folder',
    children: (childrenOf.get(entry.path) ?? []).map((child) => makeFolder(child, network)),
    loaded: childrenOf.has(entry.path),
    loading: false,
    hasChildren: entry.dirCount > 0 || entry.scanState === 'pending',
    fileCount: entry.fileCount,
    favorite: entry.favorite,
    network
  })

  const roots: TreeNode[] = volumes.map((volume) => ({
    path: volume.path,
    label: volume.label,
    kind: 'volume' as const,
    children: (childrenOf.get(volume.path) ?? []).map((child) =>
      makeFolder(child, volume.isNetwork)
    ),
    loaded: childrenOf.has(volume.path),
    loading: false,
    hasChildren: true,
    fileCount: 0,
    favorite: volume.isFavorite,
    network: volume.isNetwork
  }))

  // Pinned folders are listed separately so they stay reachable even when they
  // live on a volume that is not currently mounted, and so the user has one
  // place to see everything Archivum is watching.
  const pinned = favorites
    .filter((entry) => entry.path !== '/')
    .map((entry) => makeFolder(entry, true))
    .sort((left, right) => left.label.localeCompare(right.label))

  if (pinned.length === 0) return roots

  return [
    {
      path: '\u0000favorites',
      label: 'Favorites',
      kind: 'group' as const,
      children: pinned,
      loaded: true,
      loading: false,
      hasChildren: true,
      fileCount: 0,
      favorite: true,
      network: false
    },
    ...roots
  ]
}
