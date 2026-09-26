import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { protocol } from 'electron'
import type { AppServices } from './services'
import { THUMB_SCHEME } from '../shared/contract'
import { parseAssetUrl } from '../shared/url'
import { classifyExtension } from '../shared/formats'
import { PREVIEW_SIZE, THUMB_SIZE } from './services/preview'
import { PREVIEW_OPTIONS, THUMB_OPTIONS, type RenderOptions } from './services/render'
import type { CacheKind } from './services/cache'
import { statIdentity } from './services/metadata'

/**
 * Serves pixels over a custom scheme instead of `file://`, so the renderer never
 * needs filesystem access and the main process stays the only process that touches
 * the library. Missing cache entries are rendered on demand, which means `<img src>`
 * is the entire integration the grid needs.
 */
export function registerAssetProtocol(services: AppServices): void {
  protocol.handle(THUMB_SCHEME, async (request) => {
    const parsed = parseAssetUrl(request.url)
    if (parsed === null) return new Response('malformed asset url', { status: 400 })

    try {
      switch (parsed.kind) {
        case 'original':
          return await serveOriginal(parsed.path)
        case 'thumb':
          return await serveDerived(services, parsed.path, 'thumb', THUMB_SIZE, THUMB_OPTIONS)
        case 'preview':
          return await serveDerived(services, parsed.path, 'preview', PREVIEW_SIZE, PREVIEW_OPTIONS)
        default:
          return new Response('unknown asset kind', { status: 400 })
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return new Response(message, { status: 404 })
    }
  })
}

function fileResponse(file: string, contentType: string, cacheControl = 'no-store'): Promise<Response> {
  return stat(file).then((info) => {
    const stream = createReadStream(file)
    return new Response(stream as unknown as ReadableStream, {
      status: 200,
      headers: {
        'content-type': contentType,
        'content-length': String(info.size),
        'cache-control': cacheControl,
        'disposition': 'inline'
      }
    })
  })
}

function serveOriginal(path: string): Promise<Response> {
  return fileResponse(path, contentTypeFor(path))
}

async function serveDerived(
  services: AppServices,
  path: string,
  cacheKind: CacheKind,
  size: number,
  options: RenderOptions
): Promise<Response> {
  const kind = classifyExtension(extensionOf(path))
  const identity = services.render.identityFor(path) ?? (await statIdentity(path))
  services.render.remember(identity)

  const target = services.cache.fileFor(cacheKind, identity, size)

  if (!(await services.cache.exists(target))) {
    if (!(await services.render.supports(path, kind))) {
      return new Response(`cannot render ${path}`, { status: 415 })
    }
    await services.render.render({ identity, kind, size, target, options })
  }

  return fileResponse(target, 'image/jpeg')
}

function extensionOf(path: string): string {
  const index = path.lastIndexOf('.')
  return index <= 0 ? '' : path.slice(index + 1).toLowerCase()
}

const CONTENT_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  jpe: 'image/jpeg',
  png: 'image/png',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
  heic: 'image/heic',
  heif: 'image/heif',
  bmp: 'image/bmp',
  pdf: 'application/pdf'
}

export function contentTypeFor(path: string): string {
  return CONTENT_TYPES[extensionOf(path)] ?? 'application/octet-stream'
}
