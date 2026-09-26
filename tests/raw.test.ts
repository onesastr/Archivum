import { describe, expect, it } from 'vitest'
import { parseIdentify } from '../src/main/services/raw'

/**
 * Captured verbatim from `raw-identify -v` against a Canon EOS 40D CR2. The
 * labels LibRaw actually prints are the contract here: an earlier parser looked
 * for a "LibRaw" banner and "Camera make"/"Camera model" labels that this tool
 * never emits, so identify() silently returned null for every RAW file.
 */
const CANON_CIDENTIFY = `Filename: _MG_0154.CR2
Timestamp: Mon Dec 18 20:05:21 2017
Camera: Canon EOS 40D ID: 0x80000190
Normalized Make/Model: =Canon/EOS 40D= CamMaker ID: 8
Body#: 1430709769
EXIF:
	CurFocal: 38.0 mm
	CurAp: f/8.0
Makernotes:
	Lens: EF-S 17-85mm f/4-5.6 IS USM
Number of raw images: 1
Thumb size:  1936 x 1288
Full size:   1944 x 1296
Raw inset, width x height: 1936 x 1288 left: 4 top: 3
Image size:  1944 x 1296
Output size: 1944 x 1296
Image flip: 0
Raw colors: 3
`

const NIKON_IDENTIFY = `Filename: small.NEF
Camera: Nikon D5600 ID: 0x0
Normalized Make/Model: =NIKON/NIKON D5600= CamMaker ID: 78
Full size:   6016 x 4016
Image size:  6016 x 4016
Output size: 6016 x 4016
Raw colors: 3
`

describe('parseIdentify', () => {
  it('reads dimensions, colour count and camera identity', () => {
    const info = parseIdentify(CANON_CIDENTIFY)

    expect(info).not.toBeNull()
    expect(info?.make).toBe('Canon')
    expect(info?.model).toBe('EOS 40D')
    expect(info?.rawWidth).toBe(1944)
    expect(info?.rawHeight).toBe(1296)
    expect(info?.outputWidth).toBe(1944)
    expect(info?.outputHeight).toBe(1296)
    expect(info?.colors).toBe(3)
    expect(info?.isRaw).toBe(true)
  })

  it('prefers the normalized make/model pair over the combined camera line', () => {
    const info = parseIdentify(NIKON_IDENTIFY)

    expect(info?.make).toBe('NIKON')
    expect(info?.model).toBe('NIKON D5600')
    expect(info?.outputWidth).toBe(6016)
    expect(info?.outputHeight).toBe(4016)
  })

  it('rejects output that did not come from raw-identify', () => {
    // dcraw_emu has no identify mode; it reports the bad flag and then goes on to
    // demosaic the file. That text must not be mistaken for a successful probe.
    expect(parseIdentify('Unknown option "-i".\nProcessing file IMG.CR2')).toBeNull()
    expect(parseIdentify('')).toBeNull()
    expect(parseIdentify('some unrelated output\n')).toBeNull()
  })

  it('tolerates a truncated probe without inventing values', () => {
    const info = parseIdentify('Camera: Canon EOS 40D ID: 0x1\nNormalized Make/Model: =Canon/EOS 40D=')

    expect(info?.make).toBe('Canon')
    expect(info?.model).toBe('EOS 40D')
    expect(info?.rawWidth).toBeNull()
    expect(info?.outputHeight).toBeNull()
  })
})
