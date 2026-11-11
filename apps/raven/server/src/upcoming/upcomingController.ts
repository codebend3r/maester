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
  type Upcoming,
  type UpcomingPage,
  UPCOMING_PARAMS,
  UPCOMING_PATH,
  UPCOMING_SHELF_PATH,
} from '@raven/core'
import { TmdbClient } from '@/metadata/tmdbClient'
import { requireTmdb, tmdbUnavailable } from '@/metadata/tmdbGate'
import { Public } from '@/lock/lockGuard'
import { UpcomingShelfPages } from '@/upcoming/upcomingShelfPages'
import { UpcomingTitles } from '@/upcoming/upcomingTitles'

/** What the 503 says Coming soon needs TMDB for. */
const TMDB_TO_DO = 'see what is coming soon'

/** What a 400 says of an `after` that is no cursor. */
const BAD_CURSOR = 'after must be the cursor a page answered as next'

/** Coming soon: the movies, shows and documentaries TMDB says are still to come. */
@Controller()
export class UpcomingController {
  constructor(
    @Inject(TmdbClient) private readonly tmdb: TmdbClient,
    @Inject(UpcomingTitles) private readonly upcoming: UpcomingTitles,
    @Inject(UpcomingShelfPages) private readonly shelves: UpcomingShelfPages,
  ) {}

  /** The three shelves, the same for every viewer: none of it is in a library, so no lock holds it. */
  @Get(UPCOMING_PATH)
  async list(): Promise<Upcoming> {
    requireTmdb({ tmdb: this.tmdb, toDo: TMDB_TO_DO })
    return this.upcoming.read().catch(tmdbUnavailable)
  }

  /**
   * A page of one shelf, the soonest out first, after `?after=`, the cursor
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
}
