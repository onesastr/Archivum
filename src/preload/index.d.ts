import type { ArchivumApi } from './index'

declare global {
  interface Window {
    archivum: ArchivumApi
  }
}

export {}
