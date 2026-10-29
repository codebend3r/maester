import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common'
import {
  KIND_RULES,
  MEDIA_TYPES,
  type MediaType,
  SCAN_KINDS,
  SCAN_STATES,
  type ScanStatus,
  extensionsFor,
} from '@raven/core'
import { SERVER_CONFIG, type ServerConfig } from '@/config'
import { DatabaseService } from '@/db/database'
import { errorMessage } from '@/errorMessage'
import { ServerEvents } from '@/events/serverEvents'
import { FfmpegService, FfmpegTimeoutError } from '@/ffmpeg/ffmpegService'
import { type LibraryRecord, LibrariesRepository } from '@/libraries/librariesRepository'
import { MediaArtifacts } from '@/media/mediaArtifacts'
import { MediaIndex, type ProbeTarget } from '@/media/mediaIndex'
import { MetadataService } from '@/metadata/metadataService'
import { MusicIndexer } from '@/music/musicIndexer'
import { mapWithConcurrency } from '@/scanner/concurrency'
import { layoutsOf, withTitleRoots } from '@/scanner/layout'
import { type Reconciled, changesAnything, reconcile } from '@/scanner/reconcile'
import { type KnownStats, type WalkResult, isUnder, outermost, walkVideos } from '@/scanner/walk'
import { StartupWork } from '@/startupWork'
import { ThumbnailService } from '@/thumbnails/thumbnailService'

const IDLE: ScanStatus = {
  state: SCAN_STATES.idle,
  kind: SCAN_KINDS.full,
  found: 0,
  processed: 0,
  startedAt: null,
  finishedAt: null,
  quickScannedAt: null,
  error: null,
}

const SCOPE_KINDS = { library: 'library', quick: 'quick', places: 'places' } as const

/**
 * Why a quick scan runs: a check on the watcher's timer, the scan on boot,
 * or one the admin asked for. A check shows in the status, and counts as a
 * quick scan, only once it finds something new, and leaves a file whose
 * probe timed out to a scan someone starts; one the admin asked for stays
 * under way until the new videos are matched.
 */
export const QUICK_SCAN_REASONS = { check: 'check', boot: 'boot', asked: 'asked' } as const

type QuickScanReason = (typeof QUICK_SCAN_REASONS)[keyof typeof QUICK_SCAN_REASONS]

/** Quietest first: two scans waiting as one keep the louder reason. */
const LOUDNESS: readonly QuickScanReason[] = [
  QUICK_SCAN_REASONS.check,
  QUICK_SCAN_REASONS.boot,
  QUICK_SCAN_REASONS.asked,
]

/**
 * What a scan looks at: every path of the library, reading every file (a
 * full scan); every path, reading only the files it does not know, and
 * those at `places` (a quick scan); or just the places that changed.
 */
export type Scope =
  | { kind: typeof SCOPE_KINDS.library }
  | { kind: typeof SCOPE_KINDS.quick; places: readonly string[]; reason: QuickScanReason }
  | { kind: typeof SCOPE_KINDS.places; places: readonly string[] }

type MergeScopesProps = { waiting: Scope | null; scope: Scope }

/**
 * Two scans waiting their turn, as one: a full scan covers anything, a
 * quick scan covers a refresh as long as it still reads the refresh's
 * places, and places add up.
 */
export const mergeScopes = ({ waiting, scope }: MergeScopesProps): Scope => {
  if (waiting == null) return scope
  if (waiting.kind === SCOPE_KINDS.library || scope.kind === SCOPE_KINDS.library) {
    return { kind: SCOPE_KINDS.library }
  }
  const places = outermost([...waiting.places, ...scope.places])
  const reasons = new Set(
    [waiting, scope].flatMap((each) => (each.kind === SCOPE_KINDS.quick ? [each.reason] : [])),
  )
  const reason = LOUDNESS.findLast((each) => reasons.has(each))
  if (reason != null) return { kind: SCOPE_KINDS.quick, places, reason }
  return { kind: SCOPE_KINDS.places, places }
}

type KnownOutsideProps = { indexed: ReadonlyMap<string, KnownStats>; places: readonly string[] }

/**
 * What a quick scan takes as read: the size and modification time the index
 * holds for a file, unless the file sits at one of the places a refresh
 * asked to read, where it is stat'ed as a refresh would.
 */
const knownOutside =
  ({ indexed, places }: KnownOutsideProps) =>
  (path: string): KnownStats | null =>
    places.some((place) => isUnder({ path, root: place })) ? null : (indexed.get(path) ?? null)

type InScopeProps = {
  path: string
  scope: Scope
  unreadable: readonly string[]
}

/**
 * Whether a scan of `scope` speaks for an indexed path. A full or quick
 * scan walks every path, so it speaks for everything, and files under a
 * path since dropped go too; a refresh only for its places. Nothing under a
 * place that could not be read is touched.
 */
const inScope = ({ path, scope, unreadable }: InScopeProps): boolean =>
  (scope.kind !== SCOPE_KINDS.places ||
    scope.places.some((place) => isUnder({ path, root: place }))) &&
  !unreadable.some((place) => isUnder({ path, root: place }))

type SummaryProps = {
  walk: WalkResult
  changes: Reconciled
  toProbe: readonly ProbeTarget[]
}

/** What a scan found and did, for the log. */
const summary = ({ walk, changes, toProbe }: SummaryProps): string =>
  `${walk.files.length} files, ${changes.added.length} added, ${changes.moved.length} moved, ${toProbe.length} probed, ${changes.gone.length} removed`

type UntilAbortedProps = {
  signal: AbortSignal
  until: Promise<void>
}

/** Resolves when `until` does, or as soon as `signal` aborts, whichever is first. */
const untilAborted = ({ signal, until }: UntilAbortedProps): Promise<void> =>
  new Promise((resolve) => {
    if (signal.aborted) return resolve()
    signal.addEventListener('abort', () => resolve(), { once: true })
    until.then(resolve, resolve)
  })

/** A library's scan running now, and what waits for it to finish. */
type Slot = { running: Promise<void>; next: Scope | null; abort: AbortController }

type ScannerServiceRefreshProps = { libraryId: number; places: readonly string[] }

type ScannerServiceUpdateProps = { libraryId: number; patch: Partial<ScanStatus> }

type ScannerServiceRequestProps = { libraryId: number; scope: Scope }

type ScannerServiceStartProps = { libraryId: number; scope: Scope }

type ScannerServiceRunProps = {
  libraryId: number
  scope: Scope
  signal: AbortSignal
}

type ScannerServiceScanLibraryProps = {
  library: LibraryRecord
  signal: AbortSignal
}

type ScannerServiceCancelFullScanProps = {
  library: LibraryRecord
  before: ScanStatus
}

type ScannerServiceFinishFullScanProps = {
  library: LibraryRecord
  error: string | null
}

type ScannerServiceQuickScanLibraryProps = {
  library: LibraryRecord
  places: readonly string[]
  reason: QuickScanReason
  signal: AbortSignal
}

type ScannerServiceRefreshPlacesProps = {
  library: LibraryRecord
  places: readonly string[]
  signal: AbortSignal
}

type ScannerServiceReindexProps = {
  library: LibraryRecord
  scope: Scope
  /** Aborted by a cancel: the walk ends and nothing is written. */
  signal: AbortSignal
  /** A full scan's count of videos found while it walks; a refresh keeps the status as it is. */
  onFound?: (count: number) => void
}

type ScannerServiceProbeProps = {
  libraryId: number
  /** What the library's files are: videos go to ffprobe, audio files to the music indexer. */
  media: MediaType
  toProbe: readonly ProbeTarget[]
  /** Aborted by a cancel: the files not yet started stay unprobed, for the next scan. */
  signal: AbortSignal
  onProbed: () => void
}

type ScannerServiceProbeOneProps = {
  libraryId: number
  media: MediaType
  id: number
  path: string
}

/**
 * Indexes a library: walks its paths, adds new files, follows renamed and
 * moved ones, re-probes replaced ones, drops deleted ones, hands every
 * freshly probed file to the thumbnail queue, and the library to metadata
 * for matching. Scans are incremental (an unchanged size and mtime skips
 * ffprobe). A full scan reads every file and runs only when asked: Rescan,
 * a new library, or a change of its folders. A quick scan, on boot or when
 * asked, reads only the folders and the files it does not know, so it
 * takes in new, renamed and deleted files at a fraction of the cost, never
 * taking over the scan status; a file replaced under its name waits for a
 * full scan. A refresh looks only at the places the watcher saw change, and
 * a check (the watcher's timer, for a library no watch hears of) is a quick
 * scan that keeps out of sight until it finds something.
 */
@Injectable()
export class ScannerService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ScannerService.name)
  private readonly statuses = new Map<number, ScanStatus>()
  private readonly slots = new Map<number, Slot>()

  constructor(
    @Inject(SERVER_CONFIG) private readonly config: ServerConfig,
    @Inject(LibrariesRepository) private readonly libraries: LibrariesRepository,
    @Inject(MediaIndex) private readonly index: MediaIndex,
    @Inject(MediaArtifacts) private readonly artifacts: MediaArtifacts,
    @Inject(ServerEvents) private readonly events: ServerEvents,
    @Inject(FfmpegService) private readonly ffmpeg: FfmpegService,
    @Inject(ThumbnailService) private readonly thumbnails: ThumbnailService,
    @Inject(MetadataService) private readonly metadata: MetadataService,
    @Inject(MusicIndexer) private readonly music: MusicIndexer,
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(StartupWork) private readonly startup: StartupWork,
  ) {}

  /** The scans on boot are steps of the work on boot, a library each, so the server listens first. */
  onApplicationBootstrap(): void {
    if (this.config.scanOnStart) {
      this.startup.add(this.libraries.list().map((library) => () => this.quickScan(library.id)))
    }
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

  /** Starts a full scan, or queues one behind the scan under way, and returns the status. */
  scan(libraryId: number): ScanStatus {
    this.request({ libraryId, scope: { kind: SCOPE_KINDS.library } })
    return this.status(libraryId)
  }

  /** Starts a quick scan, or queues one behind the scan under way. */
  quickScan(libraryId: number): void {
    this.request({
      libraryId,
      scope: { kind: SCOPE_KINDS.quick, places: [], reason: QUICK_SCAN_REASONS.boot },
    })
  }

  /** A quiet quick scan, or one queued behind the scan under way: see `QUICK_SCAN_REASONS`. */
  checkForChanges(libraryId: number): void {
    this.request({
      libraryId,
      scope: { kind: SCOPE_KINDS.quick, places: [], reason: QUICK_SCAN_REASONS.check },
    })
  }

  /**
   * A quick scan the admin asked for: it shows its progress through the
   * matching of the videos it added, and returns the status.
   */
  quickScanNow(libraryId: number): ScanStatus {
    this.request({
      libraryId,
      scope: { kind: SCOPE_KINDS.quick, places: [], reason: QUICK_SCAN_REASONS.asked },
    })
    return this.status(libraryId)
  }

  /** Looks again at just the places that changed, after any scan of the library under way. */
  refresh({ libraryId, places }: ScannerServiceRefreshProps): void {
    this.request({ libraryId, scope: { kind: SCOPE_KINDS.places, places: outermost(places) } })
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

  private update({ libraryId, patch }: ScannerServiceUpdateProps): void {
    this.statuses.set(libraryId, { ...this.status(libraryId), ...patch })
  }

  /**
   * A library scans one thing at a time. An idle one starts at once, so its
   * status says scanning straight away; a busy one keeps the request for
   * after, merged with whatever else waits.
   */
  private request({ libraryId, scope }: ScannerServiceRequestProps): void {
    const slot = this.slots.get(libraryId)
    if (slot) {
      slot.next = mergeScopes({ waiting: slot.next, scope })
      return
    }
    this.start({ libraryId, scope })
  }

  private start({ libraryId, scope }: ScannerServiceStartProps): void {
    const abort = new AbortController()
    const running = this.run({ libraryId, scope, signal: abort.signal })
      .catch((error: unknown) => this.logger.error(`Scan failed: ${errorMessage(error)}`))
      .then(() => this.startNext(libraryId))
    this.slots.set(libraryId, { running, next: null, abort })
  }

  /**
   * Stops the scan running now and drops the one waiting behind it. The walk
   * and the probes end at their next step, so the status says scanning until
   * they have; a full scan leaves its last finished time as it was.
   */
  cancel(libraryId: number): ScanStatus {
    const slot = this.slots.get(libraryId)
    if (slot) {
      slot.next = null
      slot.abort.abort()
    }
    return this.status(libraryId)
  }

  /** The scan that waited, if any, now takes its turn. */
  private startNext(libraryId: number): void {
    const next = this.slots.get(libraryId)?.next
    if (next) this.start({ libraryId, scope: next })
    else this.slots.delete(libraryId)
  }

  private async run({ libraryId, scope, signal }: ScannerServiceRunProps): Promise<void> {
    const library = this.libraries.get(libraryId)
    if (!library) return
    switch (scope.kind) {
      case SCOPE_KINDS.library:
        return this.scanLibrary({ library, signal })
      case SCOPE_KINDS.quick:
        return this.quickScanLibrary({
          library,
          places: scope.places,
          reason: scope.reason,
          signal,
        })
      case SCOPE_KINDS.places:
        return this.refreshPlaces({ library, places: scope.places, signal })
      default: {
        const unknown: never = scope
        return unknown
      }
    }
  }

  /** A full scan: everything under the library's paths, its progress and outcome in the status. */
  private async scanLibrary({ library, signal }: ScannerServiceScanLibraryProps): Promise<void> {
    const before = this.status(library.id)
    this.update({
      libraryId: library.id,
      patch: {
        state: SCAN_STATES.walking,
        kind: SCAN_KINDS.full,
        found: 0,
        processed: 0,
        startedAt: new Date().toISOString(),
        finishedAt: null,
        error: null,
      },
    })
    try {
      const { walk, changes, toProbe, media } = await this.reindex({
        library,
        scope: { kind: SCOPE_KINDS.library },
        signal,
        onFound: (count) =>
          this.update({
            libraryId: library.id,
            patch: { found: this.status(library.id).found + count },
          }),
      })
      this.update({
        libraryId: library.id,
        patch: {
          state: SCAN_STATES.indexing,
          found: walk.files.length,
          processed: walk.files.length - toProbe.length,
        },
      })
      await this.probeAndMatch({
        libraryId: library.id,
        media,
        toProbe,
        signal,
        onProbed: () =>
          this.update({
            libraryId: library.id,
            patch: { processed: this.status(library.id).processed + 1 },
          }),
      })
      if (signal.aborted) return this.cancelFullScan({ library, before })
      // Thumbnails that timed out on an earlier pass get another go.
      this.thumbnails.retryPending()

      const unreadable = walk.unreadable.map((place) => `Could not read ${place}.`)
      this.finishFullScan({
        library,
        error: unreadable.length > 0 ? unreadable.join(' ') : null,
      })
      this.logger.log(`Scanned "${library.name}": ${summary({ walk, changes, toProbe })}`)
    } catch (error) {
      if (signal.aborted) return this.cancelFullScan({ library, before })
      this.finishFullScan({ library, error: errorMessage(error) })
      this.logger.error(`Scan of "${library.name}" failed: ${errorMessage(error)}`)
    }
  }

  /** A full scan the admin stopped: idle again, with the last finished scan's time and no error. */
  private cancelFullScan({ library, before }: ScannerServiceCancelFullScanProps): void {
    this.update({
      libraryId: library.id,
      patch: { state: SCAN_STATES.idle, finishedAt: before.finishedAt, error: null },
    })
    this.logger.log(`Scan of "${library.name}" cancelled`)
  }

  /** The full scan is over: its end is remembered, so a restart still says when it was. */
  private finishFullScan({ library, error }: ScannerServiceFinishFullScanProps): void {
    const at = new Date().toISOString()
    this.libraries.markFullScan({ id: library.id, at })
    this.update({
      libraryId: library.id,
      patch: { state: SCAN_STATES.idle, finishedAt: at, error },
    })
  }

  /**
   * A quick scan: every path, reading only the files the index does not
   * know, and those at `places`. The status keeps the last full scan's
   * progress and outcome; only its quick scan time moves on. A quiet one
   * takes the status, and the time, only once it finds something new.
   */
  private async quickScanLibrary({
    library,
    places,
    reason,
    signal,
  }: ScannerServiceQuickScanLibraryProps): Promise<void> {
    const isQuiet = reason === QUICK_SCAN_REASONS.check
    const begin = () =>
      this.update({
        libraryId: library.id,
        patch: {
          state: SCAN_STATES.walking,
          kind: SCAN_KINDS.quick,
          found: 0,
          processed: 0,
          startedAt: new Date().toISOString(),
          error: null,
        },
      })
    if (!isQuiet) begin()
    try {
      const reindexed = await this.reindex({
        library,
        scope: { kind: SCOPE_KINDS.quick, places, reason },
        signal,
        onFound: (count) => {
          if (isQuiet) return
          this.update({
            libraryId: library.id,
            patch: { found: this.status(library.id).found + count },
          })
        },
      })
      const { walk, changes, media } = reindexed
      // A check leaves a probe that timed out to a scan someone starts.
      const retried = new Set(changes.unprobed.map(({ id }) => id))
      const toProbe = isQuiet
        ? reindexed.toProbe.filter(({ id }) => !retried.has(id))
        : reindexed.toProbe
      const isNew = changesAnything(changes) || toProbe.length > 0
      if (isQuiet) {
        if (!isNew) return
        begin()
      }
      this.update({
        libraryId: library.id,
        patch: {
          state: SCAN_STATES.indexing,
          found: walk.files.length,
          processed: walk.files.length - toProbe.length,
        },
      })
      if (isNew) {
        await this.probeAndMatch({
          libraryId: library.id,
          media,
          toProbe,
          signal,
          onProbed: () =>
            this.update({
              libraryId: library.id,
              patch: { processed: this.status(library.id).processed + 1 },
            }),
        })
      }
      // A cancelled scan did not finish, so its time stands.
      if (signal.aborted) return
      // A path it could not read (a share that is down) leaves the scan unfinished, so the time stands.
      if (walk.unreadable.length > 0) {
        this.logger.warn(
          `Quick scan of "${library.name}" could not read ${walk.unreadable.join(', ')}`,
        )
        return
      }
      if (isNew && reason === QUICK_SCAN_REASONS.asked) {
        this.update({ libraryId: library.id, patch: { state: SCAN_STATES.matching } })
        await untilAborted({ signal, until: this.metadata.whenIdle() })
        if (signal.aborted) return
      }
      const at = new Date().toISOString()
      this.libraries.markQuickScan({ id: library.id, at })
      this.update({ libraryId: library.id, patch: { quickScannedAt: at } })
      this.logger.log(`Quick scan of "${library.name}": ${summary({ walk, changes, toProbe })}`)
    } catch (error) {
      if (signal.aborted) return
      this.logger.warn(`Quick scan of "${library.name}" failed: ${errorMessage(error)}`)
    } finally {
      this.update({ libraryId: library.id, patch: { state: SCAN_STATES.idle } })
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
    signal,
  }: ScannerServiceRefreshPlacesProps): Promise<void> {
    try {
      const { walk, changes, toProbe, media } = await this.reindex({
        library,
        scope: { kind: SCOPE_KINDS.places, places },
        signal,
      })
      if (!changesAnything(changes) && toProbe.length === 0) return
      await this.probeAndMatch({
        libraryId: library.id,
        media,
        toProbe,
        signal,
        onProbed: () => undefined,
      })
      if (signal.aborted) return
      this.logger.log(`Refreshed "${library.name}": ${summary({ walk, changes, toProbe })}`)
    } catch (error) {
      if (signal.aborted) return
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
  private async reindex({ library, scope, signal, onFound }: ScannerServiceReindexProps): Promise<{
    walk: WalkResult
    changes: Reconciled
    toProbe: ProbeTarget[]
    /** What the library's files are, as its type says at the moment they are filed. */
    media: MediaType
  }> {
    const indexed = this.index.forLibrary(library.id)
    const walk = await walkVideos({
      roots: library.paths,
      extensions: extensionsFor(library.settings.kind),
      places: scope.kind === SCOPE_KINDS.places ? scope.places : library.paths,
      signal,
      onFound,
      known:
        scope.kind === SCOPE_KINDS.quick
          ? knownOutside({ indexed, places: scope.places })
          : undefined,
    })
    signal.throwIfAborted()
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
    if (scope.kind === SCOPE_KINDS.library) {
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
    return { walk, changes, toProbe, media: KIND_RULES[kind].media }
  }

  /** A video goes to ffprobe and the thumbnail queue; an audio file to the music indexer, which grabs no frame. */
  private async probeOne({
    libraryId,
    media,
    id,
    path,
  }: ScannerServiceProbeOneProps): Promise<void> {
    switch (media) {
      case MEDIA_TYPES.video: {
        const { probe, tracks, chapters } = await this.ffmpeg.probeFile(path)
        this.index.saveProbe({ id, probe, tracks, chapters })
        this.thumbnails.enqueue(id)
        return
      }
      case MEDIA_TYPES.audio:
        return this.music.index({ id, libraryId, path })
      default: {
        const unknown: never = media
        return unknown
      }
    }
  }

  /**
   * Probes the files and queues the library's matching around it: a video
   * library's before, since matching films needs only names, so new files
   * are matched while they are probed; an audio library's after, since its
   * albums come from the tags the probe reads. The files that went are
   * cleared up by the pass either way.
   */
  private async probeAndMatch(props: ScannerServiceProbeProps): Promise<void> {
    switch (props.media) {
      case MEDIA_TYPES.video:
        this.metadata.enqueue(props.libraryId)
        return this.probe(props)
      case MEDIA_TYPES.audio:
        await this.probe(props)
        // A cancelled scan leaves its albums pending for the next one.
        if (!props.signal.aborted) this.metadata.enqueue(props.libraryId)
        return
      default: {
        const unknown: never = props.media
        return unknown
      }
    }
  }

  /** Probes each file a few at a time. A timeout leaves the file unprobed, so the next scan tries it again. */
  private async probe({
    libraryId,
    media,
    toProbe,
    signal,
    onProbed,
  }: ScannerServiceProbeProps): Promise<void> {
    await mapWithConcurrency({
      items: toProbe,
      limit: this.config.probeConcurrency,
      fn: async ({ id, path }) => {
        if (signal.aborted) return
        try {
          await this.probeOne({ libraryId, media, id, path })
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
