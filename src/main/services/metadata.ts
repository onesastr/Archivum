import { open, stat, type FileHandle } from 'node:fs/promises'
import exifr from 'exifr'
import sharp from 'sharp'
import type { CaptureSource, FileKind, FileMetadata, MetadataState, RawInfo } from '../../shared/contract'
import { classifyExtension, isRenderableImage } from '../../shared/formats'
import { describeIccProfile } from './icc'
import type { AssetIdentity } from './cache'

/**
 * EXIF, ICC and XMP segments sit in the first few tens of KB of a JPEG and near
 * the head of TIFF/ISO-BMFF containers, so a bounded window is enough. Reading a
 * window rather than the whole file matters: a 60 MB RAW on a NAS share should
 * not be pulled across the network to read its capture date.
 */
const EXIF_HEAD_BYTES = 512 * 1024
const EXIF_WIDE_BYTES = 8 * 1024 * 1024

const SHARP_CAPABLE: ReadonlySet<string> = new Set([
  'jpg',
  'jpeg',
  'jpe',
  'jfif',
  'png',
  'tif',
  'tiff',
  'webp',
  'heic',
  'heif',
  'avif',
  'gif',
  'bmp',
  'jp2',
  'j2k',
  'jxl'
])

export interface FileStat extends AssetIdentity {
  birthtimeMs: number | null
}

export function statIdentity(path: string): Promise<FileStat> {
  return stat(path).then((info) => ({
    path,
    sizeBytes: info.size,
    mtimeMs: info.mtimeMs,
    birthtimeMs: toMillis(info.birthtime)
  }))
}

/** `birthtime` is a Date on some platforms and a number on others. */
function toMillis(value: Date | number): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  const millis = value.getTime()
  return Number.isNaN(millis) ? null : millis
}

type LooseRecord = Record<string, unknown>

function text(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : null
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return null
}

function num(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value.replace(',', '.'))
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function first(...values: unknown[]): unknown {
  return values.find((value) => value !== undefined && value !== null)
}

function joinMakeModel(make: string | null, model: string | null): string | null {
  if (make && model) {
    if (model.toLowerCase().startsWith(make.toLowerCase())) return model
    return `${make} ${model}`
  }
  return model ?? make
}

const EXIF_DATE_PATTERN = /^(\d{4})[:-](\d{2})[:-](\d{2})[T ](\d{2}):(\d{2}):(\d{2})/
const OFFSET_PATTERN = /^([+-])(\d{2}):?(\d{2})$/

interface DateCandidate {
  value: string
  offset: string | null
}

const DATE_PREFERENCE: DateCandidate[] = [
  { value: 'DateTimeOriginal', offset: 'OffsetTimeOriginal' },
  { value: 'DateTimeDigitized', offset: 'OffsetTimeDigitized' },
  { value: 'CreateDate', offset: 'OffsetTime' },
  { value: 'ModifyDate', offset: null },
  { value: 'DateTime', offset: 'OffsetTime' }
]

/**
 * EXIF timestamps carry no timezone, so they are interpreted in `fallbacks.zone`
 * when the file has no offset tag. Getting this wrong silently misfiles photos.
 *
 * mtime is preferred over birthtime for the no-metadata case: copying a photo
 * off a card usually preserves mtime, whereas birthtime only records when the
 * file landed on this filesystem, so on Linux the two are the same value and on
 * macOS birthtime would just be a noisier copy of it.
 */
export function resolveCaptureDate(
  exif: LooseRecord,
  fallbacks: { mtimeMs: number; birthtimeMs: number | null; zone: string }
): { captureAt: number; captureSource: CaptureSource } {
  // XMP CreateDate is preferred: it is always written with a real UTC offset,
  // whereas EXIF dates are naive and have to be guessed against the local zone.
  const fromXmp = parseIsoDate(first(exif.XMPCreateDate, exif.DateCreated, exif.CreateDate_xmp))
  if (fromXmp !== null) return { captureAt: fromXmp, captureSource: 'exif' }

  for (const candidate of DATE_PREFERENCE) {
    const raw = exif[candidate.value]
    if (raw === undefined || raw === null) continue
    const parsed = parseExifDate(raw, exif[candidate.offset ?? ''] ?? null, fallbacks.zone)
    if (parsed !== null && isPlausibleDate(parsed, raw)) {
      return { captureAt: parsed, captureSource: 'exif' }
    }
  }

  if (fallbacks.mtimeMs > 0) {
    return { captureAt: fallbacks.mtimeMs, captureSource: 'modified' }
  }
  if (fallbacks.birthtimeMs !== null && fallbacks.birthtimeMs > 0) {
    return { captureAt: fallbacks.birthtimeMs, captureSource: 'created' }
  }
  return { captureAt: 0, captureSource: 'unknown' }
}

/**
 * Rejects readings that do not round-trip, e.g. "2024:02:31", which would
 * otherwise roll over into March rather than being treated as absent.
 */
function isPlausibleDate(parsed: number, raw: unknown): boolean {
  if (typeof raw !== 'string') return true
  const match = EXIF_DATE_PATTERN.exec(raw.trim())
  if (!match) return true
  const [, year, month, day] = match
  const date = new Date(parsed)
  return (
    date.getUTCFullYear() === Number(year) &&
    date.getUTCMonth() + 1 === Number(month) &&
    date.getUTCDate() === Number(day)
  )
}

function parseIsoDate(raw: unknown): number | null {  if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? null : raw.getTime()
  if (typeof raw !== 'string') return null
  const value = Date.parse(raw.trim())
  return Number.isNaN(value) ? null : value
}

function parseExifDate(raw: unknown, offset: unknown, zone: string): number | null {
  if (raw instanceof Date) {
    return Number.isNaN(raw.getTime()) ? null : raw.getTime()
  }
  if (typeof raw !== 'string') return null
  const match = EXIF_DATE_PATTERN.exec(raw.trim())
  if (!match) return null
  const [, year, month, day, hour, minute, second] = match
  const zonePart = typeof offset === 'string' ? offset.trim() : ''
  const offsetMatch = OFFSET_PATTERN.exec(zonePart)

  const wallClock = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second)
  )

  if (offsetMatch) {
    const [, sign, offsetHour, offsetMinute] = offsetMatch
    const zoneMinutes = (Number(offsetHour) * 60 + Number(offsetMinute)) * (sign === '-' ? -1 : 1)
    return wallClock - zoneMinutes * 60_000
  }

  return fromZone(wallClock, zone)
}

const zoneFormatters = new Map<string, Intl.DateTimeFormat>()

function formatterFor(zone: string): Intl.DateTimeFormat | null {
  const cached = zoneFormatters.get(zone)
  if (cached) return cached
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    })
    zoneFormatters.set(zone, formatter)
    return formatter
  } catch {
    return null
  }
}

/**
 * Converts a wall-clock reading into UTC using the zone's offset at that moment.
 * This keeps the result independent of the machine Archivum happens to run on,
 * which matters because libraries are indexed on one machine and reviewed on
 * another.
 */
function fromZone(wallClock: number, zone: string): number | null {
  const formatter = formatterFor(zone)
  if (formatter === null) return null

  // The offset depends on the instant, so probe with the wall clock treated as
  // UTC and correct once; near a DST boundary the second pass settles it.
  let candidate = wallClock
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const parts = formatter.formatToParts(new Date(candidate))
    const read = (type: Intl.DateTimeFormatPartTypes): number => {
      const part = parts.find((candidate) => candidate.type === type)
      return part ? Number(part.value) : Number.NaN
    }
    const rendered = Date.UTC(
      read('year'),
      read('month') - 1,
      read('day'),
      read('hour'),
      read('minute'),
      read('second')
    )
    if (Number.isNaN(rendered)) return null
    const next = wallClock - (rendered - candidate)
    if (next === candidate) break
    candidate = next
  }
  return candidate
}

function readGps(exif: LooseRecord): { latitude: number; longitude: number } | null {
  const latitude = num(exif.latitude)
  const longitude = num(exif.longitude)
  if (latitude === null || longitude === null) return null
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null
  if (latitude === 0 && longitude === 0) return null
  return { latitude, longitude }
}

async function parseExif(path: string, sizeBytes: number): Promise<LooseRecord> {
  // exifr's fs-backed read path is broken on current Node (`fh.stat(path)`
  // throws ERR_INVALID_ARG_TYPE and the handle is never closed), so metadata is
  // read from an explicitly bounded head window and parsed from the buffer.
  const head = Math.min(sizeBytes, EXIF_HEAD_BYTES)
  const buffer = await readHead(path, head)
  if (buffer === null) return {}

  let parsed = await parseExifBuffer(buffer)
  // TIFF/ISO-BMFF containers may place their IFDs further in; retry once with a
  // larger window before giving up rather than reporting "no metadata".
  if (isEmptyRecord(parsed) && sizeBytes > head) {
    const wider = await readHead(path, Math.min(sizeBytes, EXIF_WIDE_BYTES))
    if (wider !== null) parsed = await parseExifBuffer(wider)
  }
  return parsed
}

function isEmptyRecord(record: LooseRecord): boolean {
  for (const key in record) {
    if (record[key] !== undefined && record[key] !== null) return false
  }
  return true
}

async function parseExifBuffer(buffer: Buffer): Promise<LooseRecord> {
  try {
    const parsed = await exifr.parse(buffer, {
      tiff: true,
      exif: true,
      gps: true,
      xmp: true,
      icc: false,
      iptc: false,
      jfif: false,
      ihdr: true,
      translateKeys: true,
      translateValues: true,
      // EXIF timestamps are naive strings. Letting exifr revive them into Date
      // objects resolves them against the *machine's* zone, which silently
      // discards OffsetTimeOriginal and misfiles every photo taken outside the
      // current timezone. They are parsed by parseExifDate instead.
      reviveValues: false,
      mergeOutput: true
    })
    return (parsed ?? {}) as LooseRecord
  } catch {
    return {}
  }
}

async function readHead(path: string, bytes: number): Promise<Buffer | null> {
  let handle: FileHandle | undefined
  try {
    handle = await open(path, 'r')
    const buffer = Buffer.allocUnsafe(bytes)
    const { bytesRead } = await handle.read(buffer, 0, bytes, 0)
    return buffer.subarray(0, bytesRead)
  } catch {
    return null
  } finally {
    await handle?.close().catch(() => undefined)
  }
}

interface SharpFacts {
  width: number | null
  height: number | null
  orientation: number | null
  icc: Buffer | null
  bitsPerSample: number | null
  space: string | null
  density: number | null
}

async function readSharpFacts(path: string): Promise<SharpFacts | null> {
  try {
    const meta = await sharp(path, { limitInputPixels: 1_000_000_000 }).metadata()
    return {
      width: meta.width ?? null,
      height: meta.height ?? null,
      orientation: meta.orientation ?? null,
      icc: meta.icc ? Buffer.from(meta.icc) : null,
      bitsPerSample: typeof meta.depth === 'number' ? meta.depth * 8 : null,
      space: meta.space ?? null,
      density: meta.density ?? null
    }
  } catch {
    return null
  }
}

export class MetadataService {
  private readonly inflight = new Map<string, Promise<FileMetadata>>()
  private readonly recent = new Map<string, FileMetadata>()

  constructor(
    private readonly localZone: string = Intl.DateTimeFormat().resolvedOptions().timeZone,
    private readonly recentLimit = 512
  ) {}

  async read(path: string, kind?: FileKind, statResult?: FileStat): Promise<FileMetadata> {
    const existing = this.inflight.get(path)
    if (existing) return existing
    const task = this.readUncached(path, kind, statResult).finally(() => {
      this.inflight.delete(path)
    })
    this.inflight.set(path, task)
    return task
  }

  async readMany(paths: string[]): Promise<Map<string, FileMetadata>> {
    const results = await Promise.all(
      paths.map(async (path) => [path, await this.read(path)] as const)
    )
    return new Map(results)
  }

  private async readUncached(
    path: string,
    kindHint?: FileKind,
    statResult?: FileStat
  ): Promise<FileMetadata> {
    const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase()
    const kind = kindHint ?? classifyExtension(ext)
    const identity = statResult ?? (await statIdentity(path).catch(() => null))

    if (identity === null) {
      return emptyMetadata(path, 'error')
    }

    // Re-selecting a file or rescrolling the grid must not re-read it from a
    // network share, so results are keyed by the file's identity.
    const cacheKey = `${path}|${identity.sizeBytes}|${identity.mtimeMs}|${kind}`
    const cached = this.recent.get(cacheKey)
    if (cached) {
      this.recent.delete(cacheKey)
      this.recent.set(cacheKey, cached)
      return cached
    }

    const metadata = await this.extract(path, ext, kind, identity)
    this.recent.set(cacheKey, metadata)
    while (this.recent.size > this.recentLimit) {
      const oldest = this.recent.keys().next()
      if (oldest.done) break
      this.recent.delete(oldest.value)
    }
    return metadata
  }

  private async extract(
    path: string,
    ext: string,
    kind: FileKind,
    identity: FileStat
  ): Promise<FileMetadata> {
    const renderable = isRenderableImage(kind) || (kind === 'other' && SHARP_CAPABLE.has(ext))
    const canUseSharp = renderable && SHARP_CAPABLE.has(ext)

    const [exif, sharpFacts] = await Promise.all([
      parseExif(path, identity.sizeBytes),
      canUseSharp ? readSharpFacts(path) : Promise.resolve(null)
    ])

    const date = resolveCaptureDate(exif, {
      mtimeMs: identity.mtimeMs,
      birthtimeMs: identity.birthtimeMs,
      zone: this.localZone
    })

    const iccBuffer = sharpFacts?.icc ?? (Buffer.isBuffer(exif.icc) ? (exif.icc as Buffer) : null)
    const icc = describeIccProfile(iccBuffer)

    const width = sharpFacts?.width ?? num(first(exif.ExifImageWidth, exif.ImageWidth))
    const height = sharpFacts?.height ?? num(first(exif.ExifImageHeight, exif.ImageHeight))
    const bitsPerSample = num(exif.BitsPerSample) ?? sharpFacts?.bitsPerSample ?? null

    const raw: RawInfo | null =
      kind === 'raw'
        ? {
            format: ext.toUpperCase(),
            width,
            height,
            bitsPerSample,
            isRaw: true
          }
        : null

    const state: MetadataState = renderable || kind === 'sidecar' ? 'ready' : 'unsupported'

    return {
      path,
      state,
      width,
      height,
      orientation: sharpFacts?.orientation ?? num(exif.Orientation),
      bitsPerSample,
      cameraMake: text(exif.Make),
      cameraModel: text(exif.Model),
      camera: joinMakeModel(text(exif.Make), text(exif.Model)),
      lens: joinMakeModel(text(exif.LensMake), text(first(exif.LensModel, exif.Lens))),
      serial: text(first(exif.SerialNumber, exif.CameraSerialNumber, exif.BodySerialNumber)),
      iso: num(first(exif.ISO, exif.ISOSpeedRatings, exif.PhotographicSensitivity)),
      aperture: num(first(exif.FNumber, exif.ApertureValue, exif.Aperture)),
      shutter: shutterSeconds(exif),
      focalLength: num(exif.FocalLength),
      focalLength35: num(exif.FocalLengthIn35mmFormat),
      captureAt: date.captureAt,
      captureSource: date.captureSource,
      gps: readGps(exif),
      icc: icc ?? (sharpFacts?.space ? spaceFallback(sharpFacts.space) : null),
      raw,
      extra: {
        ...(text(exif.Artist) ? { artist: text(exif.Artist) as string } : {}),
        ...(text(exif.Copyright) ? { copyright: text(exif.Copyright) as string } : {}),
        ...(text(exif.Software) ? { software: text(exif.Software) as string } : {}),
        ...(sharpFacts?.space ? { colorSpace: sharpFacts.space } : {})
      }
    }
  }
}

function shutterSeconds(exif: LooseRecord): number | null {
  const direct = num(first(exif.ExposureTime, exif.ShutterSpeedValue))
  if (direct === null) return null
  if (direct > 0) return direct
  const apex = num(first(exif.ShutterSpeedValue))
  if (apex !== null) return Math.pow(2, -apex)
  return null
}

function spaceFallback(space: string): FileMetadata['icc'] {
  return {
    name: space,
    colorSpace: space.toUpperCase(),
    isSrgb: space.toLowerCase() === 'srgb',
    sizeBytes: 0
  }
}

export function emptyMetadata(path: string, state: MetadataState): FileMetadata {
  return {
    path,
    state,
    width: null,
    height: null,
    orientation: null,
    bitsPerSample: null,
    cameraMake: null,
    cameraModel: null,
    camera: null,
    lens: null,
    serial: null,
    iso: null,
    aperture: null,
    shutter: null,
    focalLength: null,
    focalLength35: null,
    captureAt: null,
    captureSource: 'unknown',
    gps: null,
    icc: null,
    raw: null,
    extra: {}
  }
}
