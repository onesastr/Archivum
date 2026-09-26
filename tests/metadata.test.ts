import { execFile } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MetadataService, resolveCaptureDate } from '../src/main/services/metadata'
import { classifyExtension, isRenderableImage } from '../src/shared/formats'

const run = promisify(execFile)

const root = fileURLToPath(new URL('..', import.meta.url))
// Each test file generates its own private copy. A shared fixtures directory
// would race: vitest runs the files in parallel workers, and anything that
// regenerates or cleans the shared tree breaks the file still reading it.
let library = ''

const FIXTURES = [
  '2025/12/25/IMG_4821.CR2.jpg',
  '2025/12/25/IMG_4822.CR2.jpg',
  '2025/12/26/loose/DSC_0091.jpg',
  '2025/12/26/loose/20191231-235959_nikon.jpg',
  '2025/12/26/loose/no-metadata-at-all.png',
  '2025/12/27/portrait_4823.jpg',
  '2026/01/unreviewed/scan_001.jpg'
]

async function magickAvailable(): Promise<boolean> {
  try {
    await run('magick', ['-version'])
    return true
  } catch {
    return false
  }
}

beforeAll(async () => {
  library = await mkdtemp(join(tmpdir(), 'archivum-fixtures-'))
  if (!(await magickAvailable())) {
    throw new Error('ImageMagick is required to generate the test fixtures')
  }
  await run(process.execPath, [join(root, 'scripts', 'make-fixtures.mjs'), library])
}, 180_000)

describe('metadata extraction', () => {
  const service = new MetadataService('Europe/Berlin')

  it('reads a full Canon EXIF block including GPS and offset time', async () => {
    const metadata = await service.read(join(library, '2025/12/25/IMG_4821.CR2.jpg'))

    expect(metadata.state).toBe('ready')
    expect(metadata.cameraMake).toBe('Canon')
    expect(metadata.cameraModel).toBe('Canon EOS R5')
    expect(metadata.camera).toBe('Canon EOS R5')
    expect(metadata.lens).toBe('RF35mm F1.8 MACRO IS STM')
    expect(metadata.serial).toBe('042051000537')
    expect(metadata.iso).toBe(400)
    expect(metadata.aperture).toBeCloseTo(2.8, 5)
    expect(metadata.shutter).toBeCloseTo(0.004, 6)
    expect(metadata.focalLength).toBe(35)
    expect(metadata.width).toBe(1800)
    expect(metadata.height).toBe(1200)
    expect(metadata.orientation).toBe(1)
    expect(metadata.gps?.latitude).toBeCloseTo(48.8582, 3)
    expect(metadata.gps?.longitude).toBeCloseTo(2.2945, 3)
  })

  it('honours the embedded UTC offset rather than the machine zone', async () => {
    const metadata = await service.read(join(library, '2025/12/25/IMG_4821.CR2.jpg'))
    // 14:33:21 at +01:00 is 13:33:21Z. The runner's own zone must not leak in.
    expect(new Date(metadata.captureAt).toISOString()).toBe('2025-12-25T13:33:21.000Z')
    expect(metadata.captureSource).toBe('exif')
  })

  it('reports rotated orientation', async () => {
    const metadata = await service.read(join(library, '2025/12/25/IMG_4822.CR2.jpg'))
    expect(metadata.orientation).toBe(6)
  })

  it('reads a Nikon block with a non-ASCII-free make', async () => {
    const metadata = await service.read(join(library, '2025/12/26/loose/DSC_0091.jpg'))
    expect(metadata.cameraMake).toBe('NIKON CORPORATION')
    expect(metadata.cameraModel).toBe('NIKON Z 8')
    expect(metadata.lens).toBe('NIKKOR Z 24mm f/1.8 S')
    expect(metadata.focalLength).toBe(24)
  })

  it('falls back to the file timestamp when there is no EXIF at all', async () => {
    const metadata = await service.read(join(library, '2025/12/26/loose/no-metadata-at-all.png'))
    expect(metadata.state).toBe('ready')
    expect(metadata.camera).toBeNull()
    expect(metadata.captureSource).toBe('modified')
    expect(metadata.captureAt).toBeGreaterThan(0)
    expect(metadata.width).toBe(1000)
  })

  it('reads dimensions for a JPEG that only has an embedded ICC profile', async () => {
    const metadata = await service.read(join(library, '2025/12/26/loose/20191231-235959_nikon.jpg'))
    expect(metadata.state).toBe('ready')
    expect(metadata.captureSource).toBe('modified')
    expect(metadata.icc).not.toBeNull()
  })

  it('describes the embedded ICC profile of an Adobe RGB image', async () => {
    const metadata = await service.read(join(library, '2025/12/25/IMG_4821.CR2.jpg'))
    expect(metadata.icc).not.toBeNull()
    expect(metadata.icc?.isSrgb).toBe(false)
    expect(metadata.icc?.sizeBytes).toBeGreaterThan(100)
  })

  it('reports sRGB images as sRGB', async () => {
    const metadata = await service.read(join(library, '2025/12/26/loose/DSC_0091.jpg'))
    expect(metadata.icc?.isSrgb).toBe(true)
  })

  it('caches by file identity so re-selection does not re-read', async () => {
    const path = join(library, '2026/01/unreviewed/scan_001.jpg')
    const first = await service.read(path)
    const second = await service.read(path)
    expect(second).toBe(first)
  })
})

describe('capture date resolution', () => {
  const base = { mtimeMs: 1_700_000_000_000, birthtimeMs: null }

  it('prefers the original capture date', () => {
    const result = resolveCaptureDate({ DateTimeOriginal: '2024:03:02 10:00:00' }, {
      ...base,
      zone: 'Europe/Berlin'
    })
    // No offset tag, so the file's zone is assumed: 10:00 CET == 09:00Z.
    expect(new Date(result.captureAt).toISOString()).toBe('2024-03-02T09:00:00.000Z')
    expect(result.captureSource).toBe('exif')
  })

  it('prefers the explicit offset tag over the local zone', () => {
    const result = resolveCaptureDate(
      { DateTimeOriginal: '2024:03:02 10:00:00', OffsetTimeOriginal: '+05:30' },
      { ...base, zone: 'Europe/Berlin' }
    )
    expect(new Date(result.captureAt).toISOString()).toBe('2024-03-02T04:30:00.000Z')
  })

  it('accepts a hyphenated EXIF date', () => {
    const result = resolveCaptureDate({ DateTimeOriginal: '2024-03-02 10:00:00' }, {
      ...base,
      zone: 'UTC'
    })
    expect(new Date(result.captureAt).toISOString()).toBe('2024-03-02T10:00:00.000Z')
  })

  it('rejects an impossible date instead of rolling it over', () => {
    const result = resolveCaptureDate({ DateTimeOriginal: '2024:02:31 10:00:00' }, {
      ...base,
      zone: 'UTC'
    })
    expect(result.captureSource).toBe('modified')
  })

  it('prefers mtime over birthtime for the no-metadata fallback', () => {
    // Copying off a card preserves mtime, while birthtime only records when the
    // file landed on this filesystem.
    const result = resolveCaptureDate({}, { mtimeMs: 2_000, birthtimeMs: 5_000, zone: 'UTC' })
    expect(result.captureAt).toBe(2_000)
    expect(result.captureSource).toBe('modified')
  })

  it('falls back to birthtime only when mtime is unusable', () => {
    const result = resolveCaptureDate({}, { mtimeMs: 0, birthtimeMs: 5_000, zone: 'UTC' })
    expect(result.captureAt).toBe(5_000)
    expect(result.captureSource).toBe('created')
  })

  it('reports no date at all rather than inventing one', () => {
    const result = resolveCaptureDate({}, { mtimeMs: 0, birthtimeMs: null, zone: 'UTC' })
    expect(result.captureAt).toBe(0)
    expect(result.captureSource).toBe('unknown')
  })
})

describe('format classification', () => {
  it('treats camera raw extensions as raw', () => {
    for (const ext of ['cr2', 'cr3', 'nef', 'arw', 'dng', 'raf', 'orf', 'rw2']) {
      expect(classifyExtension(ext)).toBe('raw')
    }
  })

  it('treats display formats as images', () => {
    for (const ext of ['jpg', 'jpeg', 'png', 'webp', 'heic', 'tif', 'tiff']) {
      expect(classifyExtension(ext)).toBe('image')
      expect(isRenderableImage('image')).toBe(true)
    }
  })

  it('does not treat sidecars or video as images', () => {
    expect(classifyExtension('xmp')).toBe('sidecar')
    expect(classifyExtension('mp4')).toBe('video')
    expect(isRenderableImage('video')).toBe(false)
  })
})

afterAll(async () => {
  if (library) await rm(library, { recursive: true, force: true })
})
