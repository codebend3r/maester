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
import { type KnownStats, type WalkResult, isUnder, outermost, walkVideos } from '@/scanner/walk'
import { ThumbnailService } from '@/thumbnails/thumbnailService'

const IDLE: ScanStatus = {
  state: 'idle',
  found: 0,
  processed: 0,
  startedAt: null,
  finishedAt: null,
  quickScannedAt: null,
  error: null,
}

/**
 * What a scan looks at: every path of the library, reading every file (a
 * full scan); every path, reading only the files it does not know, and
 * those at `places` (a quick scan); or just the places that changed.
 */
export type Scope =
  | { kind: 'library' }
  | { kind: 'quick'; places: readonly string[] }
  | { kind: 'places'; places: readonly string[] }

/**
 * Two scans waiting their turn, as one: a full scan covers anything, a
 * quick scan covers a refresh as long as it still reads the refresh's
 * places, and places add up.
 */
export const mergeScopes = ({ waiting, scope }: { waiting: Scope | null; scope: Scope }): Scope => {
  if (waiting == null) return scope
  if (waiting.kind === 'library' || scope.kind === 'library') return { kind: 'library' }
  const places = outermost([...waiting.places, ...scope.places])
  if (waiting.kind === 'quick' || scope.kind === 'quick') return { kind: 'quick', places }
  return { kind: 'places', places }
}

/**
 * What a quick scan takes as read: the size and modification time the index
 * holds for a file, unless the file sits at one of the places a refresh
 * asked to read, where it is stat'ed as a refresh would.
 */
const knownOutside =
  ({ indexed, places }: { indexed: ReadonlyMap<string, KnownStats>; places: readonly string[] }) =>
  (path: string): KnownStats | null =>
    places.some((place) => isUnder({ path, root: place })) ? null : (indexed.get(path) ?? null)

/**
 * Whether a scan of `scope` speaks for an indexed path. A full or quick
 * scan walks every path, so it speaks for everything, and files under a
 * path since dropped go too; a refresh only for its places. Nothing under a
 * place that could not be read is touched.
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
  (scope.kind !== 'places' || scope.places.some((place) => isUnder({ path, root: place }))) &&
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
 * ffprobe). A full scan reads every file and runs only when asked: Rescan,
 * a new library, or a change of its folders. A quick scan, on boot and on
 * a timer, reads only the folders and the files it does not know, so it
 * takes in new, renamed and deleted files at a fraction of the cost, never
 * taking over the scan status; a file replaced under its name waits for a
 * full scan. A refresh looks only at the places the watcher saw change.
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
    if (this.config.scanOnStart) this.quickScanAll()
    if (this.config.quickScanIntervalMinutes > 0) {
      this.timer = setInterval(
        () => this.quickScanRefreshing(),
        this.config.quickScanIntervalMinutes * 60_000,
      )
      this.timer.unref()
    }
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer)
  }

  /** The library's live status; before anything has run this process, what its record remembers. */
  status(libraryId: number): ScanStatus {
    const live = this.statuses.get(libraryId)
    if (live) return live
    const { fullScannedAt, quickScannedAt } = this.libraries.scanTimes(libraryId)
    const remembered: ScanStatus = { ...IDLE, finishedAt: fullScannedAt, quickScannedAt }
    this.statuses.set(libraryId, remembered)
    return remembered
  }

  /** Every library, on boot: whatever changed while the server was down. */
  quickScanAll(): void {
    this.libraries.list().forEach((library) => this.quickScan(library.id))
  }

  /** The libraries that refresh automatically, on the timer. */
  private quickScanRefreshing(): void {
    this.libraries
      .list()
      .filter((library) => library.settings.autoRefresh)
      .forEach((library) => this.quickScan(library.id))
  }

  /** Starts a full scan, or queues one behind the scan under way, and returns the status. */
  scan(libraryId: number): ScanStatus {
    this.request({ libraryId, scope: { kind: 'library' } })
    return this.status(libraryId)
  }

  /** Starts a quick scan, or queues one behind the scan under way. */
  quickScan(libraryId: number): void {
    this.request({ libraryId, scope: { kind: 'quick', places: [] } })
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

  private update({ libraryId, patch }: { libraryId: number; patch: Partial<ScanStatus> }): void {
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
      slot.next = mergeScopes({ waiting: slot.next, scope })
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
      case 'quick':
        return this.quickScanLibrary({ library, places: scope.places })
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
          this.update({
            libraryId: library.id,
            patch: { found: this.status(library.id).found + count },
          }),
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
          this.update({
            libraryId: library.id,
            patch: { processed: this.status(library.id).processed + 1 },
          }),
      })
      // Thumbnails that timed out on an earlier pass get another go.
      this.thumbnails.retryPending()

      const unreadable = walk.unreadable.map((place) => `Could not read ${place}.`)
      this.finishFullScan({
        library,
        error: unreadable.length > 0 ? unreadable.join(' ') : null,
      })
      this.logger.log(`Scanned "${library.name}": ${summary({ walk, changes, toProbe })}`)
    } catch (error) {
      this.finishFullScan({ library, error: errorMessage(error) })
      this.logger.error(`Scan of "${library.name}" failed: ${errorMessage(error)}`)
    }
  }

  /** The full scan is over: its end is remembered, so a restart still says when it was. */
  private finishFullScan({
    library,
    error,
  }: {
    library: LibraryRecord
    error: string | null
  }): void {
    const at = new Date().toISOString()
    this.libraries.markFullScan({ id: library.id, at })
    this.update(library.id, { state: 'idle', finishedAt: at, error })
  }

  /**
   * A quick scan: every path, reading only the files the index does not
   * know, and those at `places`. The status keeps the last full scan's
   * progress and outcome; only its quick scan time moves on.
   */
  private async quickScanLibrary({
    library,
    places,
  }: {
    library: LibraryRecord
    places: readonly string[]
  }): Promise<void> {
    try {
      const { walk, changes, toProbe } = await this.reindex({
        library,
        scope: { kind: 'quick', places },
      })
      if (changesAnything(changes) || toProbe.length > 0) {
        this.metadata.enqueue(library.id)
        await this.probe({ toProbe, onProbed: () => undefined })
      }
      // A path it could not read (a share that is down) leaves the scan unfinished, so the time stands.
      if (walk.unreadable.length > 0) {
        this.logger.warn(
          `Quick scan of "${library.name}" could not read ${walk.unreadable.join(', ')}`,
        )
        return
      }
      const at = new Date().toISOString()
      this.libraries.markQuickScan({ id: library.id, at })
      this.update({ libraryId: library.id, patch: { quickScannedAt: at } })
      this.logger.log(`Quick scan of "${library.name}": ${summary({ walk, changes, toProbe })}`)
    } catch (error) {
      this.logger.warn(`Quick scan of "${library.name}" failed: ${errorMessage(error)}`)
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
   * Brings the index in line with the disk over `scope` in one write, and
   * the planner's statistics with it, then forgets what was kept of the
   * files that went, and tells clients when it changed. The rows go first,
   * so a failed write leaves no row pointing at a thumbnail that was
   * already deleted.
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
    const indexed = this.index.forLibrary(library.id)
    const walk = await walkVideos({
      roots: library.paths,
      places: scope.kind === 'places' ? scope.places : library.paths,
      onFound,
      known: scope.kind === 'quick' ? knownOutside({ indexed, places: scope.places }) : undefined,
    })
    const known = new Map(
      Array.from(indexed).filter(([path]) => inScope({ path, scope, unreadable: walk.unreadable })),
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
    // Probing what was added can take hours on a first scan, too long for the planner to wait.
    if (changesAnything(changes)) this.database.refreshStatistics()
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
