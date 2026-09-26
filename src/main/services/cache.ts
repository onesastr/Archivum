import { createHash } from 'node:crypto'
import { mkdir, readdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { Dirent } from 'node:fs'

export type CacheKind = 'thumb' | 'preview'

export interface AssetIdentity {
  path: string
  mtimeMs: number
  sizeBytes: number
}

export interface CachePaths {
  root: string
  thumbs: string
  previews: string
}

const IDENTITY_ALGO = 'sha1'
const IDENTITY_ENCODING = 'hex'

export function identityKey(identity: AssetIdentity): string {
  return createHash(IDENTITY_ALGO)
    .update(`${identity.path}\u0000${identity.mtimeMs}\u0000${identity.sizeBytes}`)
    .digest(IDENTITY_ENCODING)
}

export class AssetCache {
  private readonly paths: CachePaths

  constructor(userDataPath: string) {
    const root = join(userDataPath, 'assets')
    this.paths = { root, thumbs: join(root, 'thumbs'), previews: join(root, 'previews') }
  }

  get root(): string {
    return this.paths.root
  }

  async ensure(): Promise<void> {
    await Promise.all([
      mkdir(this.paths.thumbs, { recursive: true }),
      mkdir(this.paths.previews, { recursive: true })
    ])
  }

  fileFor(kind: CacheKind, identity: AssetIdentity, size: number | null): string {
    const directory = kind === 'thumb' ? this.paths.thumbs : this.paths.previews
    const key = identityKey(identity)
    const bucket = key.slice(0, 2)
    const suffix = size == null ? '' : `-${size}`
    return join(directory, bucket, `${key}${suffix}.jpg`)
  }

  async exists(file: string): Promise<boolean> {
    try {
      const info = await stat(file)
      return info.isFile() && info.size > 0
    } catch {
      return false
    }
  }

  async clear(): Promise<void> {
    await rm(this.paths.root, { recursive: true, force: true })
    await this.ensure()
  }

  async usageBytes(): Promise<number> {
    let total = 0
    const walk = async (dir: string): Promise<void> => {
      let entries: Dirent[]
      try {
        entries = await readdir(dir, { withFileTypes: true })
      } catch {
        return
      }
      for (const entry of entries) {
        const full = join(dir, entry.name)
        if (entry.isDirectory()) {
          await walk(full)
          continue
        }
        try {
          total += (await stat(full)).size
        } catch {
          /* file vanished mid-walk */
        }
      }
    }
    await walk(this.paths.thumbs)
    await walk(this.paths.previews)
    return total
  }
}
