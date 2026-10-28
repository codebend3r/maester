import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  Req,
  ServiceUnavailableException,
} from '@nestjs/common'
import {
  type Duplicates,
  type HistoryEntry,
  type Library,
  type LibraryCounts,
  type LibraryInput,
  type MediaItem,
  type MediaListParams,
  type PosterEntry,
  type Saga,
  type SagaBackdrop,
  type ShowListing,
  isJoinRequest,
  isLibraryHeroChange,
  isLibraryOrder,
  isLibraryViewChange,
  isRecord,
  isSagaBackdrop,
  isSplitRequest,
  matchesAlike,
  matchTypeFor,
  mediaListQuery,
  sagaPictures,
  type UnmatchedFile,
  validateLibraryInput,
  ITEM_TYPES,
  METADATA_SERVICE_STATES,
  SAGA_BACKDROP_TYPES,
} from '@raven/core'
import type { FastifyRequest } from 'fastify'
import { AdminOnly, ForViewers } from '@/admin/adminGuard'
import { Management } from '@/auth/management'
import { type LibraryRecord, LibrariesRepository, samePaths } from '@/libraries/librariesRepository'
import { RatingsRefresh } from '@/libraries/ratingsRefresh'
import { PrivateBy, Public } from '@/lock/lockGuard'
import { LockService } from '@/lock/lockService'
import { MediaArtifacts } from '@/media/mediaArtifacts'
import { MediaIndex } from '@/media/mediaIndex'
import { MediaRepository } from '@/media/mediaRepository'
import { MovieSplits } from '@/media/movieSplits'
import { SagaBackdrops } from '@/media/sagaBackdrops'
import { ViewingAccounts } from '@/media/viewingAccounts'
import { ViewingRepository } from '@/media/viewingRepository'
import { MetadataService } from '@/metadata/metadataService'
import { parseBody } from '@/parseBody'
import { LibraryWatcher } from '@/scanner/libraryWatcher'
import { ScannerService } from '@/scanner/scannerService'
import { ROUTE_PARAMS } from '@/requestParts'

const parseInput = (body: unknown): LibraryInput => {
  const result = validateLibraryInput(body)
  if (!result.ok) throw new BadRequestException(result.errors)
  return result.value
}

/** A listing's search, sort and seed, read as the client's `mediaListQuery.encode` wrote them. */
const listParams = (query: unknown): MediaListParams =>
  mediaListQuery.decode(isRecord(query) ? query : {})

/** A locked library's scan failure, in place of the message, which names its folders. */
export const LOCKED_SCAN_ERROR = 'The last scan ran into trouble. Enter the PIN to see what.'

/** A scan's failure for a viewer the admin lock holds, so who may not see the folders it names. */
export const HIDDEN_SCAN_ERROR =
  'The last scan ran into trouble. Turn the admin lock off in Settings to see what.'

/** A scan's failure for a member once accounts are on: only the owner sees the folders it names. */
export const OWNER_SCAN_ERROR = 'The last scan ran into trouble. Only the owner can see what.'

/** What a query flag such as `?watched=true` says when it is on. */
const QUERY_FLAGS = { true: 'true' } as const

/** How many history entries a request gets unless it asks, and the most it may ask for. */
const HISTORY_LIMIT = { fallback: 100, most: 500 }

const historyLimit = (asked: string | undefined): number => {
  const limit = Number.parseInt(asked ?? '', 10)
  return Number.isInteger(limit)
    ? Math.min(Math.max(limit, 1), HISTORY_LIMIT.most)
    : HISTORY_LIMIT.fallback
}

/** Whether the library's files are matched to movies: only such a library has sagas and duplicates. */
const isMovieLibrary = (record: LibraryRecord): boolean =>
  matchTypeFor(record.settings.kind) === ITEM_TYPES.movie

type LibrariesControllerWithStatusProps = {
  record: LibraryRecord
  canSee: boolean
  isAdmin: boolean
}

type LibrariesControllerSagasOfProps = { id: number; request: FastifyRequest }

type LibrariesControllerCommandedProps = { id: number; act: (id: number) => void }

@Controller('api/libraries')
@PrivateBy('library')
export class LibrariesController {
  constructor(
    @Inject(LibrariesRepository) private readonly libraries: LibrariesRepository,
    @Inject(MediaRepository) private readonly media: MediaRepository,
    @Inject(MovieSplits) private readonly splits: MovieSplits,
    @Inject(SagaBackdrops) private readonly sagaBackdrops: SagaBackdrops,
    @Inject(ViewingRepository) private readonly viewing: ViewingRepository,
    @Inject(MediaIndex) private readonly index: MediaIndex,
    @Inject(MediaArtifacts) private readonly artifacts: MediaArtifacts,
    @Inject(ScannerService) private readonly scanner: ScannerService,
    @Inject(MetadataService) private readonly metadata: MetadataService,
    @Inject(LibraryWatcher) private readonly watcher: LibraryWatcher,
    @Inject(LockService) private readonly lock: LockService,
    @Inject(Management) private readonly management: Management,
    @Inject(RatingsRefresh) private readonly ratings: RatingsRefresh,
    @Inject(ViewingAccounts) private readonly accounts: ViewingAccounts,
  ) {}

  /** A library can only be locked behind a PIN that can open it again. */
  private parseLockable(body: unknown): LibraryInput {
    const input = parseInput(body)
    if (input.settings?.locked && !this.lock.available) {
      throw new BadRequestException("Set LIBRARY_PIN in raven's .env to lock a library.")
    }
    return input
  }

  /**
   * A library as a client sees it: its scan's live status, where its
   * Refresh stands, and its newest video's picture. Without `canSee` a
   * library still locked to the caller keeps its folders, its picture and
   * what its last scan said about them (which names the folders) to itself,
   * and shows only its name, type, counts and Refresh. Without `isAdmin`,
   * which is whoever may manage raven, no library shows its
   * folders or the scan failure that names them. Every route says which:
   * the public ones ask the lock, while the guarded ones, and creating a
   * library, pass true, as whoever reaches them sees it all.
   */
  private withStatus({ record, canSee, isAdmin }: LibrariesControllerWithStatusProps): Library {
    const scan = this.scanner.status(record.id)
    const ratingsRefresh = this.ratings.status(record.id)
    if (canSee && isAdmin) {
      return { ...record, scan, ratingsRefresh, backdrop: this.media.backdropOf(record.id) }
    }
    const unmanagedError = this.management.isLegacy() ? HIDDEN_SCAN_ERROR : OWNER_SCAN_ERROR
    const hiddenError = canSee ? unmanagedError : LOCKED_SCAN_ERROR
    return {
      ...record,
      paths: [],
      layouts: [],
      scan: { ...scan, error: scan.error == null ? null : hiddenError },
      ratingsRefresh,
      backdrop: canSee ? this.media.backdropOf(record.id) : null,
    }
  }

  /** A library as whoever may manage raven sees it: folders, picture and scan failure included. */
  private managed(record: LibraryRecord): Library {
    return this.withStatus({ record, canSee: true, isAdmin: true })
  }

  private find(id: number): LibraryRecord {
    const record = this.libraries.get(id)
    if (!record) throw new NotFoundException(`No library ${id}`)
    return record
  }

  /** An admin's command on a library: `act` runs once the library is found, and the answer is the library as the admin sees it. */
  private commanded({ id, act }: LibrariesControllerCommandedProps): Library {
    const record = this.find(id)
    act(id)
    return this.managed(record)
  }

  /** Every library, but a locked one the viewer may not see: all of them unless the caller can manage. */
  @Public()
  @Get()
  list(@Req() request: FastifyRequest): Library[] {
    const viewer = this.lock.viewer({ request })
    return this.libraries
      .list()
      .filter((record) => viewer.listsLibrary(record.id))
      .map((record) =>
        this.withStatus({
          record,
          canSee: viewer.seesLibrary(record.id),
          isAdmin: this.management.canManage({ request }),
        }),
      )
  }

  /**
   * Every library shows in the side menu, locked or not, so its own settings
   * do too; to a caller who cannot manage, a locked one is not there at all.
   */
  @Public()
  @Get(':id')
  get(@Param(ROUTE_PARAMS.id, ParseIntPipe) id: number, @Req() request: FastifyRequest): Library {
    const record = this.find(id)
    const viewer = this.lock.viewer({ request })
    if (!viewer.listsLibrary(id)) throw new NotFoundException(`No library ${id}`)
    return this.withStatus({
      record,
      canSee: viewer.seesLibrary(id),
      isAdmin: this.management.canManage({ request }),
    })
  }

  /** Creating a library starts its first scan; the response already reports it as scanning. */
  @Public()
  @AdminOnly()
  @Post()
  create(@Body() body: unknown): Library {
    const record = this.libraries.create(this.parseLockable(body))
    this.scanner.scan(record.id)
    this.watcher.sync()
    return this.managed(record)
  }

  /**
   * Only a change of folders rescans. A change of type that reads files
   * another way, or of folder layout, reads them again and matches what
   * regrouped; one that only prefers other results picks each file again
   * where it stands. A rename or another setting, the lock included, leaves
   * the index as it is.
   */
  @AdminOnly()
  @Put(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() body: unknown): Library {
    const before = this.find(id)
    const input = this.parseLockable(body)
    const record = this.libraries.update({ id, input })
    if (!record) throw new NotFoundException(`No library ${id}`)
    const { kind } = record.settings
    if (matchTypeFor(before.settings.kind) !== matchTypeFor(kind)) {
      this.metadata.changeKind({ libraryId: id, kind })
    } else if (!matchesAlike({ before: before.settings.kind, after: kind })) {
      this.metadata.changePreference({ libraryId: id, kind })
    } else if (before.settings.folderLayout !== record.settings.folderLayout) {
      this.metadata.changeLayout({ libraryId: id })
    }
    if (!samePaths({ before: before.paths, after: record.paths })) this.scanner.scan(id)
    this.watcher.sync()
    return this.managed(record)
  }

  /**
   * How a library is sorted, viewed and grouped, and its pin, which anyone
   * watching may change. None of them is read by a scan, a match or the
   * watcher, so nothing runs again.
   */
  @ForViewers()
  @Put(':id/view')
  setView(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
  ): Library {
    const { name, paths } = this.find(id)
    const settings = parseBody({
      guard: isLibraryViewChange,
      body,
      message: 'Send only sort, view, groupBy or pinned, each a value it takes.',
    })
    const record = this.libraries.update({ id, input: { name, paths, settings } })
    if (!record) throw new NotFoundException(`No library ${id}`)
    return this.withStatus({
      record,
      canSee: true,
      isAdmin: this.management.canManage({ request }),
    })
  }

  /** Lists the libraries in the admin's order: `ids` names every library once. */
  @Public()
  @AdminOnly()
  @Put('order')
  @HttpCode(204)
  reorder(@Body() body: unknown): void {
    const { ids } = parseBody({
      guard: isLibraryOrder,
      body,
      message: 'ids must name every library once.',
    })
    if (!this.libraries.reorder(ids)) {
      throw new BadRequestException('ids must name every library once.')
    }
  }

  /** Includes the library's titles in home's hero, or leaves them out. */
  @AdminOnly()
  @Put(':id/hero')
  setInHero(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
  ): Library {
    const { name, paths, settings: current } = this.find(id)
    const settings = parseBody({
      guard: isLibraryHeroChange,
      body,
      message: 'inHero must be true or false.',
    })
    if (settings.inHero && current.locked) {
      throw new BadRequestException('A locked library can never show in the hero.')
    }
    const record = this.libraries.update({ id, input: { name, paths, settings } })
    if (!record) throw new NotFoundException(`No library ${id}`)
    return this.withStatus({
      record,
      canSee: true,
      isAdmin: this.management.canManage({ request }),
    })
  }

  @AdminOnly()
  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', ParseIntPipe) id: number): Promise<void> {
    this.find(id)
    await this.scanner.whenIdle(id)
    const ids = this.index.idsForLibrary(id)
    // Its videos' rows go with it; what was kept of them goes after.
    this.libraries.remove(id)
    await this.artifacts.discard(ids)
    this.watcher.sync()
    this.scanner.forget(id)
    // The pass finds no library, and clears up the items it left.
    this.metadata.enqueue(id)
  }

  /** Cancels a full scan, or any scan running: it stops at its next step. */
  @AdminOnly()
  @Post(':id/scan/cancel')
  @HttpCode(200)
  cancelScan(@Param('id', ParseIntPipe) id: number): Library {
    return this.commanded({ id, act: (libraryId) => this.scanner.cancel(libraryId) })
  }

  @AdminOnly()
  @Post(':id/scan')
  @HttpCode(200)
  scan(@Param('id', ParseIntPipe) id: number): Library {
    return this.commanded({ id, act: (libraryId) => this.scanner.scan(libraryId) })
  }

  /**
   * A quick scan: only what is new in the library's folders is read and
   * added, and the scores of the titles it added are fetched once they are
   * matched. Pressed while one runs, it changes nothing.
   */
  @AdminOnly()
  @Post(':id/quick-scan')
  @HttpCode(200)
  quickScan(@Param('id', ParseIntPipe) id: number): Library {
    return this.commanded({ id, act: (libraryId) => this.ratings.quickScan(libraryId) })
  }

  /** Cancels a quick scan, and the scores that would follow it. */
  @AdminOnly()
  @Post(':id/quick-scan/cancel')
  @HttpCode(200)
  cancelQuickScan(@Param('id', ParseIntPipe) id: number): Library {
    return this.commanded({ id, act: (libraryId) => this.ratings.cancelQuickScan(libraryId) })
  }

  /**
   * Update ratings: every movie and show in the library with no rating from
   * the source it shows has its scores fetched. Pressed while one runs, it
   * adds whatever has no rating since.
   */
  @AdminOnly()
  @Post(':id/ratings')
  @HttpCode(200)
  updateRatings(@Param('id', ParseIntPipe) id: number): Library {
    return this.commanded({ id, act: (libraryId) => this.ratings.start({ libraryId }) })
  }

  /** Cancels Update ratings: the titles still waiting are not asked for. */
  @AdminOnly()
  @Post(':id/ratings/cancel')
  @HttpCode(200)
  cancelRatings(@Param('id', ParseIntPipe) id: number): Library {
    return this.commanded({ id, act: (libraryId) => this.ratings.cancel(libraryId) })
  }

  /**
   * Match again: the files no movie or show was found for go back in the
   * queue, and TMDB is searched for them once more. Fix match choices stay.
   */
  @AdminOnly()
  @Post(':id/match')
  @HttpCode(200)
  rematch(@Param('id', ParseIntPipe) id: number): Library {
    const record = this.find(id)
    if (matchTypeFor(record.settings.kind) == null) {
      throw new BadRequestException('Only a library of movies or shows is matched.')
    }
    if (this.metadata.health().tmdb === METADATA_SERVICE_STATES.off) {
      throw new ServiceUnavailableException('Set TMDB_API_TOKEN to match files.')
    }
    this.metadata.retryUnmatched(id)
    // Read again, so the count of files not matched is the one after the retry.
    return this.managed(this.find(id))
  }

  /** The library's played videos, last played first; `watched=true` keeps the ones watched. */
  @Get(':id/history')
  history(
    @Param('id', ParseIntPipe) id: number,
    @Req() request: FastifyRequest,
    @Query('limit') limit?: string,
    @Query('watched') watched?: string,
  ): HistoryEntry[] {
    this.find(id)
    return this.viewing.history({
      libraryId: id,
      limit: historyLimit(limit),
      watchedOnly: watched === QUERY_FLAGS.true,
      account: this.accounts.keyOf({ request }),
    })
  }

  /** A TV shows library as its shows, with the files no show was found for after. */
  @Get(':id/shows')
  listShows(
    @Param('id', ParseIntPipe) id: number,
    @Query() query: unknown,
    @Req() request: FastifyRequest,
  ): ShowListing {
    this.find(id)
    const params = listParams(query)
    const account = this.accounts.keyOf({ request })
    return {
      shows: this.media.listShows({ libraryId: id, ...params, account }),
      unmatched: this.media.listUnmatched({ libraryId: id, search: params.search, account }),
    }
  }

  @Get(':id/media')
  listMedia(
    @Param('id', ParseIntPipe) id: number,
    @Query() query: unknown,
    @Req() request: FastifyRequest,
  ): MediaItem[] {
    this.find(id)
    return this.media.list({
      libraryId: id,
      ...listParams(query),
      account: this.accounts.keyOf({ request }),
    })
  }

  /**
   * How much each of its tabs holds for the caller, but All and Not matched,
   * which the library counts. Each is counted without reading the listing.
   */
  @Get(':id/counts')
  counts(@Param('id', ParseIntPipe) id: number, @Req() request: FastifyRequest): LibraryCounts {
    const record = this.find(id)
    const account = this.accounts.keyOf({ request })
    const isMovies = isMovieLibrary(record)
    return {
      inProgress: this.media.countInProgress({ libraryId: id, account }),
      favourites: this.media.countFavourites({ libraryId: id, account }),
      sagas: isMovies ? this.media.countSagas({ libraryId: id, account }) : 0,
      duplicates: isMovies ? this.splits.count(id) : 0,
      finished: this.viewing.finishedCount({ libraryId: id, account }),
    }
  }

  /** Its videos with a saved spot, the most recently watched first, each with its card's poster. */
  @Get(':id/in-progress')
  listInProgress(
    @Param('id', ParseIntPipe) id: number,
    @Req() request: FastifyRequest,
  ): PosterEntry[] {
    this.find(id)
    return this.media.withPosters(
      this.media.listInProgress({ libraryId: id, account: this.accounts.keyOf({ request }) }),
    )
  }

  /** Its favourites, most recently marked first, each with its card's poster. */
  @Get(':id/favourites')
  listFavourites(
    @Param('id', ParseIntPipe) id: number,
    @Req() request: FastifyRequest,
  ): PosterEntry[] {
    this.find(id)
    return this.media.withPosters(
      this.media.listFavourites({ libraryId: id, account: this.accounts.keyOf({ request }) }),
    )
  }

  /** Its sagas of two movies or more; none in a library that is not matched to movies. */
  private sagasOf({ id, request }: LibrariesControllerSagasOfProps): Saga[] {
    return isMovieLibrary(this.find(id))
      ? this.media.listSagas({ libraryId: id, account: this.accounts.keyOf({ request }) })
      : []
  }

  @Get(':id/sagas')
  listSagas(@Param('id', ParseIntPipe) id: number, @Req() request: FastifyRequest): Saga[] {
    return this.sagasOf({ id, request })
  }

  /**
   * Picks what a saga's page shows behind its title: its movies' backdrops
   * in turn, or one of them held still, which must be one it has.
   */
  @AdminOnly()
  @Put(':id/sagas/:sagaId/backdrop')
  setSagaBackdrop(
    @Param('id', ParseIntPipe) id: number,
    @Param('sagaId') sagaId: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
  ): SagaBackdrop {
    const saga = this.sagasOf({ id, request }).find((each) => each.tmdbId === sagaId)
    if (!saga) throw new NotFoundException(`No saga ${sagaId} in library ${id}`)
    const backdrop = parseBody({
      guard: isSagaBackdrop,
      body,
      message: 'Send a slideshow and its motion, or the movie whose backdrop to hold still.',
    })
    const isOwnPicture =
      backdrop.type === SAGA_BACKDROP_TYPES.slideshow ||
      sagaPictures(saga).some((picture) => picture.id === backdrop.itemId)
    if (!isOwnPicture) throw new BadRequestException(`${saga.name} has no such backdrop.`)
    this.sagaBackdrops.save({ libraryId: id, sagaId, backdrop })
    return backdrop
  }

  /** Its files no movie or show was found for, or still waiting for matching, by title, each with the AI lookup's suggestion. */
  @Get(':id/unmatched')
  listUnmatched(
    @Param('id', ParseIntPipe) id: number,
    @Req() request: FastifyRequest,
  ): UnmatchedFile[] {
    const record = this.find(id)
    const type = matchTypeFor(record.settings.kind)
    if (type == null) return []
    return this.metadata.withSuggestions({
      libraryId: id,
      type,
      files: this.media.listUnmatched({ libraryId: id, account: this.accounts.keyOf({ request }) }),
    })
  }

  /** A library matched to movies; the others keep each file on its own card, with nothing to split. */
  private findMovies(id: number): LibraryRecord {
    const record = this.find(id)
    if (!isMovieLibrary(record)) {
      throw new BadRequestException('Only a library of movies has duplicates to split.')
    }
    return record
  }

  /** Its movies with more than one file, split apart or not; none in a library not matched to movies. */
  @Get(':id/duplicates')
  listDuplicates(
    @Param('id', ParseIntPipe) id: number,
    @Req() request: FastifyRequest,
  ): Duplicates {
    return isMovieLibrary(this.find(id))
      ? this.splits.list({ libraryId: id, account: this.accounts.keyOf({ request }) })
      : []
  }

  /** Splits a card, named by any file on it: every file apart, or by cut. */
  @AdminOnly()
  @Post(':id/duplicates/split')
  @HttpCode(200)
  split(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
  ): Duplicates {
    this.findMovies(id)
    const asked = parseBody({
      guard: isSplitRequest,
      body,
      message: 'Send { mediaId, how }, how being "apart" or "smart".',
    })
    return this.splits.split({ libraryId: id, ...asked, account: this.accounts.keyOf({ request }) })
  }

  /** Puts a split movie's files back on one card. */
  @AdminOnly()
  @Post(':id/duplicates/join')
  @HttpCode(200)
  join(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
  ): Duplicates {
    this.findMovies(id)
    const { itemId } = parseBody({ guard: isJoinRequest, body, message: 'Send { itemId }.' })
    return this.splits.join({ libraryId: id, itemId, account: this.accounts.keyOf({ request }) })
  }
}
