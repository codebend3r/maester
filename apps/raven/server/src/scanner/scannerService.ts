import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common'
import type { ScanStatus } from '@raven/core'
import { SERVER_CONFIG, type ServerConfig } from '@/config'
import { ServerEvents } from '@/events/serverEvents'
import { FfmpegService, FfmpegTimeoutError } from '@/ffmpeg/ffmpegService'
import { LibrariesRepository } from '@/libraries/librariesRepository'
import { MediaIndex } from '@/media/mediaIndex'
import { MediaRepository } from '@/media/mediaRepository'
import { MetadataService } from '@/metadata/metadataService'
import { SubtitlesService } from '@/playback/subtitlesService'
import { TracksService } from '@/playback/tracksService'
import { mapWithConcurrency } from '@/scanner/concurrency'
import { changesAnything, reconcile } from '@/scanner/reconcile'
import { isUnder, walkVideos } from '@/scanner/walk'
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

/** What a scan looks at: every path of the library, or just the places under them that changed. */
type Scope = { kind: 'library' } | { kind: 'places'; places: readonly string[] }

/**
 * Whether a scan of `scope` speaks for an indexed path. A library scan
 * speaks for everything, so files under a path since dropped go too; a
 * refresh only for its places. Nothing under a place that could not be
 * read is touched.
 */
const inScope = ({
  path,
  scope,
  unreadable,
}: {
  path: string
  scope: Scope
  unreadable: readonly string[]
}): boolean =>
  (scope.kind === 'library' || scope.places.some((place) => isUnder({ path, root: place }))) &&
  !unreadable.some((place) => isUnder({ path, root: place }))

/**
 * Indexes a library: walks its paths, adds new files, follows renamed and
 * moved ones, re-probes replaced ones, drops deleted ones, hands every
 * freshly probed file to the thumbnail queue, and the library to metadata
 * for matching. Scans are incremental (an unchanged size and mtime skips
 * ffprobe), so a rescan of a settled library is mostly directory listing,
 * and a refresh looks only at the places its watcher saw change.
 */
@Injectable()
export class ScannerService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(ScannerService.name)
  private readonly statuses = new Map<number, ScanStatus>()
  /** Each library's last scan in line: a library's scans run one after another. */
  private readonly queue = new Map<number, Promise<void>>()
  /** Libraries with a full scan running or waiting its turn, which asking again adds nothing to. */
  private readonly fullScans = new Set<number>()
  private timer: NodeJS.Timeout | null = null

  constructor(
    @Inject(SERVER_CONFIG) private readonly config: ServerConfig,
    @Inject(LibrariesRepository) private readonly libraries: LibrariesRepository,
    @Inject(MediaRepository) private readonly media: MediaRepository,
    @Inject(MediaIndex) private readonly index: MediaIndex,
    @Inject(ServerEvents) private readonly events: ServerEvents,
    @Inject(FfmpegService) private readonly ffmpeg: FfmpegService,
    @Inject(ThumbnailService) private readonly thumbnails: ThumbnailService,
    @Inject(SubtitlesService) private readonly subtitles: SubtitlesService,
    @Inject(TracksService) private readonly tracks: TracksService,
    @Inject(MetadataService) private readonly metadata: MetadataService,
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

  /**
   * Starts a full scan, after any refresh under way, unless one is already
   * running or waiting; returns the status either way.
   */
  scan(libraryId: number): ScanStatus {
    if (!this.fullScans.has(libraryId)) {
      this.fullScans.add(libraryId)
      void this.enqueue({ libraryId, scope: { kind: 'library' } }).finally(() =>
        this.fullScans.delete(libraryId),
      )
    }
    return this.status(libraryId)
  }

  /** Looks again at just the places that changed, in its turn. Resolves once it has. */
  refresh({ libraryId, places }: { libraryId: number; places: readonly string[] }): Promise<void> {
    return this.enqueue({ libraryId, scope: { kind: 'places', places } })
  }

  /** Runs at once when the library is idle, so its status says scanning straight away. */
  private enqueue({ libraryId, scope }: { libraryId: number; scope: Scope }): Promise<void> {
    const ahead = this.queue.get(libraryId)
    const run = ahead
      ? ahead.then(() => this.run({ libraryId, scope }))
      : this.run({ libraryId, scope })
    const settled = run.catch(() => undefined)
    this.queue.set(libraryId, settled)
    void settled.finally(() => {
      if (this.queue.get(libraryId) === settled) this.queue.delete(libraryId)
    })
    return run
  }

  /** Resolves once the library has no scan running or waiting. */
  async whenIdle(libraryId: number): Promise<void> {
    const last = this.queue.get(libraryId)
    if (!last) return
    await last
    return this.whenIdle(libraryId)
  }

  forget(libraryId: number): void {
    this.statuses.delete(libraryId)
  }

  private update(libraryId: number, patch: Partial<ScanStatus>): void {
    this.statuses.set(libraryId, { ...this.status(libraryId), ...patch })
  }

  private async run({ libraryId, scope }: { libraryId: number; scope: Scope }): Promise<void> {
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
      const walk = await walkVideos({
        roots: library.paths,
        places: scope.kind === 'library' ? library.paths : scope.places,
      })
      const known = new Map(
        Array.from(this.index.forLibrary(libraryId)).filter(([path]) =>
          inScope({ path, scope, unreadable: walk.unreadable }),
        ),
      )
      const changes = reconcile({ known, found: walk.files })

      await this.thumbnails.discard(changes.gone)
      await this.subtitles.discard(changes.gone)
      const toProbe = this.index.apply({ libraryId, kind: library.settings.kind, changes })
      if (changesAnything(changes)) this.events.libraryChanged(libraryId)

      this.update(libraryId, {
        discovered: walk.files.length,
        processed: walk.files.length - toProbe.length,
      })
      // Matching needs only names, so new files are matched while they are
      // probed, and the files that went are cleared up after.
      this.metadata.enqueue(libraryId)

      await mapWithConcurrency({
        items: toProbe,
        limit: this.config.probeConcurrency,
        fn: async ({ id, path }) => {
          try {
            const { probe, tracks } = await this.ffmpeg.probeFile(path)
            this.media.saveProbe({ id, probe, tracks })
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

      // Thumbnails that timed out on an earlier pass get another go, and
      // videos indexed before tracks were stored get theirs.
      this.media.pendingThumbnailIds().forEach((id) => this.thumbnails.enqueue(id))
      this.tracks.backfill(this.media.idsMissingTracks(libraryId))

      const unreadable = walk.unreadable.map((place) => `Could not read ${place}.`)
      this.update(libraryId, {
        state: 'idle',
        finishedAt: new Date().toISOString(),
        error: unreadable.length > 0 ? unreadable.join(' ') : null,
      })
      this.logger.log(
        `Scanned "${library.name}": ${walk.files.length} files, ${changes.added.length} added, ${changes.moved.length} moved, ${toProbe.length} probed, ${changes.gone.length} removed`,
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
