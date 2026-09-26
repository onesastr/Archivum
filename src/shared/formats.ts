import type { FileKind } from './contract'

export const RAW_EXTENSIONS = new Set([
  '3fr', 'arw', 'cr2', 'cr3', 'crw', 'dcr', 'dng', 'erf', 'fff', 'iiq', 'k25', 'kdc', 'mef',
  'mos', 'mrw', 'nef', 'nrw', 'orf', 'pef', 'raf', 'raw', 'rw2', 'rwl', 'sr2', 'srf', 'srw',
  'x3f'
])

export const IMAGE_EXTENSIONS = new Set([
  'jpg', 'jpeg', 'jpe', 'jfif', 'png', 'tif', 'tiff', 'webp', 'heic', 'heif', 'avif', 'gif',
  'bmp', 'jp2', 'j2k', 'jxl'
])

export const VIDEO_EXTENSIONS = new Set([
  'mp4', 'mov', 'm4v', 'avi', 'mkv', 'mts', 'm2ts', 'mpg', 'mpeg', 'webm', 'insv', 'r3d'
])

export const SIDECAR_EXTENSIONS = new Set(['xmp', 'aae', 'json', 'lrcat', 'lrk2', 'db', 'ini'])

export function extensionOf(name: string): string {
  const index = name.lastIndexOf('.')
  if (index <= 0) return ''
  return name.slice(index + 1).toLowerCase()
}

export function baseNameOf(path: string): string {
  const normalized = path.replace(/[\\/]+$/, '')
  const index = normalized.lastIndexOf('/')
  return index === -1 ? normalized : normalized.slice(index + 1)
}

export function dirNameOf(path: string): string {
  const normalized = path.replace(/[\\/]+$/, '')
  const index = normalized.lastIndexOf('/')
  if (index <= 0) return '/'
  return normalized.slice(0, index)
}

export function extWithoutDot(name: string): string {
  return name.startsWith('.') ? name.slice(1).toLowerCase() : name.toLowerCase()
}

export function classifyExtension(ext: string): FileKind {
  if (RAW_EXTENSIONS.has(ext)) return 'raw'
  if (IMAGE_EXTENSIONS.has(ext)) return 'image'
  if (VIDEO_EXTENSIONS.has(ext)) return 'video'
  if (SIDECAR_EXTENSIONS.has(ext)) return 'sidecar'
  return 'other'
}

export function classifyFileName(name: string): FileKind {
  return classifyExtension(extensionOf(name))
}

export function isRenderableImage(kind: FileKind): boolean {
  return kind === 'image' || kind === 'raw'
}

const DATE_IN_NAME =
  /(\d{4})[-_.]?(\d{2})[-_.]?(\d{2})[T _-]?(\d{2})?[-_.:]?(\d{2})?[-_.:]?(\d{2})?/

export function dateFromFileName(name: string): number | null {
  const match = DATE_IN_NAME.exec(name)
  if (!match) return null
  const [, year, month, day, hour, minute, second] = match
  const parsed = Date.parse(
    `${year}-${month}-${day}T${hour ?? '00'}:${minute ?? '00'}:${second ?? '00'}Z`
  )
  if (Number.isNaN(parsed)) return null
  const utc = new Date(parsed)
  if (utc.getUTCMonth() + 1 !== Number(month) || utc.getUTCDate() !== Number(day)) return null
  return parsed
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes)) return '—'
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB', 'PB']
  let value = bytes / 1024
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  const digits = value >= 100 ? 0 : value >= 10 ? 1 : 2
  return `${value.toFixed(digits)} ${units[unitIndex]}`
}

export function formatCount(value: number): string {
  return new Intl.NumberFormat().format(value)
}

export function formatDate(timestamp: number | null | undefined): string {
  if (timestamp == null || !Number.isFinite(timestamp)) return '—'
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(timestamp))
}

export function formatDateFolder(timestamp: number): string {
  const date = new Date(timestamp)
  const year = String(date.getUTCFullYear())
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${year}/${month}/${day}`
}

export function formatAperture(value: number | null | undefined): string {
  if (value == null) return '—'
  return `f/${value.toFixed(value >= 10 ? 1 : 2).replace(/\.0+$/, '')}`
}

export function formatShutter(value: number | null | undefined): string {
  if (value == null) return '—'
  if (value >= 1) return `${value.toFixed(1)}s`
  return `1/${Math.round(1 / value)}`
}

export function formatFocalLength(value: number | null | undefined): string {
  if (value == null) return '—'
  return `${Math.round(value)}mm`
}

export function formatDimensions(
  width: number | null | undefined,
  height: number | null | undefined
): string {
  if (width == null || height == null) return '—'
  return `${width} × ${height}`
}
