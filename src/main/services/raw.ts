import { execFile } from 'node:child_process'
import { access, constants, readdir } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

/**
 * LibRaw's CLI tools are spawned rather than linked as a native addon: they cover
 * every camera LibRaw supports with no Electron ABI rebuild on version bumps, and
 * per-arch binaries let one package ship a universal macOS build.
 */
export interface LibRawBinary {
  name: string
  path: string
}

export interface RawAdjustments {
  userMul?: [number, number, number]
  exposure?: number
  noAutoBright?: boolean
  halfSize?: boolean
}

export interface LibRawInfo {
  rawWidth: number | null
  rawHeight: number | null
  outputWidth: number | null
  outputHeight: number | null
  bitsPerSample: number | null
  colors: number
  isRaw: boolean
  make: string | null
  model: string | null
}

export class LibRawUnavailableError extends Error {
  constructor() {
    super('LibRaw binaries are not bundled with this build')
    this.name = 'LibRawUnavailableError'
  }
}

export class RawDecoder {
  private binaries: Map<string, string> | null = null
  private available: boolean | null = null

  constructor(private readonly resolveResourceRoot: () => string) {}

  private async locate(): Promise<Map<string, string>> {
    if (this.binaries) return this.binaries
    const found = new Map<string, string>()
    const roots = this.resolveResourceRoot() ? [this.resolveResourceRoot()] : []
    // A checkout keeps one binary per platform under
    // resources/libraw/<os>-<arch>/, while a packaged build flattens the matching
    // directory into <app>/resources/libraw through extraResources. Both layouts
    // are searched so `npm run dev` and a packaged AppImage resolve the same way.
    const bases = [
      ...roots.map((root) => join(root, 'resources', 'libraw')),
      // Packaged: <app>/resources/libraw, which is process.resourcesPath itself.
      ...(process.resourcesPath ? [join(process.resourcesPath, 'libraw')] : []),
      join(process.cwd(), 'resources', 'libraw')
    ]
    const target = `${process.platform}-${process.arch}`
    for (const base of bases) {
      let entries: string[]
      try {
        entries = await readdir(base)
      } catch {
        continue
      }
      // Prefer the binary built for this platform, then any other one, then a
      // binary sitting directly in the base directory.
      const subdirectories = entries
        .filter((entry) => entry !== 'README.md')
        .map((entry) => join(base, entry))
      const ordered = [
        ...subdirectories.filter((dir) => basename(dir) === target),
        ...subdirectories.filter((dir) => basename(dir) !== target),
        base
      ]
      for (const dir of ordered) {
        if (found.size > 0) break
        const candidates = dir === base ? entries : await readdir(dir).catch(() => [])
        for (const entry of candidates) {
          if (entry === 'dcraw_emu' || entry === 'raw-identify') found.set(entry, join(dir, entry))
        }
      }
      if (found.size > 0) break
    }
    this.binaries = found
    return found
  }

  async dcrawEmu(): Promise<string> {
    const binaries = await this.locate()
    const found = binaries.get('dcraw_emu')
    if (!found) throw new LibRawUnavailableError()
    await access(found, constants.X_OK).catch(async () => {
      const { chmod } = await import('node:fs/promises')
      await chmod(found, 0o755)
    })
    return found
  }

  async canDecode(path: string): Promise<boolean> {
    if ((await this.locate()).size === 0) return false
    const info = await this.identify(path)
    return info !== null
  }

  async isAvailable(): Promise<boolean> {
    if (this.available !== null) return this.available
    try {
      await this.dcrawEmu()
      this.available = true
    } catch {
      this.available = false
    }
    return this.available
  }

  /**
   * Reads dimensions and camera identity without demosaicing, via raw-identify.
   * dcraw_emu cannot do this: it has no identify mode and would instead demosaic
   * the file and drop a full-size image next to the original.
   */
  async identify(path: string): Promise<LibRawInfo | null> {
    let binary: string
    try {
      binary = await this.locate().then((binaries) => {
        const found = binaries.get('raw-identify')
        if (!found) throw new LibRawUnavailableError()
        return found
      })
    } catch {
      return null
    }
    try {
      const { stdout } = await run(binary, ['-v', path], {
        encoding: 'utf8',
        maxBuffer: 8 * 1024 * 1024,
        timeout: 60_000
      })
      return parseIdentify(stdout)
    } catch (error) {
      if (error instanceof Error && 'stdout' in error) {
        const stdout = String((error as { stdout?: unknown }).stdout ?? '')
        if (stdout.length > 0) return parseIdentify(stdout)
      }
      return null
    }
  }

  /**
   * Full-size demosaic to a TIFF buffer.
   *
   * `-T` selects TIFF and `-Z -` writes to stdout, so nothing is ever written
   * next to the user's original: passing only `-Z <path>` produces a PPM wearing
   * a .tiff extension, which nothing downstream can decode.
   */
  async decodeToTiff(path: string, adjustments: RawAdjustments = {}): Promise<Buffer> {
    const binary = await this.dcrawEmu()
    const args = ['-T', '-Z', '-']
    if (adjustments.userMul) args.push('-u', adjustments.userMul.join(' '))
    if (adjustments.exposure !== undefined) args.push('-E', String(adjustments.exposure))
    if (adjustments.noAutoBright) args.push('-W')
    if (adjustments.halfSize) args.push('-h')
    args.push(path)

    // A full-size 16-bit TIFF of a modern sensor runs to tens of megabytes.
    const { stdout } = await run(binary, args, {
      encoding: 'buffer',
      maxBuffer: 512 * 1024 * 1024,
      timeout: 300_000
    })
    return stdout
  }

  /** Demosaiced pixels as a TIFF buffer, at half size when asked for thumbnails. */
  async decodeToBuffer(path: string, adjustments: RawAdjustments = {}): Promise<Buffer | null> {
    try {
      return await this.decodeToTiff(path, adjustments)
    } catch {
      return null
    }
  }
}

/**
 * Parses `raw-identify -v` output. The labels below are the ones LibRaw actually
 * prints; a guard on a "LibRaw" banner was removed because raw-identify never
 * emits one, which made every parse fail and identify() return null.
 */
export function parseIdentify(stdout: string): LibRawInfo | null {
  if (!stdout.includes('Normalized Make/Model')) return null
  const info: LibRawInfo = {
    rawWidth: null,
    rawHeight: null,
    outputWidth: null,
    outputHeight: null,
    bitsPerSample: null,
    colors: 3,
    isRaw: true,
    make: null,
    model: null
  }
  for (const rawLine of stdout.split('\n')) {
    const line = rawLine.trim()
    const colon = line.indexOf(':')
    if (colon === -1) continue
    const label = line.slice(0, colon).trim()
    const value = line.slice(colon + 1).trim()

    // "Camera: Canon EOS 40D ID: 0x80000190"
    if (label === 'Camera') {
      const camera = value.replace(/\s+ID:.*$/, '').trim()
      if (camera) {
        info.make = camera
        info.model = camera
      }
      continue
    }
    // "Normalized Make/Model: =Canon/EOS 40D= CamMaker ID: 8" splits the two
    // halves on a slash, which is the authoritative make/model pair.
    if (label === 'Normalized Make/Model') {
      const normalized = /=\s*([^/]+)\/([^=]+?)=/.exec(value)
      if (normalized) {
        info.make = normalized[1].trim() || info.make
        info.model = normalized[2].replace(/\s+CamMaker ID:.*$/, '').trim() || info.model
      }
      continue
    }

    const size = /(\d+)\s*x\s*(\d+)/.exec(value)
    switch (label) {
      case 'Full size':
        info.rawWidth = size ? Number(size[1]) : null
        info.rawHeight = size ? Number(size[2]) : null
        break
      case 'Image size':
      case 'Output size':
        info.outputWidth = size ? Number(size[1]) : null
        info.outputHeight = size ? Number(size[2]) : null
        break
      case 'Raw colors':
        info.colors = Number.parseInt(value, 10) || 3
        break
      case 'Bits per sample':
        info.bitsPerSample = Number.parseInt(value, 10) || null
        break
    }
  }
  return info
}
