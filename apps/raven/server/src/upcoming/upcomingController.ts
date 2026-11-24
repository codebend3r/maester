import {
  BadRequestException,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Query,
} from '@nestjs/common'
import {
  isUpcomingShelf,
  ITEM_TYPES,
  type Upcoming,
  type UpcomingDetails,
  UPCOMING_TITLE_PARAMS,
  UPCOMING_TITLE_PATH,
  type UpcomingPage,
  UPCOMING_PARAMS,
  UPCOMING_PATH,
  UPCOMING_SEARCH_PARAM,
  UPCOMING_SEARCH_PATH,
  UPCOMING_SHELF_PATH,
  type UpcomingSearch as UpcomingSearchResult,
} from '@raven/core'
import { TmdbClient } from '@/metadata/tmdbClient'
import { requireTmdb, tmdbUnavailable } from '@/metadata/tmdbGate'
import { Public } from '@/lock/lockGuard'
import { PeopleRepository } from '@/people/peopleRepository'
import { upcomingKindOf } from '@/upcoming/upcomingKind'
import { UpcomingSearch } from '@/upcoming/upcomingSearch'
import { UpcomingShelfPages } from '@/upcoming/upcomingShelfPages'
import { titleAskOf } from '@/upcoming/titleAsk'

/** What the 503 says Coming soon needs TMDB for. */
const TMDB_TO_DO = 'see what is coming soon'

/** What the 503 says a title's own page needs TMDB for. */
const TMDB_TO_DESCRIBE = 'describe a title that is coming soon'

/** What the 503 says Coming soon's search needs TMDB for. */
const TMDB_TO_SEARCH = 'search for movies and shows'

/** What a 400 says of a `q` that is no single string. */
const BAD_QUERY = 'q must be the words to search for'

/** What a 400 says of an `after` that is no cursor. */
const BAD_CURSOR = 'after must be the cursor a page answered as next'

/** Coming soon: the movies, shows and documentaries TMDB says are still to come. */
@Controller()
export class UpcomingController {
  constructor(
    @Inject(TmdbClient) private readonly tmdb: TmdbClient,
    @Inject(UpcomingShelfPages) private readonly shelves: UpcomingShelfPages,
    @Inject(UpcomingSearch) private readonly searches: UpcomingSearch,
    @Inject(PeopleRepository) private readonly people: PeopleRepository,
  ) {}

  /**
   * The movies and shows `?q=` finds on TMDB that no library holds, out
   * already or still to come, the most popular first. Held to the PIN lock, since what
   * it leaves out says what the libraries hold.
   */
  @Get(UPCOMING_SEARCH_PATH)
  async search(@Query(UPCOMING_SEARCH_PARAM) query: unknown): Promise<UpcomingSearchResult> {
    if (query !== undefined && typeof query !== 'string') throw new BadRequestException(BAD_QUERY)
    requireTmdb({ tmdb: this.tmdb, toDo: TMDB_TO_SEARCH })
    return this.searches.search(query ?? '').catch(tmdbUnavailable)
  }

  /** The three shelves, the same for every viewer: none of it is in a library, so no lock holds it. */
  @Get(UPCOMING_PATH)
  async list(): Promise<Upcoming> {
    requireTmdb({ tmdb: this.tmdb, toDo: TMDB_TO_DO })
    return this.shelves.shelves().catch(tmdbUnavailable)
  }

  /**
   * A page of one shelf, the most popular first, after `?after=`, the cursor
   * the page before answered. Public to the PIN lock: no library holds it.
   */
  @Get(UPCOMING_SHELF_PATH)
  @Public()
  async shelf(
    @Param(UPCOMING_PARAMS.shelf) shelf: string,
    @Query(UPCOMING_PARAMS.after) after: unknown,
  ): Promise<UpcomingPage> {
    if (!isUpcomingShelf(shelf)) throw new NotFoundException(`No shelf ${shelf}`)
    if (after !== undefined && typeof after !== 'string') {
      throw new BadRequestException(BAD_CURSOR)
    }
    requireTmdb({ tmdb: this.tmdb, toDo: TMDB_TO_DO })
    const page = await this.shelves.read({ shelf, after: after ?? null }).catch(tmdbUnavailable)
    if (page === null) throw new BadRequestException(BAD_CURSOR)
    return page
  }

  /**
   * One upcoming movie or show as TMDB describes it, cast and crew included,
   * the same for every viewer. Public to the PIN lock: no library holds it.
   */
  @Get(UPCOMING_TITLE_PATH)
  @Public()
  async details(
    @Param(UPCOMING_TITLE_PARAMS.type) type: string,
    @Param(UPCOMING_TITLE_PARAMS.tmdbId) tmdbId: string,
  ): Promise<UpcomingDetails> {
    const ask = titleAskOf({ type, tmdbId })
    requireTmdb({ tmdb: this.tmdb, toDo: TMDB_TO_DESCRIBE })
    const item = await (
      ask.type === ITEM_TYPES.movie ? this.tmdb.movie(ask.tmdbId) : this.tmdb.show(ask.tmdbId)
    ).catch(tmdbUnavailable)
    return {
      type: ask.type,
      tmdbId: ask.tmdbId,
      title: item.title,
      released: item.released,
      poster: item.images.poster,
      backdrop: item.images.backdrop,
      summary: item.summary,
      tagline: item.tagline,
      genres: item.genres,
      runtime: item.runtime,
      kind: upcomingKindOf({ ...item, type: ask.type }),
      credits: this.people.creditsOf(item.credits),
    }
  }
}
