import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common'
import {
  isMatchedKind,
  type LibraryKind,
  MATCHED_KINDS as MATCHED_LIBRARY_KINDS,
  type MatchedKind,
  type MetadataHealth,
} from '@raven/core'
import { groupBy } from '@/groupBy'
import { LibrariesRepository } from '@/libraries/librariesRepository'
import { ItemPictures } from '@/metadata/itemPictures'
import { type FixMatchChoice, type MatchFile, MatchFiles } from '@/metadata/matchFiles'
import { createMatchers, type KindMatcher } from '@/metadata/matchers'
import { MatchPass } from '@/metadata/matchPass'
import { MetadataRepository } from '@/metadata/metadataRepository'
import { OmdbClient } from '@/metadata/omdbClient'
import { OmdbScores } from '@/metadata/omdbScores'
import { PASS_CONCURRENCY } from '@/metadata/passGuard'
import { showPlace } from '@/metadata/places'
import { TmdbClient } from '@/metadata/tmdbClient'
import { createTaskQueue, mapWithConcurrency } from '@/scanner/concurrency'

/**
 * The library types whose files get matched, typed wide for callers that ask
 * of any library's type. `isMatchedKind` from `@raven/core` narrows instead.
 */
export const MATCHED_KINDS: readonly LibraryKind[] = MATCHED_LIBRARY_KINDS

/**
 * Matches the files in Movies and TV shows libraries to TMDB, one library
 * pass at a time, in the background. A Fix match wins, then an id in a name
 * or NFO, then a search by title and year that only takes a sure answer.
 * Items are shared, so a second file of the same movie costs a search and
 * no fetch; a show is matched once per show folder, and each season fetched
 * once. Every pass ends by removing items, people and pictures nothing uses
 * any more. Its queue runs one piece of metadata work at a time, the sweep
 * `ItemRefresher` schedules included.
 */
@Injectable()
export class MetadataService implements OnApplicationBootstrap {
  private readonly logger = new Logger(MetadataService.name)
  private readonly queue = createTaskQueue({ concurrency: 1 })
  private readonly matchers: Record<MatchedKind, KindMatcher>

  constructor(
    @Inject(LibrariesRepository) private readonly libraries: LibrariesRepository,
    @Inject(MatchFiles) private readonly files: MatchFiles,
    @Inject(MetadataRepository) private readonly metadata: MetadataRepository,
    @Inject(TmdbClient) private readonly tmdb: TmdbClient,
    @Inject(OmdbClient) private readonly omdb: OmdbClient,
    @Inject(OmdbScores) private readonly scores: OmdbScores,
    @Inject(ItemPictures) private readonly pictures: ItemPictures,
  ) {
    this.matchers = createMatchers({ files, metadata, pictures })
  }

  /** Names indexed before they were parsed are read again, and every matched library gets a pass for what is pending. */
  onApplicationBootstrap(): void {
    this.metadata.resortTitles()
    this.libraries.list().forEach((library) => {
      const { kind } = library.settings
      if (!isMatchedKind(kind)) return
      this.files.retitle({ libraryId: library.id, kind })
      this.enqueue(library.id)
    })
  }

  /** Queues a pass over the library: its pending files, then the clear-up. */
  enqueue(libraryId: number): void {
    this.queue.push(`library:${libraryId}`, () => this.pass(libraryId))
  }

  /** Queues other metadata work, so it never runs beside a pass. */
  schedule({ key, task }: { key: string; task: () => Promise<void> }): void {
    this.queue.push(key, task)
  }

  /**
   * Searches TMDB again for a library's files no movie or show was found
   * for, say after a rename or once TMDB lists a new show; Fix match choices
   * stay. How many files are queued.
   */
  retryUnmatched(libraryId: number): number {
    const kind = this.libraries.get(libraryId)?.settings.kind
    const count = this.files.retryUnmatched(libraryId)
    if (count === 0 || kind == null) return count
    // Names are read again first, so a parser that now reads the name right gets its say.
    this.files.retitle({ libraryId, kind })
    // A pass already running has tried these files, so another follows it.
    this.queue.again(`library:${libraryId}`, () => this.pass(libraryId))
    return count
  }

  /**
   * A library's type changed: every file's name is read again for the new
   * type and matched from scratch, or left off for Other.
   */
  changeKind({ libraryId, kind }: { libraryId: number; kind: LibraryKind }): void {
    this.queue.push(`kind:${libraryId}:${kind}`, async () => {
      this.files.rename({ libraryId, kind })
      await this.pass(libraryId)
    })
  }

  whenIdle(): Promise<void> {
    return this.queue.idle()
  }

  health(): MetadataHealth {
    const tmdb = this.tmdb.state()
    return {
      tmdb: tmdb.state,
      omdb: this.omdb.state().state,
      pending: this.files.countPending(MATCHED_KINDS),
      error: tmdb.error,
      lastOk: tmdb.lastOk,
    }
  }

  private newPass(): MatchPass {
    return new MatchPass({
      tmdb: this.tmdb,
      metadata: this.metadata,
      files: this.files,
      scores: this.scores,
      logger: this.logger,
    })
  }

  private async pass(libraryId: number): Promise<void> {
    const kind = this.libraries.get(libraryId)?.settings.kind
    if (kind != null && isMatchedKind(kind) && this.tmdb.enabled) {
      this.tmdb.newPass()
      await this.matchPending({ libraryId, kind })
    }
    await this.pictures.clearUp()
  }

  /** Matches the library's pending files, and any that turn up while it runs. */
  private async matchPending({
    libraryId,
    kind,
  }: {
    libraryId: number
    kind: MatchedKind
  }): Promise<void> {
    const pass = this.newPass()
    const matcher = this.matchers[kind]
    const attempted = new Set<number>()
    const round = async (): Promise<void> => {
      const files = this.files.pending(libraryId).filter((file) => !attempted.has(file.id))
      if (files.length === 0 || pass.guard.isStopped) return
      files.forEach((file) => attempted.add(file.id))
      await mapWithConcurrency({
        items: matcher.groups(files),
        limit: PASS_CONCURRENCY,
        fn: (group) => pass.guard.run(() => matcher.match({ files: group, pass })),
      })
      return round()
    }
    await round()
    pass.guard.reportStop()
  }

  /**
   * Keeps a Fix match for a place, and matches the files it covers again
   * from scratch, as one group, with a fresh pass.
   */
  private async pointPlace({
    libraryId,
    kind,
    place,
    fix,
    files,
  }: {
    libraryId: number
    kind: MatchedKind
    place: string
    fix: FixMatchChoice
    files: readonly MatchFile[]
  }): Promise<void> {
    this.files.saveFixMatch({ libraryId, place, fix })
    if (files.length === 0) return
    this.files.reset(files.map((file) => file.id))
    await this.matchers[kind].match({ files, pass: this.newPass() })
  }

  /**
   * Fix match: points a file, and the files kept with it (a movie's folder,
   * or a show's whole folder), at a TMDB movie or show, or at nothing for
   * `null`, and keeps that by place so renames and re-downloads keep it. A
   * file outside a Movies or TV shows library is left as it is.
   */
  async fixMatch({ mediaId, tmdbId }: { mediaId: number; tmdbId: string | null }): Promise<void> {
    const file = this.files.byId(mediaId)
    const kind = file == null ? null : this.libraries.get(file.libraryId)?.settings.kind
    if (file == null || kind == null || !isMatchedKind(kind)) return
    const group = this.matchers[kind].fixGroup(file)
    await this.pointPlace({
      libraryId: file.libraryId,
      kind,
      place: group.place,
      fix: tmdbId == null ? { kind: 'not-a-match' } : { kind: 'tmdb', tmdbId },
      files: group.files,
    })
    await this.pictures.clearUp()
  }

  /**
   * Fix match for a show: every file under it, in every library, moves to
   * the show with `tmdbId`, keeping its numbers. Answers with the stored id
   * of the show they moved to, or null when TMDB has no such show.
   */
  async fixShowMatch({
    showId,
    tmdbId,
  }: {
    showId: number
    tmdbId: string
  }): Promise<number | null> {
    const groups = [
      ...groupBy({
        items: this.files.under(showId),
        key: (file) => `${file.libraryId}|${showPlace(file)}`,
      }).values(),
    ].flatMap((files) => {
      const [first] = files
      return first ? [{ first, files }] : []
    })
    await groups.reduce<Promise<void>>(
      (previous, { first, files }) =>
        previous.then(() =>
          this.pointPlace({
            libraryId: first.libraryId,
            kind: 'shows',
            place: showPlace(first),
            fix: { kind: 'tmdb', tmdbId },
            files,
          }),
        ),
      Promise.resolve(),
    )
    await this.pictures.clearUp()
    return this.metadata.find({ type: 'show', tmdbId })?.id ?? null
  }
}
