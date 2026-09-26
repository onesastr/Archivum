import type { FileRecord } from '../db'
import type { ArchivumDatabase } from '../db'
import type { MetadataService } from './metadata'
import type { FileMetadata } from '../../shared/contract'

export interface BackfillOptions {
  batchSize: number
  concurrency: number
  /** How long to keep going before yielding so the event loop stays responsive. */
  batchPauseMs: number
}

/**
 * Drains the `metadata_state = 'pending'` queue after a bulk scan. Reading EXIF for
 * 100k files takes minutes, so it runs in the background with bounded concurrency
 * and in small batches, and the UI only ever sees rows that are already settled.
 */
export class MetadataWorker {
  private running = false
  private stopped = false
  private readonly idleWaiters = new Set<() => void>()

  constructor(
    private readonly db: ArchivumDatabase,
    private readonly metadata: MetadataService,
    private readonly emit: (paths: string[]) => void,
    private readonly options: BackfillOptions = { batchSize: 200, concurrency: 4, batchPauseMs: 25 }
  ) {}

  stop(): void {
    this.stopped = true
  }

  /** Runs until the queue drains or `stop()` is called. Concurrent calls share one pass. */
  async drain(): Promise<void> {
    if (this.running) {
      await this.waitForIdle()
      return
    }
    this.running = true
    try {
      while (!this.stopped) {
        const batch = this.db.getPendingMetadata(this.options.batchSize)
        if (batch.length === 0) return
        await this.processBatch(batch)
        if (this.stopped) return
        await pause(this.options.batchPauseMs)
      }
    } finally {
      this.running = false
      for (const resolve of this.idleWaiters) resolve()
      this.idleWaiters.clear()
    }
  }

  /** Resolves once no drain is in flight, so callers can guarantee an empty queue. */
  waitForIdle(): Promise<void> {
    if (!this.running) return Promise.resolve()
    return new Promise((resolve) => {
      this.idleWaiters.add(resolve)
    })
  }

  private async processBatch(batch: FileRecord[]): Promise<void> {
    const done: string[] = []
    let index = 0

    const worker = async (): Promise<void> => {
      while (index < batch.length) {
        const record = batch[index]
        index += 1
        if (record === undefined) return
        try {
          const meta = await this.metadata.read(record.path, record.kind)
          this.store(record.path, meta)
          done.push(record.path)
        } catch {
          this.db.updateFileMetadata(record.path, { metadataState: 'error' })
        }
      }
    }

    await Promise.all(
      Array.from({ length: Math.min(this.options.concurrency, batch.length) }, () => worker())
    )

    if (done.length > 0) this.emit(done)
  }

  private store(path: string, meta: FileMetadata): void {
    this.db.updateFileMetadata(path, {
      metadataState: meta.state === 'ready' ? 'ready' : meta.state,
      width: meta.width,
      height: meta.height,
      orientation: meta.orientation,
      bitsPerSample: meta.bitsPerSample,
      captureAt: meta.captureAt,
      captureSource: meta.captureSource,
      camera: meta.camera,
      lens: meta.lens,
      iso: meta.iso,
      aperture: meta.aperture,
      shutter: meta.shutter,
      focalLength: meta.focalLength,
      gpsLat: meta.gps?.latitude ?? null,
      gpsLon: meta.gps?.longitude ?? null,
      iccName: meta.icc?.name ?? null,
      colorSpace: meta.icc?.colorSpace ?? null
    })
  }
}

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
