import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common'
import type { ScanStatus } from '@raven/core'
import { SERVER_CONFIG, type ServerConfig } from '@/config'
import { FfmpegService, FfmpegTimeoutError } from '@/ffmpeg/ffmpegService'
import { LibrariesRepository } from '@/libraries/librariesRepository'
import { type FoundFile, MediaRepository } from '@/media/mediaRepository'
import { mapWithConcurrency } from '@/scanner/concurrency'
import { walkVideos } from '@/scanner/walk'
import { ThumbnailService } from '@/thumbnails/thumbnailService'

const IDLE: ScanStatus = {
  state: 'idle',
  discovered: 0,
  processed: 0,
  startedAt: null,
  finishedAt: null,
  error: null,
}

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/** Is `path` inside one of `roots`? Media under an unreadable root is kept, not deleted. */
const isUnder = ({ path, roots }: { path: string; roots: readonly string[] }): boolean =>
  roots.some((root) => path === root || path.startsWith(root.endsWith('/') ? root : `${root}/`))

/**
 * Indexes a library: walks its paths, adds new files, re-probes changed
 * ones, drops deleted ones, and hands every freshly probed file to the
 * thumbnail queue. Scans are incremental (an unchanged size and mtime skips
 * ffprobe), so a rescan of a settled library is mostly directory listing.
 */
@Injectable()
export class ScannerService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(ScannerService.name)
  private readonly statuses = new Map<number, ScanStatus>()
  private readonly running = new Map<number, Promise<void>>()
  private timer: NodeJS.Timeout | null = null

  constructor(
    @Inject(SERVER_CONFIG) private readonly config: ServerConfig,
    @Inject(LibrariesRepository) private readonly libraries: LibrariesRepository,
    @Inject(MediaRepository) private readonly media: MediaRepository,
    @Inject(FfmpegService) private readonly ffmpeg: FfmpegService,
    @Inject(ThumbnailService) private readonly thumbnails: ThumbnailService,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.scanOnStart) this.scanAll()
    if (this.config.rescanIntervalMinutes > 0) {
      this.timer = setInterval(() => this.scanAll(), this.config.rescanIntervalMinutes * 60_000)
      this.timer.unref()
    }
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer)
  }

  status(libraryId: number): ScanStatus {
    return this.statuses.get(libraryId) ?? IDLE
  }

  scanAll(): void {
    this.libraries.list().forEach((library) => this.scan(library.id))
  }

  /** Starts a scan unless one is already running, and returns the status either way. */
  scan(libraryId: number): ScanStatus {
    if (!this.running.has(libraryId)) {
      const run = this.run(libraryId).finally(() => this.running.delete(libraryId))
      this.running.set(libraryId, run)
    }
    return this.status(libraryId)
  }

  /** Resolves when the library's current scan (if any) has finished. */
  async whenIdle(libraryId: number): Promise<void> {
    await this.running.get(libraryId)
  }

  forget(libraryId: number): void {
    this.statuses.delete(libraryId)
  }

  private update(libraryId: number, patch: Partial<ScanStatus>): void {
    this.statuses.set(libraryId, { ...this.status(libraryId), ...patch })
  }

  private async run(libraryId: number): Promise<void> {
    const library = this.libraries.get(libraryId)
    if (!library) return
    this.update(libraryId, {
      state: 'scanning',
      discovered: 0,
      processed: 0,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      error: null,
    })

    try {
      const walk = await walkVideos({ roots: library.paths })
      const known = this.media.indexForLibrary(libraryId)
      const found = new Set(walk.files.map((file) => file.path))

      const gone = [...known.entries()]
        .filter(([path]) => !found.has(path) && !isUnder({ path, roots: walk.unreadableRoots }))
        .map(([, file]) => file.id)
      await this.thumbnails.discard(gone)
      this.media.removeMany(gone)

      const toProbe = walk.files.flatMap((file: FoundFile) => {
        const existing = known.get(file.path)
        if (!existing) return [{ id: this.media.insert({ libraryId, file }), path: file.path }]
        if (existing.size !== file.size || existing.mtimeMs !== file.mtimeMs) {
          this.media.markChanged({ id: existing.id, size: file.size, mtimeMs: file.mtimeMs })
          return [{ id: existing.id, path: file.path }]
        }
        return existing.probed ? [] : [{ id: existing.id, path: file.path }]
      })

      this.update(libraryId, {
        discovered: walk.files.length,
        processed: walk.files.length - toProbe.length,
      })

      await mapWithConcurrency({
        items: toProbe,
        limit: this.config.probeConcurrency,
        fn: async ({ id, path }) => {
          try {
            this.media.saveProbe({ id, probe: await this.ffmpeg.probe(path) })
            this.thumbnails.enqueue(id)
          } catch (error) {
            // A timeout leaves the file unprobed, so the next scan tries it again.
            if (!(error instanceof FfmpegTimeoutError)) {
              this.media.saveProbeError({ id, error: message(error) })
            }
            this.logger.warn(`Could not probe ${path}: ${message(error)}`)
          }
          this.update(libraryId, { processed: this.status(libraryId).processed + 1 })
        },
      })

      // Thumbnails that timed out on an earlier pass get another go.
      this.media.pendingThumbnailIds().forEach((id) => this.thumbnails.enqueue(id))

      const unreadable = walk.unreadableRoots.map((root) => `Could not read ${root}.`)
      this.update(libraryId, {
        state: 'idle',
        finishedAt: new Date().toISOString(),
        error: unreadable.length > 0 ? unreadable.join(' ') : null,
      })
      this.logger.log(
        `Scanned "${library.name}": ${walk.files.length} files, ${toProbe.length} probed, ${gone.length} removed`,
      )
    } catch (error) {
      this.update(libraryId, {
        state: 'idle',
        finishedAt: new Date().toISOString(),
        error: message(error),
      })
      this.logger.error(`Scan of "${library.name}" failed: ${message(error)}`)
    }
  }
}
