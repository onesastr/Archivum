import type { IccInfo } from '../../shared/contract'

const ICC_SIGNATURE = 0x61637370
const TAG_DESCRIPTION = 0x64657363
const TAG_MULTI_LOCALIZED_UNICODE = 0x6d6c7563
const TAG_COPYRIGHT = 0x63707274
const TAG_RED_COLORANT = 0x7258595a
const TAG_GREEN_COLORANT = 0x6758595a
const TAG_BLUE_COLORANT = 0x6258595a

const SRGB_PATTERN = /(^|[^a-z0-9])s\s?rgb|iec61966-2\.1/

/** D65-adapted sRGB primaries, as written by ICC profile generators. */
const SRGB_COLORANTS: readonly (readonly [number, number, number])[] = [
  [0.436, 0.2225, 0.0139],
  [0.3851, 0.7169, 0.0971],
  [0.1431, 0.0606, 0.7141]
]

const COLORANT_TOLERANCE = 0.012

const COLOR_SPACE_LABELS: Record<string, string> = {
  'RGB ': 'RGB',
  GRAY: 'Grayscale',
  CMYK: 'CMYK',
  Lab: 'Lab',
  XYZ: 'XYZ',
  Luv: 'Luv',
  YCbr: 'YCbCr',
  HSV: 'HSV',
  HLS: 'HLS',
  CMY: 'CMY',
  '2CLR': 'Duotone',
  '3CLR': 'Trichromatic',
  '4CLR': 'Quadrichromatic',
  '5CLR': 'Multichromatic',
  '6CLR': 'Multichromatic',
  '7CLR': 'Multichromatic',
  '8CLR': 'Multichromatic',
  '9CLR': 'Multichromatic',
  'ACLR': 'Multichromatic',
  'BCLR': 'Multichromatic',
  'CCLR': 'Multichromatic',
  'DCLR': 'Multichromatic',
  'ECLR': 'Multichromatic',
  'FCLR': 'Multichromatic'
}

function readTagSignature(view: DataView, offset: number): string {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3)
  )
}

function readAscii(view: DataView, offset: number, length: number): string {
  let result = ''
  const end = Math.min(offset + length, view.byteLength)
  for (let index = offset; index < end; index += 1) {
    const code = view.getUint8(index)
    if (code === 0) break
    result += String.fromCharCode(code)
  }
  return result
}

function readUtf16Be(view: DataView, offset: number, length: number): string {
  let result = ''
  const characters = Math.floor(length / 2)
  const end = Math.min(offset + characters * 2, view.byteLength)
  for (let index = offset; index < end; index += 2) {
    result += String.fromCharCode(view.getUint16(index))
  }
  return result.replace(/\u0000+$/, '')
}

function readTextDescription(view: DataView, tagOffset: number): string | null {
  const type = readTagSignature(view, tagOffset)
  if (type === 'desc') {
    const asciiLength = view.getUint32(tagOffset + 8)
    if (asciiLength > 0) return readAscii(view, tagOffset + 12, asciiLength)
    const unicodeLength = view.getUint32(tagOffset + 12 + 67)
    if (unicodeLength > 0) return readUtf16Be(view, tagOffset + 12 + 78, unicodeLength)
    return null
  }
  if (type === 'text') {
    return readAscii(view, tagOffset + 8, view.getUint32(tagOffset + 8))
  }
  return null
}

function readMultiLocalizedUnicode(view: DataView, tagOffset: number): string | null {
  const recordCount = view.getUint32(tagOffset + 8)
  if (recordCount === 0) return null
  const recordSize = view.getUint32(tagOffset + 12)
  let fallback: string | null = null
  for (let index = 0; index < recordCount; index += 1) {
    const recordOffset = tagOffset + 16 + index * recordSize
    if (recordOffset + 12 > view.byteLength) break
    const language = readTagSignature(view, recordOffset)
    const length = view.getUint32(recordOffset + 4)
    const offset = tagOffset + view.getUint32(recordOffset + 8)
    if (length === 0) continue
    const value = readUtf16Be(view, offset, length)
    if (value.length === 0) continue
    if (language === 'enUS') return value
    fallback ??= value
  }
  return fallback
}

/** Reads an `XYZ ` tag as normalised XYZ triples. */
function readXyzTag(view: DataView, tagOffset: number): [number, number, number] | null {
  if (readTagSignature(view, tagOffset) !== 'XYZ ') return null
  return [
    view.getInt32(tagOffset + 8) / 65536,
    view.getInt32(tagOffset + 12) / 65536,
    view.getInt32(tagOffset + 16) / 65536
  ]
}

/**
 * Identifies sRGB structurally, by comparing the profile's RGB-to-XYZ
 * colorant matrix against the sRGB primaries. Description strings are not
 * reliable — vendors ship profiles named "Artifex sRGB ICC Profile",
 * "Compatible sRGB" or nothing at all — and a wrong answer here means colours
 * are either needlessly converted or silently left unconverted.
 */
function colorantsMatchSrgb(red: TagValue | null, green: TagValue | null, blue: TagValue | null): boolean {
  if (!red || !green || !blue) return false
  const actual: Array<[number, number, number] | null> = [red, green, blue].map((value) =>
    readXyzTag(value.view, value.offset)
  )
  for (let index = 0; index < 3; index += 1) {
    const measured = actual[index]
    const expected = SRGB_COLORANTS[index]
    if (measured === null) return false
    for (let axis = 0; axis < 3; axis += 1) {
      if (Math.abs(measured[axis] - expected[axis]) > COLORANT_TOLERANCE) return false
    }
  }
  return true
}

interface TagValue {
  view: DataView
  offset: number
}

export function describeIccProfile(buffer: Buffer | Uint8Array | null | undefined): IccInfo | null {
  if (!buffer) return null
  const bytes = buffer instanceof Buffer ? buffer : Buffer.from(buffer)
  if (bytes.length < 132) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (view.getUint32(36) !== ICC_SIGNATURE) return null

  const colorSpaceRaw = readTagSignature(view, 16).replace(/\u0000/g, ' ').trim()
  const colorSpace = COLOR_SPACE_LABELS[colorSpaceRaw] ?? (colorSpaceRaw || 'Unknown')

  const tagCount = view.getUint32(128)
  let name: string | null = null
  let copyright: string | null = null
  let red: TagValue | null = null
  let green: TagValue | null = null
  let blue: TagValue | null = null

  for (let index = 0; index < Math.min(tagCount, 512); index += 1) {
    const entryOffset = 132 + index * 12
    if (entryOffset + 12 > view.byteLength) break
    const signature = view.getUint32(entryOffset)
    const offset = view.getUint32(entryOffset + 4)
    const size = view.getUint32(entryOffset + 8)
    if (offset + 4 > view.byteLength || size === 0) continue
    if (signature === TAG_DESCRIPTION) {
      name = readMultiLocalizedUnicode(view, offset) ?? readTextDescription(view, offset)
    } else if (signature === TAG_MULTI_LOCALIZED_UNICODE && name === null) {
      name = readMultiLocalizedUnicode(view, offset)
    } else if (signature === TAG_COPYRIGHT && copyright === null) {
      copyright = readMultiLocalizedUnicode(view, offset) ?? readTextDescription(view, offset)
    } else if (signature === TAG_RED_COLORANT) {
      red = { view, offset }
    } else if (signature === TAG_GREEN_COLORANT) {
      green = { view, offset }
    } else if (signature === TAG_BLUE_COLORANT) {
      blue = { view, offset }
    }
  }

  const resolved = (name ?? copyright ?? '').trim()
  const hasColorants = red !== null || green !== null || blue !== null
  const isSrgb = hasColorants
    ? colorantsMatchSrgb(red, green, blue)
    : SRGB_PATTERN.test(resolved.toLowerCase())

  return {
    name: resolved.length > 0 ? resolved : null,
    colorSpace,
    isSrgb,
    sizeBytes: bytes.length
  }
}

export function iccFromMetadata(metadata: { icc?: Buffer }): IccInfo | null {
  return describeIccProfile(metadata.icc)
}
