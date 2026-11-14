import { Controller, Get, Inject, Param, ParseIntPipe, Query } from '@nestjs/common'
import {
  type HistoryEntry,
  type ItemSummary,
  type LibraryCounts,
  type MediaItem,
  type MediaListParams,
  type PosterEntry,
  type Saga,
  type ShowListing,
  type UnmatchedFile,
  isRecord,
  matchTypeFor,
  mediaListQuery,
} from '@raven/core'
import type { LibraryRecord } from '@/libraries/librariesRepository'
import { LibraryById } from '@/libraries/libraryById'
import { LibraryViews, isMovieLibrary } from '@/libraries/libraryViews'
import { PrivateBy } from '@/lock/lockGuard'
import { PRIVACIES } from '@/lock/lockService'
import { DolbyVisionOnly } from '@/media/dolbyVisionOnly'
import { withShowPosters } from '@/media/historyPosters'
import { MediaRepository } from '@/media/mediaRepository'
import { MovieSplits } from '@/media/movieSplits'
import { TitleFavourites } from '@/media/titleFavourites'
import type { AccountKey } from '@/media/viewingAccountKeys'
import { ViewingAccount } from '@/media/viewingAccountParam'
import { ViewingRepository } from '@/media/viewingRepository'
import { MetadataRepository } from '@/metadata/metadataRepository'
import { MetadataService } from '@/metadata/metadataService'
import { QUERY_FLAGS, QUERY_PARAMS, pageLimit } from '@/queryValues'
import { ROUTE_PARAMS } from '@/requestParts'
import { LIBRARY_ROUTES } from '@/libraries/libraryRoutes'

/** A listing's search, sort and seed, read as the client's `mediaListQuery.encode` wrote them. */
const listParams = (query: unknown): MediaListParams =>
  mediaListQuery.decode(isRecord(query) ? query : {})

/** How many history entries a request gets unless it asks, and the most it may ask for. */
const HISTORY_LIMIT = { fallback: 100, most: 500 } as const

/** What each library holds for the caller: its videos, shows, history, favourites, sagas and unmatched files. */
@Controller(LIBRARY_ROUTES)
@PrivateBy(PRIVACIES.library)
export class LibraryListingsController {
  constructor(
    @Inject(LibraryViews) private readonly views: LibraryViews,
    @Inject(MediaRepository) private readonly media: MediaRepository,
    @Inject(MovieSplits) private readonly splits: MovieSplits,
    @Inject(DolbyVisionOnly) private readonly dolbyVisionOnly: DolbyVisionOnly,
    @Inject(ViewingRepository) private readonly viewing: ViewingRepository,
    @Inject(MetadataService) private readonly metadata: MetadataService,
    @Inject(MetadataRepository) private readonly items: MetadataRepository,
    @Inject(TitleFavourites) private readonly titles: TitleFavourites,
  ) {}

  /** The library's played videos, last played first; `watched=true` keeps the ones watched. */
  @Get(':id/history')
  history(
    @Param(ROUTE_PARAMS.id, ParseIntPipe, LibraryById) library: LibraryRecord,
    @ViewingAccount() account: AccountKey,
    @Query(QUERY_PARAMS.limit) limit: unknown,
    @Query(QUERY_PARAMS.watched) watched: unknown,
  ): HistoryEntry[] {
    const entries = this.viewing.history({
      libraryId: library.id,
      limit: pageLimit({ asked: limit, ...HISTORY_LIMIT }),
      watchedOnly: watched === QUERY_FLAGS.true,
      account,
    })
    return withShowPosters({ entries, libraryId: library.id, metadata: this.items })
  }

  /** A TV shows library as its shows, with the files no show was found for after. */
  @Get(':id/shows')
  listShows(
    @Param(ROUTE_PARAMS.id, ParseIntPipe, LibraryById) library: LibraryRecord,
    @Query() query: unknown,
    @ViewingAccount() account: AccountKey,
  ): ShowListing {
    const params = listParams(query)
    const libraryId = library.id
    return {
      shows: this.media.listShows({ libraryId, ...params, account }),
      unmatched: this.media.listUnmatched({ libraryId, search: params.search, account }),
    }
  }

  @Get(':id/media')
  listMedia(
    @Param(ROUTE_PARAMS.id, ParseIntPipe, LibraryById) library: LibraryRecord,
    @Query() query: unknown,
    @ViewingAccount() account: AccountKey,
  ): MediaItem[] {
    return this.media.list({ libraryId: library.id, ...listParams(query), account })
  }

  /**
   * How much each of its tabs holds for the caller, but All and Not matched,
   * which the library counts. Each is counted without reading the listing.
   */
  @Get(':id/counts')
  counts(
    @Param(ROUTE_PARAMS.id, ParseIntPipe, LibraryById) library: LibraryRecord,
    @ViewingAccount() account: AccountKey,
  ): LibraryCounts {
    const libraryId = library.id
    const isMovies = isMovieLibrary(library)
    return {
      inProgress: this.media.countInProgress({ libraryId, account }),
      favourites:
        this.media.countFavourites({ libraryId, account }) +
        this.titles.count({ account, libraryId }),
      sagas: isMovies ? this.media.countSagas({ libraryId, account }) : 0,
      duplicates: isMovies ? this.splits.count(libraryId) : 0,
      finished: this.viewing.finishedCount({ libraryId, account }),
      dolbyVisionOnly: this.dolbyVisionOnly.count(libraryId),
    }
  }

  /** Its videos with a saved spot, the most recently watched first, each with its card's poster. */
  @Get(':id/in-progress')
  listInProgress(
    @Param(ROUTE_PARAMS.id, ParseIntPipe, LibraryById) library: LibraryRecord,
    @ViewingAccount() account: AccountKey,
  ): PosterEntry[] {
    return this.media.withPosters(this.media.listInProgress({ libraryId: library.id, account }))
  }

  /** Its favourites, most recently marked first, each with its card's poster. */
  @Get(':id/favourites')
  listFavourites(
    @Param(ROUTE_PARAMS.id, ParseIntPipe, LibraryById) library: LibraryRecord,
    @ViewingAccount() account: AccountKey,
  ): PosterEntry[] {
    return this.media.withPosters(this.media.listFavourites({ libraryId: library.id, account }))
  }

  /** Its favourite shows and seasons, most recently marked first. */
  @Get(':id/favourites/titles')
  listFavouriteTitles(
    @Param(ROUTE_PARAMS.id, ParseIntPipe, LibraryById) library: LibraryRecord,
    @ViewingAccount() account: AccountKey,
  ): ItemSummary[] {
    return this.titles.list({ account, libraryId: library.id })
  }

  @Get(':id/sagas')
  listSagas(
    @Param(ROUTE_PARAMS.id, ParseIntPipe, LibraryById) library: LibraryRecord,
    @ViewingAccount() account: AccountKey,
  ): Saga[] {
    return this.views.sagasOf({ record: library, account })
  }

  /** Its files no movie or show was found for, or still waiting for matching, by title, each with the AI lookup's suggestion. */
  @Get(':id/unmatched')
  listUnmatched(
    @Param(ROUTE_PARAMS.id, ParseIntPipe, LibraryById) library: LibraryRecord,
    @ViewingAccount() account: AccountKey,
  ): UnmatchedFile[] {
    const type = matchTypeFor(library.settings.kind)
    if (type == null) return []
    return this.metadata.withSuggestions({
      libraryId: library.id,
      type,
      files: this.media.listUnmatched({ libraryId: library.id, account }),
    })
  }
}
