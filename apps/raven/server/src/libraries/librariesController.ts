import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  ServiceUnavailableException,
} from '@nestjs/common'
import {
  type Duplicates,
  type HistoryEntry,
  type Library,
  type LibraryInput,
  type MediaItem,
  type MediaListParams,
  type PosterEntry,
  type Saga,
  type SagaBackdrop,
  type ShowListing,
  isJoinRequest,
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
} from '@raven/core'
import { AdminOnly, ForViewers } from '@/admin/adminGuard'
import { type LibraryRecord, LibrariesRepository, samePaths } from '@/libraries/librariesRepository'
import { PrivateBy, Public } from '@/lock/lockGuard'
import { LockService } from '@/lock/lockService'
import { MediaArtifacts } from '@/media/mediaArtifacts'
import { MediaIndex } from '@/media/mediaIndex'
import { MediaRepository } from '@/media/mediaRepository'
import { MovieSplits } from '@/media/movieSplits'
import { SagaBackdrops } from '@/media/sagaBackdrops'
import { ViewingRepository } from '@/media/viewingRepository'
import { MetadataService } from '@/metadata/metadataService'
import { parseBody } from '@/parseBody'
import { LibraryWatcher } from '@/scanner/libraryWatcher'
import { ScannerService } from '@/scanner/scannerService'

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

/** How many history entries a request gets unless it asks, and the most it may ask for. */
const HISTORY_LIMIT = { fallback: 100, most: 500 }

const historyLimit = (asked: string | undefined): number => {
  const limit = Number.parseInt(asked ?? '', 10)
  return Number.isInteger(limit)
    ? Math.min(Math.max(limit, 1), HISTORY_LIMIT.most)
    : HISTORY_LIMIT.fallback
}

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
   * A library as a client sees it: its scan's live status, and its newest
   * video's picture. Without `canSee` a library still locked to the browser
   * keeps its folders, its picture and what its last scan said about them
   * (which names the folders) to itself, and shows only its name, type and
   * counts. Every route says which, so none reveals a locked library by
   * leaving it out: the public ones ask the lock, while the guarded ones,
   * and creating a library, pass true, as whoever reaches them sees it all.
   */
  private withStatus({ record, canSee }: { record: LibraryRecord; canSee: boolean }): Library {
    const scan = this.scanner.status(record.id)
    if (canSee) return { ...record, scan, backdrop: this.media.backdropOf(record.id) }
    return {
      ...record,
      paths: [],
      layouts: [],
      scan: { ...scan, error: scan.error == null ? null : LOCKED_SCAN_ERROR },
      backdrop: null,
    }
  }

  private find(id: number): LibraryRecord {
    const record = this.libraries.get(id)
    if (!record) throw new NotFoundException(`No library ${id}`)
    return record
  }

  /** Every library, but a locked one while the admin lock holds. */
  @Public()
  @Get()
  list(@Headers('cookie') cookie: string | undefined): Library[] {
    const viewer = this.lock.viewer({ cookie })
    return this.libraries
      .list()
      .filter((record) => viewer.listsLibrary(record.id))
      .map((record) => this.withStatus({ record, canSee: viewer.seesLibrary(record.id) }))
  }

  /**
   * Every library shows in the side menu, locked or not, so its own settings
   * do too; while the admin lock holds, a locked one is not there at all.
   */
  @Public()
  @Get(':id')
  get(
    @Param('id', ParseIntPipe) id: number,
    @Headers('cookie') cookie: string | undefined,
  ): Library {
    const record = this.find(id)
    const viewer = this.lock.viewer({ cookie })
    if (!viewer.listsLibrary(id)) throw new NotFoundException(`No library ${id}`)
    return this.withStatus({ record, canSee: viewer.seesLibrary(id) })
  }

  /** Creating a library starts its first scan; the response already reports it as scanning. */
  @Public()
  @AdminOnly()
  @Post()
  create(@Body() body: unknown): Library {
    const record = this.libraries.create(this.parseLockable(body))
    this.scanner.scan(record.id)
    this.watcher.sync()
    return this.withStatus({ record, canSee: true })
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
    return this.withStatus({ record, canSee: true })
  }

  /**
   * How a library is sorted, viewed and grouped, and its pin, which anyone
   * watching may change. None of them is read by a scan, a match or the
   * watcher, so nothing runs again.
   */
  @ForViewers()
  @Put(':id/view')
  setView(@Param('id', ParseIntPipe) id: number, @Body() body: unknown): Library {
    const { name, paths } = this.find(id)
    const settings = parseBody({
      guard: isLibraryViewChange,
      body,
      message: 'Send only sort, view, groupBy or pinned, each a value it takes.',
    })
    const record = this.libraries.update({ id, input: { name, paths, settings } })
    if (!record) throw new NotFoundException(`No library ${id}`)
    return this.withStatus({ record, canSee: true })
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

  @AdminOnly()
  @Post(':id/scan')
  @HttpCode(200)
  scan(@Param('id', ParseIntPipe) id: number): Library {
    const record = this.find(id)
    this.scanner.scan(id)
    return this.withStatus({ record, canSee: true })
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
    if (this.metadata.health().tmdb === 'off') {
      throw new ServiceUnavailableException('Set TMDB_API_TOKEN to match files.')
    }
    this.metadata.retryUnmatched(id)
    // Read again, so the count of files not matched is the one after the retry.
    return this.withStatus({ record: this.find(id), canSee: true })
  }

  /** The library's played videos, last played first; `watched=true` keeps the ones watched. */
  @Get(':id/history')
  history(
    @Param('id', ParseIntPipe) id: number,
    @Query('limit') limit?: string,
    @Query('watched') watched?: string,
  ): HistoryEntry[] {
    this.find(id)
    return this.viewing.history({
      libraryId: id,
      limit: historyLimit(limit),
      watchedOnly: watched === 'true',
    })
  }

  /** A TV shows library as its shows, with the files no show was found for after. */
  @Get(':id/shows')
  listShows(@Param('id', ParseIntPipe) id: number, @Query() query: unknown): ShowListing {
    this.find(id)
    const params = listParams(query)
    return {
      shows: this.media.listShows({ libraryId: id, ...params }),
      unmatched: this.media.listUnmatched({ libraryId: id, search: params.search }),
    }
  }

  @Get(':id/media')
  listMedia(@Param('id', ParseIntPipe) id: number, @Query() query: unknown): MediaItem[] {
    this.find(id)
    return this.media.list({ libraryId: id, ...listParams(query) })
  }

  /** Its videos with a saved spot, the most recently watched first, each with its card's poster. */
  @Get(':id/in-progress')
  listInProgress(@Param('id', ParseIntPipe) id: number): PosterEntry[] {
    this.find(id)
    return this.media.withPosters(this.media.listInProgress({ libraryId: id }))
  }

  /** Its favourites, most recently marked first, each with its card's poster. */
  @Get(':id/favourites')
  listFavourites(@Param('id', ParseIntPipe) id: number): PosterEntry[] {
    this.find(id)
    return this.media.withPosters(this.media.listFavourites({ libraryId: id }))
  }

  /** Its sagas of two movies or more; none in a library that is not matched to movies. */
  @Get(':id/sagas')
  listSagas(@Param('id', ParseIntPipe) id: number): Saga[] {
    const record = this.find(id)
    return matchTypeFor(record.settings.kind) === 'movie' ? this.media.listSagas(id) : []
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
  ): SagaBackdrop {
    const saga = this.listSagas(id).find((each) => each.tmdbId === sagaId)
    if (!saga) throw new NotFoundException(`No saga ${sagaId} in library ${id}`)
    const backdrop = parseBody({
      guard: isSagaBackdrop,
      body,
      message: 'Send a slideshow and its motion, or the movie whose backdrop to hold still.',
    })
    const isOwnPicture =
      backdrop.type === 'slideshow' ||
      sagaPictures(saga).some((picture) => picture.id === backdrop.itemId)
    if (!isOwnPicture) throw new BadRequestException(`${saga.name} has no such backdrop.`)
    this.sagaBackdrops.save({ libraryId: id, sagaId, backdrop })
    return backdrop
  }

  /** Its files no movie or show was found for, or still waiting for matching, by title, each with the AI lookup's suggestion. */
  @Get(':id/unmatched')
  listUnmatched(@Param('id', ParseIntPipe) id: number): UnmatchedFile[] {
    const record = this.find(id)
    const type = matchTypeFor(record.settings.kind)
    if (type == null) return []
    return this.metadata.withSuggestions({
      libraryId: id,
      type,
      files: this.media.listUnmatched({ libraryId: id }),
    })
  }

  /** A library matched to movies; the others keep each file on its own card, with nothing to split. */
  private findMovies(id: number): LibraryRecord {
    const record = this.find(id)
    if (matchTypeFor(record.settings.kind) !== 'movie') {
      throw new BadRequestException('Only a library of movies has duplicates to split.')
    }
    return record
  }

  /** Its movies with more than one file, split apart or not; none in a library not matched to movies. */
  @Get(':id/duplicates')
  listDuplicates(@Param('id', ParseIntPipe) id: number): Duplicates {
    const record = this.find(id)
    return matchTypeFor(record.settings.kind) === 'movie' ? this.splits.list(id) : []
  }

  /** Splits a card, named by any file on it: every file apart, or by cut. */
  @AdminOnly()
  @Post(':id/duplicates/split')
  @HttpCode(200)
  split(@Param('id', ParseIntPipe) id: number, @Body() body: unknown): Duplicates {
    this.findMovies(id)
    const request = parseBody({
      guard: isSplitRequest,
      body,
      message: 'Send { mediaId, how }, how being "apart" or "smart".',
    })
    return this.splits.split({ libraryId: id, ...request })
  }

  /** Puts a split movie's files back on one card. */
  @AdminOnly()
  @Post(':id/duplicates/join')
  @HttpCode(200)
  join(@Param('id', ParseIntPipe) id: number, @Body() body: unknown): Duplicates {
    this.findMovies(id)
    const { itemId } = parseBody({ guard: isJoinRequest, body, message: 'Send { itemId }.' })
    return this.splits.join({ libraryId: id, itemId })
  }
}
