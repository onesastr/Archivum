#!/usr/bin/env node
/**
 * Generates a deterministic photo library for exercising the index, metadata and
 * colour pipelines. EXIF is hand-built because ImageMagick's `-set exif:` is a
 * no-op on this build, and real camera files are not available in CI.
 *
 *   node scripts/make-fixtures.mjs [targetDir]
 */
import { execFile } from 'node:child_process'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

const ICC_A98 = '/usr/share/ghostscript/iccprofiles/a98.icc'
const ICC_SRGB = '/usr/share/ghostscript/iccprofiles/srgb.icc'

const TYPE_BYTE = 1
const TYPE_ASCII = 2
const TYPE_SHORT = 3
const TYPE_LONG = 4
const TYPE_RATIONAL = 5

const TYPE_SIZES = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8 }

class IfdBuilder {
  constructor() {
    this.entries = []
  }

  add(tag, type, values, count = values.length) {
    this.entries.push({ tag, type, values, count })
    return this
  }

  /** ASCII values occupy a NUL-terminated buffer whose length is the IFD count. */
  ascii(tag, value) {
    const buffer = Buffer.from(`${value}\0`, 'latin1')
    return this.add(tag, TYPE_ASCII, [buffer], buffer.length)
  }

  short(tag, value) {
    return this.add(tag, TYPE_SHORT, [value])
  }

  long(tag, value) {
    return this.add(tag, TYPE_LONG, [value])
  }

  set(tag, value) {
    const entry = this.entries.find((candidate) => candidate.tag === tag)
    if (!entry) throw new Error(`no entry for tag 0x${tag.toString(16)}`)
    entry.values = [value]
    return this
  }

  rational(tag, numerator, denominator = 1) {
    return this.add(tag, TYPE_RATIONAL, [[numerator, denominator]])
  }

  rationalTriple(tag, values) {
    return this.add(tag, TYPE_RATIONAL, values)
  }
}

/**
 * Serialises a TIFF block: 8-byte header, IFD0, then the EXIF and GPS sub-IFDs,
 * with all overflow data appended after the directories.
 */
function buildTiff(ifd0, exifIfd, gpsIfd) {
  // The sub-IFD pointers are real IFD0 entries, so they must be added before
  // any offset is derived from IFD0's length.
  ifd0.long(0x8769, 0)
  ifd0.long(0x8825, 0)

  const ifd0Size = 2 + ifd0.entries.length * 12 + 4
  const exifIfdOffset = 8 + ifd0Size
  const exifIfdSize = exifIfd ? 2 + exifIfd.entries.length * 12 + 4 : 0
  const gpsIfdOffset = exifIfdOffset + exifIfdSize
  const gpsIfdSize = gpsIfd ? 2 + gpsIfd.entries.length * 12 + 4 : 0
  const heapStart = gpsIfdOffset + gpsIfdSize

  ifd0.set(0x8769, exifIfd ? exifIfdOffset : 0)
  ifd0.set(0x8825, gpsIfd ? gpsIfdOffset : 0)

  const heap = []
  let heapOffset = heapStart

  // TIFF requires entries in ascending tag order; readers are entitled to rely
  // on it, so sort defensively rather than trusting insertion order.
  const serialize = (builder) => {
    const entries = [...builder.entries].sort((a, b) => a.tag - b.tag)
    const directory = Buffer.alloc(2 + entries.length * 12 + 4)
    directory.writeUInt16LE(entries.length, 0)
    let cursor = 2
    for (const entry of entries) {
      directory.writeUInt16LE(entry.tag, cursor)
      directory.writeUInt16LE(entry.type, cursor + 2)
      const size = TYPE_SIZES[entry.type] * entry.count
      directory.writeUInt32LE(entry.count, cursor + 4)
      if (size <= 4) {
        writeValues(directory, cursor + 8, entry)
      } else {
        directory.writeUInt32LE(heapOffset, cursor + 8)
        // Heap values start on even offsets, so odd-length values carry a pad
        // byte that must be part of the emitted bytes, not just the offsets.
        const padded = size % 2 === 0 ? size : size + 1
        const chunk = Buffer.alloc(padded)
        writeValues(chunk, 0, entry)
        heap.push(chunk)
        heapOffset += padded
      }
      cursor += 12
    }
    directory.writeUInt32LE(0, cursor)
    return directory
  }
  const ifd0Buffer = serialize(ifd0)
  const exifBuffer = exifIfd ? serialize(exifIfd) : Buffer.alloc(0)
  const gpsBuffer = gpsIfd ? serialize(gpsIfd) : Buffer.alloc(0)

  const header = Buffer.alloc(8)
  header.write('II', 0, 'latin1')
  header.writeUInt16LE(0x2a, 2)
  header.writeUInt32LE(8, 4)

  return Buffer.concat([header, ifd0Buffer, exifBuffer, gpsBuffer, ...heap])
}

function writeValues(target, offset, entry) {
  let cursor = offset
  for (const value of entry.values) {
    if (Buffer.isBuffer(value)) {
      value.copy(target, cursor)
      cursor += value.length
      continue
    }
    if (Array.isArray(value)) {
      target.writeUInt32LE(value[0], cursor)
      target.writeUInt32LE(value[1], cursor + 4)
      cursor += 8
      continue
    }
    if (entry.type === TYPE_SHORT) {
      target.writeUInt16LE(value, cursor)
      cursor += 2
      continue
    }
    if (entry.type === TYPE_LONG) {
      target.writeUInt32LE(value, cursor)
      cursor += 4
      continue
    }
    target.writeUInt8(value, cursor)
    cursor += 1
  }
  return target.subarray(offset, cursor)
}

function gpsRationals(degrees, minutes, seconds) {
  return [
    [Math.round(degrees * 1e6), 1e6],
    [Math.round(minutes * 1e6), 1e6],
    [Math.round(seconds * 1e4), 1e4]
  ]
}

function exifApp1(spec) {
  const ifd0 = new IfdBuilder()
  ifd0.ascii(0x010f, spec.make)
  ifd0.ascii(0x0110, spec.model)
  ifd0.short(0x0112, spec.orientation ?? 1)
  ifd0.ascii(0x0131, 'Archivum Fixtures 1.0')

  const exif = new IfdBuilder()
  exif.rational(0x829a, spec.exposureNumerator, spec.exposureDenominator ?? 1)
  exif.rational(0x829d, spec.fnumNumerator ?? 28, spec.fnumDenominator ?? 10)
  exif.short(0x8827, spec.iso)
  exif.ascii(0x9003, spec.dateTimeOriginal)
  exif.ascii(0x9004, spec.dateTimeOriginal)
  if (spec.offsetTimeOriginal) {
    exif.ascii(0x9011, spec.offsetTimeOriginal)
    exif.ascii(0x9010, spec.offsetTimeOriginal)
  }
  exif.rational(0x920a, spec.focalNumerator, spec.focalDenominator ?? 1)
  exif.long(0xa002, spec.width)
  exif.long(0xa003, spec.height)
  if (spec.lens) exif.ascii(0xa434, spec.lens)
  if (spec.bodySerial) exif.ascii(0xa431, spec.bodySerial)

  const gps = spec.gps ? new IfdBuilder() : null
  if (gps) {
    gps.ascii(0x0001, spec.gps.lat[0] >= 0 ? 'N' : 'S')
    gps.rationalTriple(0x0002, gpsRationals(...spec.gps.lat))
    gps.ascii(0x0003, spec.gps.lon[0] >= 0 ? 'E' : 'W')
    gps.rationalTriple(0x0004, gpsRationals(...spec.gps.lon))
    gps.add(0x0005, TYPE_BYTE, [0])
    gps.rational(0x0006, Math.round(spec.gps.alt * 100), 100)
  }

  const tiff = buildTiff(ifd0, exif, gps)
  const payload = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff])
  const header = Buffer.alloc(4)
  header.writeUInt16BE(0xffe1, 0)
  header.writeUInt16BE(payload.length + 2, 2)
  return Buffer.concat([header, payload])
}

/** Inserts APP segments directly after the SOI marker. */
function spliceSegments(jpeg, segments) {
  if (jpeg.readUInt16BE(0) !== 0xffd8) throw new Error('not a JPEG')
  return Buffer.concat([jpeg.subarray(0, 2), ...segments, jpeg.subarray(2)])
}

async function baseImage({ width, height, from, to, icc, format = 'jpg' }) {
  const args = [
    '-size',
    `${width}x${height}`,
    `gradient:${from}-${to}`,
    ...(icc ? ['-profile', icc] : []),
    `${format}:-`
  ]
  const { stdout } = await run('magick', args, { encoding: 'buffer', maxBuffer: 256 * 1024 * 1024 })
  return stdout
}

const FIXTURES = [
  {
    file: '2025/12/25/IMG_4821.CR2.jpg',
    width: 1800,
    height: 1200,
    from: '#d94f2b',
    to: '#1d3f8f',
    icc: ICC_A98,
    exif: {
      make: 'Canon',
      model: 'Canon EOS R5',
      orientation: 1,
      exposureNumerator: 1,
      exposureDenominator: 250,
      fnumNumerator: 28,
      fnumDenominator: 10,
      iso: 400,
      dateTimeOriginal: '2025:12:25 14:33:21',
      offsetTimeOriginal: '+01:00',
      focalNumerator: 35,
      lens: 'RF35mm F1.8 MACRO IS STM',
      bodySerial: '042051000537',
      width: 1800,
      height: 1200,
      gps: { lat: [48, 51, 29.6], lon: [2, 17, 40.2], alt: 35.4 }
    }
  },
  {
    file: '2025/12/25/IMG_4822.CR2.jpg',
    width: 1600,
    height: 1067,
    from: '#2b8f4d',
    to: '#0d1b2a',
    icc: ICC_SRGB,
    exif: {
      make: 'Canon',
      model: 'Canon EOS R5',
      orientation: 6,
      exposureNumerator: 1,
      exposureDenominator: 60,
      fnumNumerator: 40,
      fnumDenominator: 10,
      iso: 1600,
      dateTimeOriginal: '2025:12:25 14:34:02',
      offsetTimeOriginal: '+01:00',
      focalNumerator: 85,
      lens: 'RF85mm F2 Macro IS STM',
      width: 1600,
      height: 1067
    }
  },
  {
    file: '2025/12/26/loose/DSC_0091.jpg',
    width: 1400,
    height: 933,
    from: '#f2c14e',
    to: '#3d2b1f',
    icc: ICC_SRGB,
    exif: {
      make: 'NIKON CORPORATION',
      model: 'NIKON Z 8',
      exposureNumerator: 1,
      exposureDenominator: 400,
      fnumNumerator: 18,
      fnumDenominator: 10,
      iso: 100,
      dateTimeOriginal: '2025:12:26 09:07:44',
      offsetTimeOriginal: '+01:00',
      focalNumerator: 24,
      lens: 'NIKKOR Z 24mm f/1.8 S',
      width: 1400,
      height: 933
    }
  },
  {
    file: '2025/12/26/loose/20191231-235959_nikon.jpg',
    width: 1200,
    height: 800,
    from: '#6a4c93',
    to: '#102a43',
    icc: null,
    exif: null
  },
  {
    file: '2025/12/26/loose/no-metadata-at-all.png',
    width: 1000,
    height: 1000,
    from: '#118ab2',
    to: '#073b4c',
    icc: null,
    exif: null,
    format: 'png'
  },
  {
    file: '2025/12/27/portrait_4823.jpg',
    width: 1200,
    height: 1800,
    from: '#ef476f',
    to: '#1b1b3a',
    icc: ICC_A98,
    exif: {
      make: 'SONY',
      model: 'ILCE-7RM5',
      orientation: 1,
      exposureNumerator: 1,
      exposureDenominator: 200,
      fnumNumerator: 18,
      fnumDenominator: 10,
      iso: 320,
      dateTimeOriginal: '2025:12:27 18:22:10',
      offsetTimeOriginal: '+01:00',
      focalNumerator: 50,
      lens: 'FE 50mm F1.2 GM',
      width: 1200,
      height: 1800
    }
  }
]

async function main() {
  const target = process.argv[2] ?? join(process.cwd(), 'fixtures', 'library')
  await rm(target, { recursive: true, force: true })

  for (const spec of FIXTURES) {
    const base = await baseImage(spec)
    const segments = []
    if (spec.exif) segments.push(exifApp1(spec.exif))

    const isPng = spec.file.endsWith('.png')
    const payload = isPng ? base : spliceSegments(base, segments)
    const full = join(target, spec.file)
    await mkdir(dirname(full), { recursive: true })
    await writeFile(full, payload)
    console.log(`  ${spec.file}  ${(payload.length / 1024).toFixed(0)} KB`)
  }

  // A folder of files with no EXIF at all, to exercise the date-fallback review path.
  const empty = join(target, '2026', '01', 'unreviewed')
  await mkdir(empty, { recursive: true })
  for (let index = 0; index < 5; index += 1) {
    const image = await baseImage({
      width: 640,
      height: 480,
      from: '#8d99ae',
      to: '#2b2d42',
      icc: null
    })
    await writeFile(join(empty, `scan_${String(index + 1).padStart(3, '0')}.jpg`), image)
  }

  const srgb = await readFile(ICC_SRGB).catch(() => null)
  console.log(`\nLibrary written to ${target}`)
  console.log(`sRGB profile available for colour tests: ${srgb ? 'yes' : 'no'}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
