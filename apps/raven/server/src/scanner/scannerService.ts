import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common'
import type { ScanStatus } from '@raven/core'
import { SERVER_CONFIG, type ServerConfig } from '@/config'
import { DatabaseService } from '@/db/database'
import { errorMessage } from '@/errorMessage'
import { ServerEvents } from '@/events/serverEvents'
import { FfmpegService, FfmpegTimeoutError } from '@/ffmpeg/ffmpegService'
import { type LibraryRecord, LibrariesRepository } from '@/libraries/librariesRepository'
import { MediaArtifacts } from '@/media/mediaArtifacts'
import { MediaIndex, type ProbeTarget } from '@/media/mediaIndex'
import { MetadataService } from '@/metadata/metadataService'
import { mapWithConcurrency } from '@/scanner/concurrency'
import { layoutsOf, withTitleRoots } from '@/scanner/layout'
import { type Reconciled, changesAnything, reconcile } from '@/scanner/reconcile'
import { type WalkResult, isUnder, outermost, walkVideos } from '@/scanner/walk'
import { ThumbnailService } from '@/thumbnails/thumbnailService'

const IDLE: ScanStatus = {
  state: 'idle',
  found: 0,
  processed: 0,
  startedAt: null,
  finishedAt: null,
  error: null,
}

/** What a scan looks at: every path of the library, or just the places under them that changed. */
type Scope = { kind: 'library' } | { kind: 'places'; places: readonly string[] }

/** Two scans waiting their turn, as one: a full scan covers any places, and places add up. */
const merge = ({ waiting, scope }: { waiting: Scope | null; scope: Scope }): Scope => {
  if (waiting == null) return scope
  if (waiting.kind === 'library' || scope.kind === 'library') return { kind: 'library' }
  return { kind: 'places', places: outermost([...waiting.places, ...scope.places]) }
}

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

/** What a scan found and did, for the log. */
const summary = ({
  walk,
  changes,
  toProbe,
}: {
  walk: WalkResult
  changes: Reconciled
  toProbe: readonly ProbeTarget[]
}): string =>
  `${walk.files.length} files, ${changes.added.length} added, ${changes.moved.length} moved, ${toProbe.length} probed, ${changes.gone.length} removed`

/** A library's scan running now, and what waits for it to finish. */
type Slot = { running: Promise<void>; next: Scope | null }

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
  private readonly slots = new Map<number, Slot>()
  private timer: NodeJS.Timeout | null = null

  constructor(
    @Inject(SERVER_CONFIG) private readonly config: ServerConfig,
    @Inject(LibrariesRepository) private readonly libraries: LibrariesRepository,
    @Inject(MediaIndex) private readonly index: MediaIndex,
    @Inject(MediaArtifacts) private readonly artifacts: MediaArtifacts,
    @Inject(ServerEvents) private readonly events: ServerEvents,
    @Inject(FfmpegService) private readonly ffmpeg: FfmpegService,
    @Inject(ThumbnailService) private readonly thumbnails: ThumbnailService,
    @Inject(MetadataService) private readonly metadata: MetadataService,
    @Inject(DatabaseService) private readonly database: DatabaseService,
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

  /** Starts a full scan, or queues one behind the scan under way, and returns the status. */
  scan(libraryId: number): ScanStatus {
    this.request({ libraryId, scope: { kind: 'library' } })
    return this.status(libraryId)
  }

  /** Looks again at just the places that changed, after any scan of the library under way. */
  refresh({ libraryId, places }: { libraryId: number; places: readonly string[] }): void {
    this.request({ libraryId, scope: { kind: 'places', places: outermost(places) } })
  }

  /** Resolves once the library has no scan running or waiting. */
  async whenIdle(libraryId: number): Promise<void> {
    const slot = this.slots.get(libraryId)
    if (!slot) return
    await slot.running
    return this.whenIdle(libraryId)
  }

  forget(libraryId: number): void {
    this.statuses.delete(libraryId)
  }

  private update(libraryId: number, patch: Partial<ScanStatus>): void {
    this.statuses.set(libraryId, { ...this.status(libraryId), ...patch })
  }

  /**
   * A library scans one thing at a time. An idle one starts at once, so its
   * status says scanning straight away; a busy one keeps the request for
   * after, merged with whatever else waits.
   */
  private request({ libraryId, scope }: { libraryId: number; scope: Scope }): void {
    const slot = this.slots.get(libraryId)
    if (slot) {
      slot.next = merge({ waiting: slot.next, scope })
      return
    }
    this.start({ libraryId, scope })
  }

  private start({ libraryId, scope }: { libraryId: number; scope: Scope }): void {
    const running = this.run({ libraryId, scope })
      .catch((error: unknown) => this.logger.error(`Scan failed: ${errorMessage(error)}`))
      .then(() => this.startNext(libraryId))
    this.slots.set(libraryId, { running, next: null })
  }

  /** The scan that waited, if any, now takes its turn. */
  private startNext(libraryId: number): void {
    const next = this.slots.get(libraryId)?.next
    if (next) this.start({ libraryId, scope: next })
    else this.slots.delete(libraryId)
  }

  private async run({ libraryId, scope }: { libraryId: number; scope: Scope }): Promise<void> {
    const library = this.libraries.get(libraryId)
    if (!library) return
    switch (scope.kind) {
      case 'library':
        return this.scanLibrary(library)
      case 'places':
        return this.refreshPlaces({ library, places: scope.places })
      default: {
        const unknown: never = scope
        return unknown
      }
    }
  }

  /** A full scan: everything under the library's paths, its progress and outcome in the status. */
  private async scanLibrary(library: LibraryRecord): Promise<void> {
    this.update(library.id, {
      state: 'walking',
      found: 0,
      processed: 0,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      error: null,
    })
    try {
      const { walk, changes, toProbe } = await this.reindex({
        library,
        scope: { kind: 'library' },
        onFound: (count) =>
          this.update(library.id, { found: this.status(library.id).found + count }),
      })
      this.update(library.id, {
        state: 'indexing',
        found: walk.files.length,
        processed: walk.files.length - toProbe.length,
      })
      // Matching needs only names, so new files are matched while they are
      // probed, and the files that went are cleared up after.
      this.metadata.enqueue(library.id)
      await this.probe({
        toProbe,
        onProbed: () =>
          this.update(library.id, { processed: this.status(library.id).processed + 1 }),
      })
      // Matching may still be under way, and refreshes the statistics again when its pass ends.
      this.database.refreshStatistics()
      // Thumbnails that timed out on an earlier pass get another go.
      this.thumbnails.retryPending()

      const unreadable = walk.unreadable.map((place) => `Could not read ${place}.`)
      this.update(library.id, {
        state: 'idle',
        finishedAt: new Date().toISOString(),
        error: unreadable.length > 0 ? unreadable.join(' ') : null,
      })
      this.logger.log(`Scanned "${library.name}": ${summary({ walk, changes, toProbe })}`)
    } catch (error) {
      this.update(library.id, {
        state: 'idle',
        finishedAt: new Date().toISOString(),
        error: errorMessage(error),
      })
      this.logger.error(`Scan of "${library.name}" failed: ${errorMessage(error)}`)
    }
  }

  /**
   * A refresh: just the places that changed, leaving the status to the last
   * full scan. Most refreshes are a subtitle or a poster written beside a
   * video, and change nothing.
   */
  private async refreshPlaces({
    library,
    places,
  }: {
    library: LibraryRecord
    places: readonly string[]
  }): Promise<void> {
    try {
      const { walk, changes, toProbe } = await this.reindex({
        library,
        scope: { kind: 'places', places },
      })
      if (!changesAnything(changes) && toProbe.length === 0) return
      this.metadata.enqueue(library.id)
      await this.probe({ toProbe, onProbed: () => undefined })
      this.logger.log(`Refreshed "${library.name}": ${summary({ walk, changes, toProbe })}`)
    } catch (error) {
      this.logger.warn(`Refresh of "${library.name}" failed: ${errorMessage(error)}`)
    }
  }

  /**
   * Brings the index in line with the disk over `scope` in one write, then
   * forgets what was kept of the files that went, and tells clients when it
   * changed. The rows go first, so a failed write leaves no row pointing at
   * a thumbnail that was already deleted.
   */
  private async reindex({
    library,
    scope,
    onFound,
  }: {
    library: LibraryRecord
    scope: Scope
    /** A full scan's count of videos found while it walks; a refresh keeps the status as it is. */
    onFound?: (count: number) => void
  }): Promise<{ walk: WalkResult; changes: Reconciled; toProbe: ProbeTarget[] }> {
    const walk = await walkVideos({
      roots: library.paths,
      places: scope.kind === 'library' ? library.paths : scope.places,
      onFound,
    })
    const known = new Map(
      Array.from(this.index.forLibrary(library.id)).filter(([path]) =>
        inScope({ path, scope, unreadable: walk.unreadable }),
      ),
    )
    // A layout or type change can land during the walk; what follows is
    // synchronous, so the settings read here are the ones the files are filed under.
    const { kind, folderLayout } = this.libraries.get(library.id)?.settings ?? library.settings
    // Each file is filed under the folder its titles sit in, a letter folder
    // or a group folder when its path has one, before anything reads it.
    const changes = reconcile({
      known,
      found: withTitleRoots({ files: walk.files, kind, layout: folderLayout }),
    })
    if (scope.kind === 'library') {
      this.libraries.saveLayouts({
        id: library.id,
        layouts: layoutsOf({
          roots: library.paths.filter((path) => !walk.unreadable.includes(path)),
          files: walk.files,
          kind,
          layout: folderLayout,
        }),
      })
    }
    const toProbe = this.index.apply({
      libraryId: library.id,
      kind,
      changes,
    })
    await this.artifacts.discard(changes.gone)
    if (changesAnything(changes)) this.events.libraryChanged(library.id)
    return { walk, changes, toProbe }
  }

  /** Probes each file a few at a time. A timeout leaves the file unprobed, so the next scan tries it again. */
  private async probe({
    toProbe,
    onProbed,
  }: {
    toProbe: readonly ProbeTarget[]
    onProbed: () => void
  }): Promise<void> {
    await mapWithConcurrency({
      items: toProbe,
      limit: this.config.probeConcurrency,
      fn: async ({ id, path }) => {
        try {
          const { probe, tracks } = await this.ffmpeg.probeFile(path)
          this.index.saveProbe({ id, probe, tracks })
          this.thumbnails.enqueue(id)
        } catch (error) {
          if (!(error instanceof FfmpegTimeoutError)) {
            this.index.saveProbeError({ id, error: errorMessage(error) })
          }
          this.logger.warn(`Could not probe ${path}: ${errorMessage(error)}`)
        }
        onProbed()
      },
    })
  }
}
