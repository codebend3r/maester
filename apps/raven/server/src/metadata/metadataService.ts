import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common'
import {
  type AiMatch,
  isMatchItemType,
  type ItemType,
  type LibraryKind,
  MATCHED_KINDS,
  type MatchItemType,
  type MediaItem,
  type MetadataHealth,
  matchTypeFor,
  tiersFor,
  type UnmatchedFile,
  ITEM_TYPES,
  MATCH_STATES,
} from '@raven/core'
import { DatabaseService } from '@/db/database'
import { errorMessage } from '@/errorMessage'
import { groupBy } from '@/groupBy'
import { type LibraryRecord, LibrariesRepository } from '@/libraries/librariesRepository'
import { AiClient, AiError } from '@/metadata/aiClient'
import {
  AI_CONFIDENCES,
  AI_OUTCOME_KINDS,
  AiDecisions,
  type DecisionPlace,
} from '@/metadata/aiDecisions'
import { AI_CONCURRENCY, aiGroupOf, AiMatcher } from '@/metadata/aiMatcher'
import { ItemPictures } from '@/metadata/itemPictures'
import {
  FIX_MATCH_KINDS,
  type FixMatchChoice,
  type MatchFile,
  MatchFiles,
} from '@/metadata/matchFiles'
import { createMatchers, type KindMatcher } from '@/metadata/matchers'
import { MatchPass } from '@/metadata/matchPass'
import { MdblistClient } from '@/metadata/mdblistClient'
import { MetadataRepository } from '@/metadata/metadataRepository'
import { OmdbClient } from '@/metadata/omdbClient'
import { PASS_CONCURRENCY } from '@/metadata/passGuard'
import { filePlace, groupPlaceOf, showPlace } from '@/metadata/places'
import { Scores } from '@/metadata/scores'
import { ScoreSweep } from '@/metadata/scoreSweep'
import { TmdbClient } from '@/metadata/tmdbClient'
import { createTaskQueue, mapWithConcurrency } from '@/scanner/concurrency'
import { type LayoutRow, indexedLayoutsOf, planRelayout } from '@/scanner/layout'

type DecisionPlacesOfProps = {
  type: MatchItemType
  file: MatchFile
}

/**
 * Where a matched file's group may keep its decision: a show's folder; a
 * movie's file, or its folder when that holds the one movie. The decision's
 * id must still be the item's, so a folder of several movies never claims one.
 */
const decisionPlacesOf = ({ type, file }: DecisionPlacesOfProps): DecisionPlace[] => {
  if (type === ITEM_TYPES.show) return [{ libraryId: file.libraryId, place: showPlace(file) }]
  return [
    { libraryId: file.libraryId, place: filePlace(file) },
    ...(file.folder === '' ? [] : [{ libraryId: file.libraryId, place: file.folder }]),
  ]
}

type MetadataServiceScheduleProps = { key: string; task: () => Promise<void> }

type MetadataServiceChangeKindProps = { libraryId: number; kind: LibraryKind }

type MetadataServiceChangePreferenceProps = { libraryId: number; kind: LibraryKind }

type MetadataServiceRefreshLayoutsProps = {
  library: LibraryRecord
  rows: readonly LayoutRow[]
}

type MetadataServiceChangeLayoutProps = { libraryId: number }

type MetadataServiceLoggedProps = { what: string; task: () => Promise<void> }

type MetadataServiceWithSuggestionsProps = {
  libraryId: number
  type: MatchItemType
  files: readonly MediaItem[]
}

type MetadataServiceAiMatchForProps = {
  id: number
  type: ItemType
  tmdbId: string
  sees: (libraryId: number) => boolean
}

type MetadataServiceMatchGroupsProps = {
  files: readonly MatchFile[]
  type: MatchItemType
  pass: MatchPass
}

type MetadataServiceMatchPendingProps = {
  libraryId: number
  type: MatchItemType
  pass: MatchPass
}

type MetadataServiceLookUpUnmatchedProps = {
  library: LibraryRecord
  type: MatchItemType
  pass: MatchPass
}

type MetadataServiceLookUpProps = {
  library: LibraryRecord
  type: MatchItemType
  place: string
  files: readonly MatchFile[]
  pass: MatchPass
  lookups: { isHalted: boolean }
}

type MetadataServiceRepickProps = {
  libraryId: number
  kind: LibraryKind
}

type MetadataServicePointPlaceProps = {
  libraryId: number
  kind: LibraryKind
  type: MatchItemType
  place: string
  fix: FixMatchChoice
  files: readonly MatchFile[]
}

type MetadataServiceFixMatchProps = { mediaId: number; tmdbId: string | null }

type MetadataServiceFixShowMatchProps = {
  showId: number
  tmdbId: string
}

/**
 * Matches the files in libraries of movies and shows to TMDB, one library
 * pass at a time, in the background. A Fix match wins, then an id in a name
 * or NFO, then a search by title and year that only takes a sure answer.
 * Items are shared, so a second file of the same movie costs a search and
 * no fetch; a show is matched once per show folder, and each season fetched
 * once. Every pass TMDB does not stop ends by removing items, people and
 * pictures nothing uses any more. Before that, with an AI key, each group a
 * pass left unmatched and never asked about goes to the AI lookup. One
 * queue runs the metadata work a piece at a time, the sweep `ItemRefresher`
 * schedules included.
 */
@Injectable()
export class MetadataService implements OnApplicationBootstrap {
  private readonly logger = new Logger(MetadataService.name)
  private readonly queue = createTaskQueue({ concurrency: 1 })
  private readonly matchers: Record<MatchItemType, KindMatcher>
  /** Each run of AI lookups under way, with how many of its groups wait for or are in one. */
  private readonly lookupRuns = new Set<{ left: number }>()

  constructor(
    @Inject(LibrariesRepository) private readonly libraries: LibrariesRepository,
    @Inject(MatchFiles) private readonly files: MatchFiles,
    @Inject(MetadataRepository) private readonly metadata: MetadataRepository,
    @Inject(TmdbClient) private readonly tmdb: TmdbClient,
    @Inject(OmdbClient) private readonly omdb: OmdbClient,
    @Inject(MdblistClient) private readonly mdblist: MdblistClient,
    @Inject(Scores) private readonly scores: Scores,
    @Inject(ScoreSweep) private readonly scoreSweep: ScoreSweep,
    @Inject(ItemPictures) private readonly pictures: ItemPictures,
    @Inject(AiClient) private readonly ai: AiClient,
    @Inject(AiMatcher) private readonly aiMatcher: AiMatcher,
    @Inject(AiDecisions) private readonly decisions: AiDecisions,
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {
    this.matchers = createMatchers({ files, metadata, pictures, decisions })
  }

  /**
   * Files filed under another folder layout, or indexed before letter
   * folders were read, are placed again; names indexed before they were
   * parsed are read again; and every matched library gets a pass for what is
   * pending.
   */
  onApplicationBootstrap(): void {
    this.metadata.resortTitles()
    this.libraries.list().forEach((library) => {
      try {
        this.relayoutNow(library.id)
      } catch (error) {
        this.logger.error(
          `Could not place the files of "${library.name}" again: ${errorMessage(error)}`,
        )
      }
      const { kind } = library.settings
      if (matchTypeFor(kind) == null) return
      this.files.retitle({ libraryId: library.id, kind })
      this.enqueue(library.id)
    })
  }

  /**
   * Queues a pass over the library: its pending files, then the clear-up. A
   * pass under way may be past reading them (its AI lookups can take
   * minutes), so another follows it.
   */
  enqueue(libraryId: number): void {
    this.queue.again({ key: `library:${libraryId}`, task: () => this.pass(libraryId) })
  }

  /** Queues other metadata work, so it never runs beside a pass. */
  schedule({ key, task }: MetadataServiceScheduleProps): void {
    this.queue.push({ key, task })
  }

  /**
   * Searches TMDB again for a library's files no movie or show was found
   * for, say after a rename or once TMDB lists a new show; Fix match choices
   * stay. The AI lookup asks again about the groups it chose no id for. How
   * many files are queued.
   */
  retryUnmatched(libraryId: number): number {
    // The lookups that chose no id are asked again with the files.
    this.decisions.clearUndecided(libraryId)
    const kind = this.libraries.get(libraryId)?.settings.kind
    const count = this.files.retryUnmatched(libraryId)
    if (count === 0 || kind == null) return count
    // Names are read again first, so a parser that now reads the name right gets its say.
    this.files.retitle({ libraryId, kind })
    // A pass already running has tried these files, so another follows it.
    this.queue.again({ key: `library:${libraryId}`, task: () => this.pass(libraryId) })
    return count
  }

  /**
   * A library's type changed to one that reads its files another way: every
   * file's name is read again for the new type and matched from scratch, or
   * left off for a type that is not matched. Fix match choices stay.
   */
  changeKind({ libraryId, kind }: MetadataServiceChangeKindProps): void {
    this.queue.again({
      key: `kind:${libraryId}:${kind}`,
      task: this.logged({
        what: `type change of library ${libraryId}`,
        task: async () => {
          // Claude was told the old type, and the places may mean other groups now.
          this.decisions.forget(libraryId)
          this.relayoutNow(libraryId)
          this.files.rename({ libraryId, kind })
          await this.pass(libraryId)
        },
      }),
    })
  }

  /**
   * A library's type changed to one that reads its files the same way but
   * prefers other results: each matched file is picked again where it
   * stands, so one that keeps its movie or show keeps its link and split,
   * and its card stays up meanwhile. The files no movie or show was found
   * for are searched again, and Fix match choices stay. The AI lookup's sure
   * picks stay too; where it was unsure or chose nothing, it is asked again.
   */
  changePreference({ libraryId, kind }: MetadataServiceChangePreferenceProps): void {
    this.queue.again({
      key: `prefer:${libraryId}:${kind}`,
      task: this.logged({
        what: `type change of library ${libraryId}`,
        task: async () => {
          // Forgetting a sure pick would unlink its group, and the clear-up could
          // delete the item, edits and all, before a new lookup was sure.
          this.decisions.forgetUnsure(libraryId)
          // The layout saved with this change is read even when the type moved on since.
          this.relayoutNow(libraryId)
          // A type changed again since then is matched by the change queued after this one.
          if (this.libraries.get(libraryId)?.settings.kind !== kind) return
          this.files.retryUnmatched(libraryId)
          await this.repick({ libraryId, kind })
          await this.pass(libraryId)
        },
      }),
    })
  }

  /**
   * Reads where each of a library's files sits again, for its type and
   * folder layout: what each of its paths is, and the folders of the files
   * that changed.
   */
  private relayoutNow(libraryId: number): void {
    const library = this.libraries.get(libraryId)
    if (!library) return
    const rows = this.files.layoutRows(libraryId)
    this.refreshLayouts({ library, rows })
    const plan = planRelayout({
      rows,
      roots: library.paths,
      kind: library.settings.kind,
      layout: library.settings.folderLayout,
      overrides: this.files.overridePlaces(libraryId),
    })
    if (plan.moves.length === 0) return
    this.files.applyRelayout({ libraryId, kind: library.settings.kind, plan })
    // The decisions were kept by the old places.
    this.decisions.forget(libraryId)
    this.logger.log(
      `Placed ${plan.moves.length} files of "${library.name}" again for its folder layout`,
    )
  }

  /**
   * What each of a library's paths is, read again from the files the index
   * holds under it, as a layout change runs no scan. Nothing is written when
   * nothing changed, so a steady boot writes nothing.
   */
  private refreshLayouts({ library, rows }: MetadataServiceRefreshLayoutsProps): void {
    const layouts = indexedLayoutsOf({
      rows,
      roots: library.paths,
      kind: library.settings.kind,
      layout: library.settings.folderLayout,
    })
    const isSaved = layouts.every((fresh) =>
      library.layouts.some(
        (saved) =>
          saved.path === fresh.path &&
          saved.layout === fresh.layout &&
          saved.groups === fresh.groups,
      ),
    )
    if (isSaved) return
    this.libraries.saveLayouts({ id: library.id, layouts })
  }

  /**
   * A library's folder layout changed: its files are read again and matched
   * where they regrouped. A change made while one is read runs again after
   * it, which reads the settings as they are then.
   */
  changeLayout({ libraryId }: MetadataServiceChangeLayoutProps): void {
    this.queue.again({
      key: `layout:${libraryId}`,
      task: this.logged({
        what: `layout change of library ${libraryId}`,
        task: async () => {
          this.relayoutNow(libraryId)
          await this.pass(libraryId)
        },
      }),
    })
  }

  /** The queue drops a task that throws without a word, so a failure is logged here. */
  private logged({ what, task }: MetadataServiceLoggedProps): () => Promise<void> {
    return async () => {
      try {
        await task()
      } catch (error) {
        this.logger.error(`The ${what} failed: ${errorMessage(error)}`)
      }
    }
  }

  whenIdle(): Promise<void> {
    return this.queue.idle()
  }

  health(): MetadataHealth {
    const tmdb = this.tmdb.state()
    return {
      tmdb: tmdb.state,
      omdb: this.omdb.state(),
      mdblist: this.mdblist.state(),
      pending: this.files.countPending(MATCHED_KINDS),
      error: tmdb.error,
      lastOk: tmdb.lastOk,
      ai: this.ai.state().state,
      aiRemaining: this.ai.remaining(),
      aiPending: [...this.lookupRuns].reduce((sum, run) => sum + run.left, 0),
    }
  }

  /**
   * A library's files not matched, each with what the AI lookup suggests
   * for its group when it was not sure: kept at the place a Fix match on the
   * file would be. A pending file has none yet.
   */
  withSuggestions({
    libraryId,
    type,
    files,
  }: MetadataServiceWithSuggestionsProps): UnmatchedFile[] {
    const placed = files.map((file) => ({
      file,
      place:
        file.match === MATCH_STATES.unmatched
          ? groupPlaceOf({
              type,
              file,
              folderFiles: () => this.files.inFolder({ libraryId, folder: file.folder }),
            })
          : null,
    }))
    const suggestions = this.decisions.suggestionsAt({
      libraryId,
      places: placed.flatMap(({ place }) => place ?? []),
    })
    return placed.map(({ file, place }) => ({
      ...file,
      aiSuggestion: place == null ? null : (suggestions.get(place) ?? null),
    }))
  }

  /**
   * Why the AI lookup matched a movie or show, being sure: its reason, when
   * one of the item's files that `sees` lets through is `matched` (not by
   * Fix match) and a sure decision for that file's group chose the item.
   * Null otherwise, and for a season or episode.
   */
  aiMatchFor({ id, type, tmdbId, sees }: MetadataServiceAiMatchForProps): AiMatch | null {
    if (!isMatchItemType(type)) return null
    const places = [
      ...new Map(
        this.files
          .under(id)
          .filter((file) => file.match === MATCH_STATES.matched && sees(file.libraryId))
          .flatMap((file) => decisionPlacesOf({ type, file }))
          .map((place) => [`${place.libraryId}|${place.place}`, place] as const),
      ).values(),
    ]
    const reason = this.decisions.highReason({ places, tmdbId })
    return reason == null ? null : { reason }
  }

  /** A pass for a library of `kind`, whose searches prefer that type's results. */
  private newPass(kind: LibraryKind): MatchPass {
    return new MatchPass({
      tmdb: this.tmdb,
      metadata: this.metadata,
      files: this.files,
      scores: this.scores,
      logger: this.logger,
      prefer: tiersFor(kind),
    })
  }

  /**
   * A pass, after which the planner's statistics follow what it stored and
   * cleared up: a library's first can add thousands of items, credits and
   * people. A pass TMDB stopped ends here too, with what it stored by then.
   * The score sweep then looks for what the pass left due, such as the
   * titles matched after a score source's day ran out, and sets its wake.
   */
  private async pass(libraryId: number): Promise<void> {
    await this.matchAndClearUp(libraryId)
    this.database.refreshStatistics()
    this.scoreSweep.kick()
  }

  private async matchAndClearUp(libraryId: number): Promise<void> {
    const library = this.libraries.get(libraryId)
    const kind = library?.settings.kind
    const type = kind == null ? null : matchTypeFor(kind)
    if (library != null && kind != null && type != null && this.tmdb.enabled) {
      this.tmdb.newPass()
      const pass = this.newPass(kind)
      const isStopped = await this.matchPending({ libraryId, type, pass })
      // The items of files still waiting for TMDB stay, with their edits and
      // pictures, until a pass that gets through matches the files to them
      // again. A library removed meanwhile is cleared up all the same.
      if (isStopped && this.libraries.get(libraryId) != null) return
      await this.lookUpUnmatched({ library, type, pass })
      // A lookup that found TMDB away stops the pass the same way.
      if (pass.guard.isStopped && this.libraries.get(libraryId) != null) return
    }
    await this.pictures.clearUp()
  }

  /** Matches `files` in the units the matcher keeps together, a few at once, until TMDB stops the pass. */
  private async matchGroups({ files, type, pass }: MetadataServiceMatchGroupsProps): Promise<void> {
    const matcher = this.matchers[type]
    await mapWithConcurrency({
      items: matcher.groups(files),
      limit: PASS_CONCURRENCY,
      fn: (group) => pass.guard.run(() => matcher.match({ files: group, pass })),
    })
  }

  /**
   * Matches the library's pending files with `pass`, and any that turn up
   * while it runs. Whether TMDB went away and stopped it.
   */
  private async matchPending({
    libraryId,
    type,
    pass,
  }: MetadataServiceMatchPendingProps): Promise<boolean> {
    const attempted = new Set<number>()
    const round = async (): Promise<void> => {
      const files = this.files.pending(libraryId).filter((file) => !attempted.has(file.id))
      if (files.length === 0 || pass.guard.isStopped) return
      files.forEach((file) => attempted.add(file.id))
      await this.matchGroups({ files, type, pass })
      return round()
    }
    await round()
    pass.guard.reportStop()
    return pass.guard.isStopped
  }

  /**
   * Asks the AI lookup about every group the pass left unmatched that has
   * no Fix match and was never asked, two at a time, while today's lookups
   * last. A movie file whose own place has a Fix match is left out, as its
   * matcher reads that before its folder's. Libraries that are never
   * matched never get here.
   */
  private async lookUpUnmatched({
    library,
    type,
    pass,
  }: MetadataServiceLookUpUnmatchedProps): Promise<void> {
    if (!this.ai.enabled || pass.guard.isStopped) return
    const libraryId = library.id
    const unfixed = this.files
      .unmatched(libraryId)
      .filter(
        (file) =>
          type === ITEM_TYPES.show ||
          this.files.fixMatchAt({ libraryId, place: filePlace(file) }).kind ===
            FIX_MATCH_KINDS.none,
      )
    const groups = [
      ...groupBy({
        items: unfixed,
        key: (file) =>
          groupPlaceOf({
            type,
            file,
            folderFiles: () => this.files.inFolder({ libraryId, folder: file.folder }),
          }),
      }),
    ].flatMap(([place, files]) =>
      this.files.fixMatchAt({ libraryId, place }).kind === FIX_MATCH_KINDS.none &&
      !this.decisions.isAsked({ libraryId, place })
        ? [{ place, files }]
        : [],
    )
    const lookups = { isHalted: false }
    // Counted in the health check, so a page showing what the lookups find
    // knows when to read it again. A group skipped once the lookups halt or
    // TMDB stops the pass counts as done at once.
    const run = { left: groups.length }
    this.lookupRuns.add(run)
    try {
      await mapWithConcurrency({
        items: groups,
        limit: AI_CONCURRENCY,
        fn: async ({ place, files }) => {
          await pass.guard.run(() => this.lookUp({ library, type, place, files, pass, lookups }))
          run.left -= 1
        },
      })
    } finally {
      this.lookupRuns.delete(run)
    }
    pass.guard.reportStop()
  }

  /**
   * One lookup: books one of today's, keeps the answer, and matches the
   * group again at once, with the pass's searches, when the pick is sure.
   * Anthropic failing halts the pass's other lookups and keeps nothing, so
   * the group is asked on the next pass; TMDB failing stops the pass.
   */
  private async lookUp({
    library,
    type,
    place,
    files,
    pass,
    lookups,
  }: MetadataServiceLookUpProps): Promise<void> {
    if (lookups.isHalted) return
    // The groups were listed before the lookups began, and the library may
    // have been removed or changed to a type that is not looked up since.
    const current = this.libraries.get(library.id)
    if (current == null || matchTypeFor(current.settings.kind) !== type) return
    if (!this.ai.take()) return
    const outcome = await this.aiMatcher
      .decide(aiGroupOf({ library: current, type, place, files }))
      .catch((error: unknown) => {
        if (!(error instanceof AiError)) throw error
        lookups.isHalted = true
        this.logger.warn(`AI lookups stopped for now: ${error.message}`)
        return null
      })
    // A library removed during the lookup keeps no decision.
    if (outcome == null || this.libraries.get(library.id) == null) return
    this.decisions.record({ libraryId: library.id, place, outcome, model: this.aiMatcher.model })
    if (outcome.kind !== AI_OUTCOME_KINDS.chosen || outcome.confidence !== AI_CONFIDENCES.high) {
      return
    }
    // A Fix match made during the lookup has matched the group already, and wins.
    if (this.files.fixMatchAt({ libraryId: library.id, place }).kind !== FIX_MATCH_KINDS.none) {
      return
    }
    this.files.reset(files.map((file) => file.id))
    await this.matchers[type].match({ files, pass })
  }

  /**
   * Matches the library's matched files again with a fresh pass for `kind`,
   * in place: no file loses its link before its new pick replaces it, and a
   * Fix match is never picked again.
   */
  private async repick({ libraryId, kind }: MetadataServiceRepickProps): Promise<void> {
    const type = matchTypeFor(kind)
    if (type == null || !this.tmdb.enabled) return
    this.tmdb.newPass()
    const pass = this.newPass(kind)
    await this.matchGroups({ files: this.files.matched(libraryId), type, pass })
    pass.guard.reportStop()
  }

  /**
   * Keeps a Fix match for a place, and matches the files it covers again
   * from scratch, as one group, with a fresh pass.
   */
  private async pointPlace({
    libraryId,
    kind,
    type,
    place,
    fix,
    files,
  }: MetadataServicePointPlaceProps): Promise<void> {
    this.files.saveFixMatch({ libraryId, place, fix })
    if (files.length === 0) return
    this.files.reset(files.map((file) => file.id))
    await this.matchers[type].match({ files, pass: this.newPass(kind) })
  }

  /**
   * Fix match: points a file, and the files kept with it (a movie's folder,
   * or a show's whole folder), at a TMDB movie or show, or at nothing for
   * `null`, and keeps that by place so renames and re-downloads keep it. A
   * file in a library that is not matched is left as it is.
   */
  async fixMatch({ mediaId, tmdbId }: MetadataServiceFixMatchProps): Promise<void> {
    const file = this.files.byId(mediaId)
    const kind = file == null ? null : this.libraries.get(file.libraryId)?.settings.kind
    const type = kind == null ? null : matchTypeFor(kind)
    if (file == null || kind == null || type == null) return
    const group = this.matchers[type].fixGroup(file)
    await this.pointPlace({
      libraryId: file.libraryId,
      kind,
      type,
      place: group.place,
      fix:
        tmdbId == null
          ? { kind: FIX_MATCH_KINDS.notAMatch }
          : { kind: FIX_MATCH_KINDS.tmdb, tmdbId },
      files: group.files,
    })
    await this.pictures.clearUp()
  }

  /**
   * Fix match for a show: every file under it, in every library, moves to
   * the show with `tmdbId`, keeping its numbers. Answers with the stored id
   * of the show they moved to, or null when TMDB has no such show.
   */
  async fixShowMatch({ showId, tmdbId }: MetadataServiceFixShowMatchProps): Promise<number | null> {
    const groups = [
      ...groupBy({
        items: this.files.under(showId),
        key: (file) => `${file.libraryId}|${showPlace(file)}`,
      }).values(),
    ].flatMap((files) => {
      const [first] = files
      const kind = first == null ? null : this.libraries.get(first.libraryId)?.settings.kind
      // A library whose type changed away from shows has its files unlinked by that change.
      return first != null && kind != null && matchTypeFor(kind) === ITEM_TYPES.show
        ? [{ first, kind, files }]
        : []
    })
    await groups.reduce<Promise<void>>(
      (previous, { first, kind, files }) =>
        previous.then(() =>
          this.pointPlace({
            libraryId: first.libraryId,
            kind,
            type: ITEM_TYPES.show,
            place: showPlace(first),
            fix: { kind: FIX_MATCH_KINDS.tmdb, tmdbId },
            files,
          }),
        ),
      Promise.resolve(),
    )
    await this.pictures.clearUp()
    return this.metadata.find({ type: ITEM_TYPES.show, tmdbId })?.id ?? null
  }
}
