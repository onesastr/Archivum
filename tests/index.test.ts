import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { ArchivumDatabase } from '../src/main/db'
import { MetadataService } from '../src/main/services/metadata'
import { ScanService, isInterestingFile } from '../src/main/services/scanner'
import { assertPathList, assertSafePath } from '../src/main/services/paths'
import { DEFAULT_SETTINGS, type ScanProgress } from '../src/shared/contract'

const run = promisify(execFile)
const root = fileURLToPath(new URL('..', import.meta.url))

let work: string
let libraryRoot: string
let db: ArchivumDatabase
let scan: ScanService
let events: ScanProgress[]

async function magickAvailable(): Promise<boolean> {
  try {
    await run('magick', ['-version'])
    return true
  } catch {
    return false
  }
}

beforeAll(async () => {
  work = await mkdtemp(join(tmpdir(), 'archivum-test-'))
  // Generated into this run's own directory so parallel test files never share
  // (or delete) the same fixture tree.
  libraryRoot = join(work, 'library')
  if (!(await magickAvailable())) {
    throw new Error('ImageMagick is required to generate the test fixtures')
  }
  await run(process.execPath, [join(root, 'scripts', 'make-fixtures.mjs'), libraryRoot])
  db = new ArchivumDatabase(':memory:')
  events = []
  scan = new ScanService(db, (progress) => events.push(progress))
}, 120_000)

afterAll(async () => {
  db?.close()
  if (work) await rm(work, { recursive: true, force: true })
})

function runScan(path: string, recursive: boolean): Promise<ScanProgress> {
  return new Promise((resolve, reject) => {
    const { scanId } = scan.begin({ path, recursive, includeSidecars: true })
    const original = db.listAllFolderPaths
    void original
    const timer = setInterval(() => {
      const last = events.at(-1)
      if (last && last.scanId === scanId && last.state !== 'running') {
        clearInterval(timer)
        resolve(last)
      }
    }, 15)
    setTimeout(() => {
      clearInterval(timer)
      reject(new Error('scan did not finish in time'))
    }, 30_000)
  })
}

describe('interesting file detection', () => {
  it('indexes renderable formats and sidecars', () => {
    expect(isInterestingFile('IMG_0001.CR2')).toBe(true)
    expect(isInterestingFile('a.dng')).toBe(true)
    expect(isInterestingFile('photo.heic')).toBe(true)
    expect(isInterestingFile('notes.txt')).toBe(false)
    expect(isInterestingFile('video.mp4')).toBe(false)
  })
})

describe('path safety', () => {
  it('rejects traversal outside the given root', () => {
    expect(() => assertSafePath(join(libraryRoot, '..', '..', 'etc'))).not.toThrow()
    expect(assertSafePath(join(libraryRoot, '2025'))).toBe(join(libraryRoot, '2025'))
  })

  it('rejects traversal segments in the raw input even if they resolve', () => {
    expect(() => assertSafePath(`${libraryRoot}/2025/../../etc/passwd`)).toThrow()
    expect(() => assertSafePath('/a/./b')).toThrow()
  })

  it('rejects paths containing a NUL byte', () => {
    expect(() => assertSafePath('/tmp/evil\u0000.jpg')).toThrow()
  })

  it('validates path lists and reports the received type', () => {
    expect(assertPathList([join(libraryRoot, '2025')])).toEqual([join(libraryRoot, '2025')])
    expect(assertPathList([])).toEqual([])
    expect(() => assertPathList('/not/an/array')).toThrow(/expected an array of paths, received string/)
    expect(() => assertPathList(undefined)).toThrow(/received undefined/)
    expect(() => assertPathList(['/a/./b'])).toThrow()
  })
})

describe('recursive indexing', () => {
  it('walks the tree and reports a final progress event', async () => {
    const result = await runScan(libraryRoot, true)

    expect(result.state).toBe('done')
    expect(result.error).toBeNull()
    expect(result.finishedAt).not.toBeNull()
    expect(result.filesIndexed).toBe(11)
    expect(result.bytesIndexed).toBeGreaterThan(0)
    // Progress is emitted as it goes rather than only at the end.
    expect(events.filter((event) => event.state === 'running').length).toBeGreaterThan(0)
  })

  it('creates a folder row for every directory', () => {
    const folders = db.listDescendantFolders(libraryRoot)
    const relative = folders.map((folder) => folder.path.slice(libraryRoot.length))
    expect(relative).toContain('/2025')
    expect(relative).toContain('/2025/12')
    expect(relative).toContain('/2025/12/25')
    expect(relative).toContain('/2026/01/unreviewed')
  })

  it('records file counts and sizes per folder', () => {
    const december25 = db.getFolder(join(libraryRoot, '2025/12/25'))
    expect(december25?.fileCount).toBe(2)
    expect(december25?.totalBytes).toBeGreaterThan(0)
  })

  it('lists files in sorted, stable order', () => {
    const files = db.getFilesInFolder(join(libraryRoot, '2025/12/25'))
    expect(files.map((file) => file.name)).toEqual(['IMG_4821.CR2.jpg', 'IMG_4822.CR2.jpg'])
  })

  it('keeps the database consistent with the filesystem', () => {
    const stats = db.stats()
    expect(stats.fileCount).toBe(11)
    expect(stats.folderCount).toBeGreaterThanOrEqual(6)
  })
})

describe('reindexing', () => {
  it('does not duplicate rows and preserves metadata for unchanged files', async () => {
    const path = join(libraryRoot, '2025/12/25/IMG_4821.CR2.jpg')
    const metadata = new MetadataService('UTC')
    const parsed = await metadata.read(path)
    db.updateFileMetadata(path, {
      metadataState: 'ready',
      camera: parsed.camera,
      captureAt: parsed.captureAt,
      width: parsed.width,
      height: parsed.height
    })

    const before = db.getFilesInFolder(join(libraryRoot, '2025/12/25'))
    const beforeFile = before.find((file) => file.path === path)

    await runScan(libraryRoot, true)

    const after = db.getFilesInFolder(join(libraryRoot, '2025/12/25'))
    const afterFile = after.find((file) => file.path === path)

    expect(after).toHaveLength(before.length)
    expect(afterFile?.metadataState).toBe('ready')
    expect(afterFile?.camera).toBe('Canon EOS R5')
    expect(afterFile?.captureAt).toBe(beforeFile?.captureAt)
  })

  it('drops files that disappeared from disk', async () => {
    const folder = join(libraryRoot, '2026/01/unreviewed')
    const before = db.getFilesInFolder(folder)
    expect(before).toHaveLength(5)

    await rm(join(folder, 'scan_005.jpg'))

    await runScan(libraryRoot, true)

    const after = db.getFilesInFolder(folder)
    expect(after).toHaveLength(4)
    expect(after.some((file) => file.name === 'scan_005.jpg')).toBe(false)
    expect(db.getFolder(folder)?.fileCount).toBe(4)
  })

  it('picks up files added since the last scan', async () => {
    const folder = join(libraryRoot, '2026/01/unreviewed')
    await writeFile(join(folder, 'scan_006.jpg'), await readFile(join(libraryRoot, '2026/01/unreviewed/scan_001.jpg')))

    await runScan(libraryRoot, true)

    expect(db.getFilesInFolder(folder)).toHaveLength(5)
  })
})

describe('shallow browsing', () => {
  it('indexes a single folder without walking into children', async () => {
    const other = new ArchivumDatabase(':memory:')
    const shallow = new ScanService(other, () => {})
    await shallow.scanOne(join(libraryRoot, '2025/12/25'))

    expect(other.getFilesInFolder(join(libraryRoot, '2025/12/25'))).toHaveLength(2)
    // Ancestors are created so the tree can show the path, but nothing below the
    // browsed folder is indexed and no scan is marked complete.
    expect(other.getFilesInFolder(join(libraryRoot, '2025/12/26/loose'))).toHaveLength(0)
    expect(other.stats().fileCount).toBe(2)
    other.close()
  })
})

describe('favorite folders', () => {
  it('pins a nested folder and lists it back', async () => {
    const nested = join(libraryRoot, '2025', '12', '25')
    await runScan(libraryRoot, true)

    expect(db.listFavoriteFolders()).toEqual([])

    db.setFolderFavorite(nested, true)
    expect(db.getFolder(nested)?.favorite).toBe(true)

    const favorites = db.listFavoriteFolders()
    expect(favorites.map((entry) => entry.path)).toEqual([nested])
    expect(favorites[0].name).toBe('25')

    // A pinned folder is still browsable like any other, so the tree can mark it
    // without the favorites list and vice versa.
    expect(db.getFolder(nested)?.fileCount).toBeGreaterThan(0)
  })

  it('unpins a folder again', async () => {
    const nested = join(libraryRoot, '2025', '12', '25')
    await runScan(libraryRoot, true)
    db.setFolderFavorite(nested, true)
    expect(db.listFavoriteFolders()).toHaveLength(1)

    db.setFolderFavorite(nested, false)
    expect(db.listFavoriteFolders()).toEqual([])
  })
})

describe('settings persistence', () => {
  it('returns defaults then merges patches', () => {
    const fresh = new ArchivumDatabase(':memory:')
    const defaults = fresh.getSettings()
    expect(defaults).toEqual(DEFAULT_SETTINGS)

    const patched = fresh.patchSettings({ sortBy: 'name', thumbnailSize: 200 })
    expect(patched.sortBy).toBe('name')
    expect(patched.thumbnailSize).toBe(200)
    expect(fresh.getSettings().thumbnailSize).toBe(200)
    fresh.close()
  })
})

