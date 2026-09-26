import { readFile, stat } from 'node:fs/promises'
import { classifyExtension } from '../../shared/formats'
import type { FileEntry, FileKind, PreviewPayload } from '../../shared/contract'
import { buildAssetUrl, isSrgbProfile } from '../../shared/url'
import { AssetCache } from './cache'
import { MetadataService, statIdentity } from './metadata'
import { PREVIEW_OPTIONS, RenderService, THUMB_OPTIONS } from './render'
import type { RawDecoder } from './raw'

export const PREVIEW_SIZE = 2048
export const THUMB_SIZE = 320

export class PreviewService {
  constructor(
    private readonly cache: AssetCache,
    private readonly render: RenderService,
    private readonly metadata: MetadataService,
    private readonly raw: RawDecoder
  ) {}

  async resolve(path: string, kindHint?: FileKind): Promise<PreviewPayload> {
    const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase()
    const kind = kindHint ?? classifyExtension(ext)

    let identity: Awaited<ReturnType<typeof statIdentity>> | null = null
    try {
      identity = await statIdentity(path)
    } catch {
      return {
        path,
        url: null,
        kind,
        width: null,
        height: null,
        orientation: null,
        icc: null,
        hasPreview: false,
        reason: 'file is not readable',
        colorManaged: false
      }
    }

    this.render.remember(identity)

    if (kind === 'video' || kind === 'sidecar' || kind === 'other') {
      return {
        path,
        url: null,
        kind,
        width: null,
        height: null,
        orientation: null,
        icc: null,
        hasPreview: false,
        reason: `no preview for .${ext || 'unknown'} files`,
        colorManaged: false
      }
    }

    const meta = await this.metadata.read(path, kind, identity)
    const rendered = await this.renderFile(identity, kind)

    if (!rendered) {
      const reason =
        kind === 'raw' && !(await this.raw.isAvailable())
          ? 'LibRaw is not available in this build'
          : 'no embedded preview could be decoded'
      return {
        path,
        url: null,
        kind,
        width: meta.width,
        height: meta.height,
        orientation: meta.orientation,
        icc: meta.icc,
        hasPreview: false,
        reason,
        colorManaged: true
      }
    }

    return {
      path,
      // The renderer is handed an archivum: URL rather than a filesystem path,
      // so it never sees the cache layout and the protocol handler stays the
      // single gate on reading image data.
      url: buildAssetUrl('preview', path, { version: identity.mtimeMs }),
      kind,
      width: meta.width,
      height: meta.height,
      orientation: meta.orientation,
      icc: meta.icc,
      hasPreview: true,
      reason: null,
      colorManaged: PREVIEW_OPTIONS.colorManaged && !isSrgbProfile(meta.icc)
    }
  }

  private async renderFile(
    identity: Awaited<ReturnType<typeof statIdentity>>,
    kind: FileKind
  ): Promise<boolean> {
    const target = this.cache.fileFor('preview', identity, PREVIEW_SIZE)
    try {
      await this.render.render({
        identity,
        kind,
        size: PREVIEW_SIZE,
        target,
        options: PREVIEW_OPTIONS
      })
      return true
    } catch {
      return false
    }
  }

  async thumbnailTarget(identity: Awaited<ReturnType<typeof statIdentity>>): Promise<string> {
    return this.cache.fileFor('thumb', identity, THUMB_SIZE)
  }

  async originalBytes(path: string): Promise<Buffer> {
    return readFile(path)
  }

  async originalSize(path: string): Promise<number> {
    return (await stat(path)).size
  }

  async ensureThumbnail(
    identity: Awaited<ReturnType<typeof statIdentity>>,
    kind: FileKind
  ): Promise<{ target: string; cacheHit: boolean } | null> {
    const target = await this.thumbnailTarget(identity)
    if (await this.cache.exists(target)) return { target, cacheHit: true }
    if (!(await this.render.supports(identity.path, kind))) return null
    try {
      const result = await this.render.render({
        identity,
        kind,
        size: THUMB_SIZE,
        target,
        options: THUMB_OPTIONS
      })
      return { target: result.file, cacheHit: result.cacheHit }
    } catch {
      return null
    }
  }
}

export type { FileEntry }
