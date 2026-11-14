import { Inject, Injectable } from '@nestjs/common'
import {
  type MatchItemType,
  type Upcoming,
  UPCOMING_SHELF_SIZES,
  UPCOMING_SHELVES,
  type UpcomingShelf,
  type UpcomingTitle,
  uniqueUpcomingTitles,
} from '@raven/core'
import { CLOCK, type Clock, utcDayOf } from '@/clock'
import { TmdbClient } from '@/metadata/tmdbClient'
import type { DiscoveredTitle } from '@/metadata/tmdbShapes'
import { FreshReads } from '@/upcoming/freshReads'
import { SHELF_STREAMS } from '@/upcoming/shelfStreams'

/** TMDB's pages of twenty each shelf reads of each list: two for two rows, so titles with no poster yet leave it full. */
const SHELF_PAGES = {
  [UPCOMING_SHELVES.movies]: [1, 2],
  [UPCOMING_SHELVES.shows]: [1, 2],
  [UPCOMING_SHELVES.documentaries]: [1],
} as const satisfies Record<UpcomingShelf, readonly number[]>

/** The one read the shelves are kept under. */
const SHELVES_KEY = 'shelves'

type Ranked = UpcomingTitle & { popularity: number }

type RankedOfProps = { type: MatchItemType; found: readonly DiscoveredTitle[] }

/** The titles a shelf can show: those with a poster, as cards of their type. */
const rankedOf = ({ type, found }: RankedOfProps): Ranked[] =>
  found.flatMap(({ poster, ...title }) => (poster == null ? [] : { ...title, type, poster }))

type KeptProps = { titles: readonly Ranked[]; size: number }

/** The first `size` of `titles`, the most popular first, each once and without its popularity. */
const kept = ({ titles, size }: KeptProps): UpcomingTitle[] =>
  uniqueUpcomingTitles(titles.toSorted((a, b) => b.popularity - a.popularity))
    .slice(0, size)
    .map(({ popularity: _popularity, ...title }) => title)

type ShelfProps = { shelf: UpcomingShelf; from: string }

/**
 * What TMDB says is coming soon, as Coming soon's three shelves, the most
 * popular first. One read of TMDB serves everyone for six hours.
 */
@Injectable()
export class UpcomingTitles {
  private readonly reads: FreshReads<Upcoming>

  constructor(
    @Inject(TmdbClient) private readonly tmdb: Pick<TmdbClient, 'upcoming'>,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {
    this.reads = new FreshReads({ clock, most: 1 })
  }

  /** The shelves, from the last read while it is fresh; rejects with TMDB's error when a read fails. */
  read(): Promise<Upcoming> {
    return this.reads.read({ key: SHELVES_KEY, read: () => this.load() })
  }

  private async load(): Promise<Upcoming> {
    const from = utcDayOf(this.clock.now())
    const [movies, shows, documentaries] = await Promise.all([
      this.shelf({ shelf: UPCOMING_SHELVES.movies, from }),
      this.shelf({ shelf: UPCOMING_SHELVES.shows, from }),
      this.shelf({ shelf: UPCOMING_SHELVES.documentaries, from }),
    ])
    return { movies, shows, documentaries }
  }

  private async shelf({ shelf, from }: ShelfProps): Promise<UpcomingTitle[]> {
    const found = await Promise.all(
      SHELF_STREAMS[shelf].flatMap(({ type, documentaries }) =>
        SHELF_PAGES[shelf].map(async (page) =>
          rankedOf({ type, found: await this.tmdb.upcoming({ type, from, documentaries, page }) }),
        ),
      ),
    )
    return kept({ titles: found.flat(), size: UPCOMING_SHELF_SIZES[shelf] })
  }
}
