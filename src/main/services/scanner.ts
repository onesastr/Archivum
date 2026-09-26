import { readdir, stat } from 'node:fs/promises'
import type { Dirent } from 'node:fs'
import { join } from 'node:path'
import type { ScanProgress } from '../../shared/contract'
import { classifyFileName } from '../../shared/formats'
import { ArchivumDatabase, toFileRecordFromStat, type FileRecord } from '../db'
import { assertSafePath } from './paths'

const IGNORED_DIRS = new Set([
  '@eaDir',
  '.thumbnails',
  '.trash',
  '.Trash',
  '.Spotlight-V100',
  '.Trashes',
  '.fseventsd',
  '.TemporaryItems',
  '.DocumentRevisions-V100',
  '$RECYCLE.BIN',
  'System Volume Information',
  'lost+found'
])

const RENDERABLE_EXTENSIONS = new Set([
  'jpg', 'jpeg', 'jpe', 'jfif', 'png', 'tif', 'tiff', 'webp', 'heic', 'heif', 'avif', 'jp2', 'j2k',
  'cr2', 'cr3', 'nef', 'arw', 'dng', 'orf', 'raf', 'rw2', 'pef', 'srw', 'x3f', '3fr', 'erf', 'mrw',
  'kdc', 'dcr', 'mos', 'iiq', 'rwl', 'sr2', 'srf', 'fff', 'mef'
])

const SIDECAR_PATTERN = /\.(xmp|aae|json|lrcat|lrk2)$/i

export function isInterestingFile(name: string): boolean {
  return RENDERABLE_EXTENSIONS.has(name.slice(name.lastIndexOf('.') + 1).toLowerCase())
}

export interface ScanRequest {
  path: string
  recursive: boolean
  includeSidecars: boolean
}

export interface ScanOutcome {
  scanId: string
  foldersDone: number
  filesIndexed: number
  bytesIndexed: number
  cancelled: boolean
  error: string | null
}

interface FolderContents {
  path: string
  fileCount: number
  dirCount: number
  totalBytes: number
  records: FileRecord[]
}

export class ScanService {
  private readonly cancelled = new Set<string>()
  private active: { id: string; root: string } | null = null
  private counter = 0

  constructor(
    private readonly db: ArchivumDatabase,
    private readonly emit: (progress: ScanProgress) => void
  ) {}

  isScanning(): boolean {
    return this.active !== null
  }

  cancel(scanId: string): void {
    this.cancelled.add(scanId)
  }

  /**
   * Reads a single folder into the index. Used when browsing a folder that has not
   * been scanned (or whose share came back with different contents). Deliberately
   * not gated by `begin`, so browsing never waits on a long recursive scan.
   */
  async scanOne(folderPath: string, includeSidecars = false): Promise<void> {
    const target = assertSafePath(folderPath)
    const contents = await this.readFolder(target, includeSidecars)
    if (contents === null) return
    this.commit(contents)
  }

  /** Starts a full recursive scan. One at a time — concurrent scans would fight over rows. */
  begin(request: ScanRequest): { scanId: string } {
    if (this.active !== null) throw new Error('a scan is already running')
    const scanId = `scan-${Date.now()}-${(this.counter += 1)}`
    this.active = { id: scanId, root: assertSafePath(request.path) }
    void this.execute(scanId, request).catch((error: unknown) => {
      console.error('[scan] failed', error)
    })
    return { scanId }
  }

  private async execute(scanId: string, request: ScanRequest): Promise<void> {
    const root = assertSafePath(request.path)
    const startedAt = Date.now()
    let foldersDone = 0
    let filesIndexed = 0
    let bytesIndexed = 0
    let currentPath: string | null = root
    let error: string | null = null
    let wasCancelled = false
    let lastEmit = 0

    const progress = (state: ScanProgress['state']): void => {
      this.emit({
        scanId,
        root,
        foldersDone,
        foldersTotal: 0,
        filesIndexed,
        bytesIndexed,
        currentPath,
        state,
        error,
        startedAt,
        finishedAt: state === 'running' ? null : Date.now()
      })
    }

    progress('running')

    // Each folder is committed as it is walked so the grid fills in progressively
    // instead of blocking until a multi-TB volume finishes.
    const queue: string[] = [root]
    try {
      while (queue.length > 0) {
        if (this.cancelled.has(scanId)) {
          wasCancelled = true
          break
        }
        const dir = queue.shift() as string
        const contents = await this.readFolder(dir, request.includeSidecars)
        if (contents !== null) {
          this.commit(contents)
          currentPath = dir
          foldersDone += 1
          filesIndexed += contents.records.length
          bytesIndexed += contents.totalBytes
        }
        for (const child of contents?.children ?? []) queue.push(child)

        const now = Date.now()
        if (now - lastEmit > 120) {
          lastEmit = now
          progress('running')
        }
      }
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught)
    }

    this.cancelled.delete(scanId)
    this.active = null
    progress(error !== null ? 'error' : wasCancelled ? 'cancelled' : 'done')
  }

  private async readFolder(
    dir: string,
    includeSidecars: boolean
  ): Promise<(FolderContents & { children: string[] }) | null> {
    let entries: Dirent[]
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return null
    }

    const records: FileRecord[] = []
    const children: string[] = []
    let dirCount = 0
    let totalBytes = 0

    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      if (IGNORED_DIRS.has(entry.name)) continue
      const full = join(dir, entry.name)

      if (entry.isDirectory()) {
        dirCount += 1
        children.push(full)
        continue
      }
      if (!entry.isFile() && !entry.isSymbolicLink()) continue

      const isSidecar = SIDECAR_PATTERN.test(entry.name)
      if (isSidecar ? !includeSidecars : !isInterestingFile(entry.name)) continue

      let info: Awaited<ReturnType<typeof stat>>
      try {
        info = await stat(full)
      } catch {
        continue
      }
      if (!info.isFile()) continue

      totalBytes += info.size
      records.push(
        toFileRecordFromStat({
          path: full,
          sizeBytes: info.size,
          mtimeMs: info.mtimeMs,
          birthtimeMs: info.birthtime ? info.birthtime.getTime() : null,
          inode: info.ino ? String(info.ino) : null,
          kind: isSidecar ? 'sidecar' : classifyFileName(entry.name)
        })
      )
    }

    return { path: dir, fileCount: records.length, dirCount, totalBytes, records, children }
  }

  private commit(contents: FolderContents): void {
    this.db.updateFolderStats({
      path: contents.path,
      fileCount: contents.fileCount,
      dirCount: contents.dirCount,
      totalBytes: contents.totalBytes,
      scanState: 'fresh',
      scannedAt: Date.now()
    })
    this.db.replaceFilesInFolder(contents.path, contents.records)
  }
}
