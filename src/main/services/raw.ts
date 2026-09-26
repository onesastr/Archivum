import { execFile } from 'node:child_process'
import { access, constants, mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
  asShotNeutral?: boolean
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
    // A packaged build copies resources/libraw/<os>-<arch> to <app>/resources/libraw
    // through extraResources, while a checkout keeps them at
    // <project>/resources/libraw. Both are searched so `npm run dev` and a
    // packaged AppImage resolve the binary the same way.
    const dirs = [
      ...roots.map((root) => join(root, 'resources', 'libraw')),
      // Packaged: <app>/resources/libraw, which is process.resourcesPath itself.
      ...(process.resourcesPath ? [join(process.resourcesPath, 'libraw')] : []),
      join(process.cwd(), 'resources', 'libraw')
    ]
    for (const dir of dirs) {
      let entries: string[]
      try {
        entries = await readdir(dir)
      } catch {
        continue
      }
      for (const entry of entries) {
        if (!entry.startsWith('dcraw_emu')) continue
        found.set('dcraw_emu', join(dir, entry))
      }
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

  /** Reads dimensions and camera identity without demosaicing — cheap enough to run during indexing. */
  async identify(path: string): Promise<LibRawInfo | null> {
    let binary: string
    try {
      binary = await this.dcrawEmu()
    } catch {
      return null
    }
    try {
      const { stdout } = await run(binary, ['-i', '-v', path], {
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

  /** Full-size demosaic to TIFF. Slow (seconds) — used by the Edit pipeline, never by browsing. */
  async decodeToTiff(
    path: string,
    adjustments: RawAdjustments = {}
  ): Promise<{ buffer: Buffer; cleanup: () => Promise<void> }> {
    const binary = await this.dcrawEmu()
    const dir = await mkdtemp(join(tmpdir(), 'archivum-raw-'))
    const output = join(dir, 'out.tiff')
    const args = ['-Z', output]
    if (adjustments.userMul) args.push('-u', adjustments.userMul.join(' '))
    if (adjustments.exposure !== undefined) args.push('-E', String(adjustments.exposure))
    if (adjustments.noAutoBright) args.push('-W')
    if (adjustments.halfSize) args.push('-h')
    if (!adjustments.asShotNeutral) args.push('-m')
    args.push(path)

    await run(binary, args, { maxBuffer: 8 * 1024 * 1024, timeout: 300_000 })
    const buffer = await readFile(output)
    return {
      buffer,
      cleanup: () => rm(dir, { recursive: true, force: true })
    }
  }

  /**
   * Pulls the camera's own embedded JPEG preview, which is orders of magnitude
   * faster than demosaicing and is what Lightroom/Capture One show in a grid.
   */
  async extractPreview(path: string): Promise<Buffer | null> {
    let binary: string
    try {
      binary = await this.dcrawEmu()
    } catch {
      return null
    }
    const dir = await mkdtemp(join(tmpdir(), 'archivum-thumb-'))
    const output = join(dir, 'preview.jpg')
    try {
      await run(binary, ['-e', '-Z', output, path], {
        maxBuffer: 8 * 1024 * 1024,
        timeout: 120_000
      })
      return await readFile(output)
    } catch {
      return null
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }

  /** Demosaiced pixels with no embedded preview available, as a TIFF buffer. */
  async decodeToBuffer(path: string, adjustments: RawAdjustments = {}): Promise<Buffer | null> {
    try {
      const decoded = await this.decodeToTiff(path, adjustments)
      try {
        return decoded.buffer
      } finally {
        await decoded.cleanup()
      }
    } catch {
      return null
    }
  }
}

const IDENTIFY_LABELS: Record<string, keyof Omit<LibRawInfo, 'isRaw' | 'colors'>> = {
  'raw size': 'rawWidth',
  'output size': 'outputWidth',
  'bits/sample': 'bitsPerSample'
}

export function parseIdentify(stdout: string): LibRawInfo | null {
  if (!stdout.includes('LibRaw')) return null
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

    const sizeMatch = /(\d+)\s*x\s*(\d+)/.exec(value)
    if (label === 'Image size') {
      info.rawWidth = sizeMatch ? Number(sizeMatch[1]) : null
      info.rawHeight = sizeMatch ? Number(sizeMatch[2]) : null
    } else if (label === 'Output size') {
      info.outputWidth = sizeMatch ? Number(sizeMatch[1]) : null
      info.outputHeight = sizeMatch ? Number(sizeMatch[2]) : null
    } else if (label === 'Camera make') {
      info.make = value || null
    } else if (label === 'Camera model') {
      info.model = value || null
    } else if (label === 'Bits per sample') {
      info.bitsPerSample = Number.parseInt(value, 10) || null
    } else if (label === 'Camera colors') {
      info.colors = Number.parseInt(value, 10) || 3
    } else if (label in IDENTIFY_LABELS) {
      const target = IDENTIFY_LABELS[label]
      const parsed = Number.parseInt(value, 10)
      if (Number.isFinite(parsed)) {
        if (target === 'rawWidth') info.rawWidth = parsed
        if (target === 'outputWidth') info.outputWidth = parsed
        if (target === 'bitsPerSample') info.bitsPerSample = parsed
      }
    }
  }
  return info
}
