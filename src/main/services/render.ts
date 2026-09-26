import { mkdir, rename, stat } from 'node:fs/promises'
import { dirname } from 'node:path'
import sharp, { type Sharp, type SharpOptions } from 'sharp'
import type { AssetIdentity } from './cache'
import { AssetCache } from './cache'
import type { RawDecoder } from './raw'
import type { FileKind } from '../../shared/contract'
import { isRenderableImage } from '../../shared/formats'

/**
 * libvips (bundled with sharp) converts the embedded profile to sRGB by default and
 * strips the profile, so a plain encode is already an ICC-managed transform rather
 * than a passthrough. `keepProfile` opts out of that for pixel-level inspection.
 */
export interface RenderOptions {
  colorManaged: boolean
  keepProfile: boolean
  quality: number
  chromaSubsampling: '4:2:0' | '4:4:4'
}

export const THUMB_OPTIONS: RenderOptions = {
  colorManaged: true,
  keepProfile: false,
  quality: 80,
  chromaSubsampling: '4:2:0'
}

export const PREVIEW_OPTIONS: RenderOptions = {
  colorManaged: true,
  keepProfile: false,
  quality: 90,
  chromaSubsampling: '4:4:4'
}

export const PASSTHROUGH_OPTIONS: RenderOptions = {
  colorManaged: false,
  keepProfile: true,
  quality: 92,
  chromaSubsampling: '4:4:4'
}

export interface RenderRequest {
  identity: AssetIdentity
  kind: FileKind
  size: number | null
  target: string
  options: RenderOptions
}

export interface RenderResult {
  file: string
  bytes: number
  cacheHit: boolean
}

const SHARP_INPUT: Record<string, SharpOptions> = {
  jpg: {},
  jpeg: {},
  jpe: {},
  jfif: {},
  png: {},
  webp: {},
  bmp: {},
  avif: {},
  heic: {},
  heif: {},
  gif: { limitInputPixels: 268402689 },
  jp2: { limitInputPixels: 1_000_000_000 },
  tif: { limitInputPixels: 1_000_000_000 },
  tiff: { limitInputPixels: 1_000_000_000 }
}

const MAX_PIXELS = 1_000_000_000

export function extensionOfPath(path: string): string {
  const index = path.lastIndexOf('.')
  return index <= 0 ? '' : path.slice(index + 1).toLowerCase()
}

export class RenderService {
  private readonly inflight = new Map<string, Promise<RenderResult>>()
  private readonly identities = new Map<string, AssetIdentity>()
  private running = 0

  constructor(
    private readonly cache: AssetCache,
    private readonly raw: RawDecoder,
    private readonly maxConcurrent = 4
  ) {}

  remember(identity: AssetIdentity): void {
    this.identities.set(identity.path, identity)
  }

  identityFor(path: string): AssetIdentity | null {
    return this.identities.get(path) ?? null
  }

  /** Whether this file can produce pixels at all, used to avoid doomed cache attempts. */
  async supports(path: string, kind: FileKind): Promise<boolean> {
    if (kind === 'raw') return this.raw.canDecode(path)
    return isRenderableImage(kind) || extensionOfPath(path) in SHARP_INPUT
  }

  async render(request: RenderRequest): Promise<RenderResult> {
    const existing = this.inflight.get(request.target)
    if (existing) return existing
    const task = this.run(request).finally(() => {
      this.inflight.delete(request.target)
    })
    this.inflight.set(request.target, task)
    return task
  }

  private async run(request: RenderRequest): Promise<RenderResult> {
    this.remember(request.identity)
    if (await this.cache.exists(request.target)) {
      return { file: request.target, bytes: await this.probe(request.target), cacheHit: true }
    }

    await this.acquire()
    try {
      const image = await this.build(request)
      await mkdir(dirname(request.target), { recursive: true })
      const temp = `${request.target}.${process.pid}.tmp`
      await image.toFile(temp)
      await rename(temp, request.target)
      return { file: request.target, bytes: await this.probe(request.target), cacheHit: false }
    } finally {
      this.release()
    }
  }

  private async build(request: RenderRequest): Promise<Sharp> {
    const ext = extensionOfPath(request.identity.path)
    const source =
      request.kind === 'raw'
        ? ((await this.raw.extractPreview(request.identity.path)) ??
          (await this.raw.decodeToBuffer(request.identity.path)))
        : null

    let image =
      source !== null
        ? sharp(source, { limitInputPixels: MAX_PIXELS })
        : sharp(request.identity.path, SHARP_INPUT[ext] ?? { limitInputPixels: MAX_PIXELS })

    image = image.rotate()

    if (request.size != null) {
      image = image.resize({
        width: request.size,
        height: request.size,
        fit: 'inside',
        withoutEnlargement: true,
        fastShrinkOnLoad: true
      })
    }

    if (request.options.colorManaged) {
      image = image.toColourspace('srgb')
    }
    if (request.options.keepProfile) {
      image = image.keepIccProfile()
    }

    return image.jpeg({
      quality: request.options.quality,
      chromaSubsampling: request.options.chromaSubsampling,
      mozjpeg: true,
      progressive: false
    })
  }

  private probe(file: string): Promise<number> {
    return stat(file).then(
      (info) => info.size,
      () => 0
    )
  }

  fileFor(path: string, kind: 'thumb' | 'preview', size: number | null): string | null {
    const identity = this.identities.get(path)
    return identity ? this.cache.fileFor(kind, identity, size) : null
  }

  private async acquire(): Promise<void> {
    while (this.running >= this.maxConcurrent) {
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    this.running += 1
  }

  private release(): void {
    this.running = Math.max(0, this.running - 1)
  }
}
