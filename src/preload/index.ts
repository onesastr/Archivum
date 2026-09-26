import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import {
  EVENT_CHANNELS,
  type IpcArgs,
  type IpcChannel,
  type IpcEventMap,
  type IpcEventName,
  type IpcResult,
  type Settings
} from '../shared/contract'
import { buildAssetUrl, type AssetKind } from '../shared/url'

type Unsubscribe = () => void

function invoke<C extends IpcChannel>(channel: C, args: IpcArgs<C>): Promise<IpcResult<C>> {
  return ipcRenderer.invoke(channel, args) as Promise<IpcResult<C>>
}

const api = {
  app: {
    info: () => invoke('app:info', undefined)
  },
  window: {
    minimize: () => invoke('window:minimize', undefined),
    toggleMaximize: () => invoke('window:toggleMaximize', undefined),
    close: () => invoke('window:close', undefined),
    state: () => invoke('window:state', undefined)
  },
  dialog: {
    pickFolder: (title: string) => invoke('dialog:pickFolder', { title })
  },
  shell: {
    openPath: (path: string) => invoke('shell:openPath', { path }),
    showInFolder: (path: string) => invoke('shell:showInFolder', { path })
  },
  volumes: {
    list: () => invoke('volumes:list', undefined),
    setFavorite: (path: string, favorite: boolean) => invoke('volumes:setFavorite', { path, favorite })
  },
  folders: {
    list: (path: string) => invoke('folders:list', { path }),
    children: (path: string) => invoke('folders:children', { path }),
    favorites: () => invoke('folders:favorites', undefined),
    setFavorite: (path: string, favorite: boolean) => invoke('folders:setFavorite', { path, favorite })
  },
  files: {
    metadata: (paths: string[]) => invoke('files:metadata', { paths })
  },
  preview: {
    get: (path: string) => invoke('preview:get', { path })
  },
  thumbs: {
    ensure: (paths: string[]) => invoke('thumbs:ensure', { paths }),
    url: (path: string, size: number, version?: number | null) =>
      buildAssetUrl('thumb', path, { size, version: version ?? null })
  },
  assets: {
    url: (kind: AssetKind, path: string, options?: { size?: number; icc?: boolean; version?: number | null }) =>
      buildAssetUrl(kind, path, options ?? {})
  },
  index: {
    scan: (request: { path: string; recursive: boolean; includeSidecars: boolean }) =>
      invoke('index:scan', request),
    cancel: (scanId: string) => invoke('index:cancel', { scanId }),
    status: () => invoke('index:status', undefined)
  },
  watch: {
    setRoots: (paths: string[]) => invoke('watch:setRoots', { paths })
  },
  settings: {
    get: () => invoke('settings:get', undefined),
    patch: (patch: Partial<Settings>) => invoke('settings:patch', { patch })
  },
  events: {
    on<E extends IpcEventName>(event: E, listener: (payload: IpcEventMap[E]) => void): Unsubscribe {
      if (!EVENT_CHANNELS.includes(event)) return () => undefined
      const handler = (_electronEvent: IpcRendererEvent, payload: IpcEventMap[E]): void => {
        listener(payload)
      }
      ipcRenderer.on(event, handler)
      return () => {
        ipcRenderer.removeListener(event, handler)
      }
    }
  }
}

export type ArchivumApi = typeof api

contextBridge.exposeInMainWorld('archivum', api)
