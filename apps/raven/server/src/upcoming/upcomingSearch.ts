import { Inject, Injectable } from '@nestjs/common'
import {
  ITEM_TYPES,
  UPCOMING_SEARCH_SIZE,
  type UpcomingSearch as UpcomingSearchResult,
  type UpcomingTitle,
  requestKeyOf,
  uniqueUpcomingTitles,
} from '@raven/core'
import { TmdbClient } from '@/metadata/tmdbClient'
import { LibraryTitles } from '@/upcoming/libraryTitles'

/** The kinds a search looks among, as Coming soon's shelves do. */
const SEARCHED_TYPES = [ITEM_TYPES.movie, ITEM_TYPES.show] as const

type Ranked = UpcomingTitle & { popularity: number }

/**
 * Searches all of TMDB for Coming soon: movies and shows with a poster that
 * no library holds, out already or still to come, the most popular first.
 */
@Injectable()
export class UpcomingSearch {
  constructor(
    @Inject(TmdbClient) private readonly tmdb: Pick<TmdbClient, 'searchDated'>,
    @Inject(LibraryTitles) private readonly library: Pick<LibraryTitles, 'heldOf'>,
  ) {}

  /** What `query` finds; a blank one finds nothing without asking TMDB. Rejects with TMDB's error. */
  async search(query: string): Promise<UpcomingSearchResult> {
    if (query.trim() === '') return { titles: [] }
    const found = await Promise.all(
      SEARCHED_TYPES.map(async (type) =>
        (await this.tmdb.searchDated({ type, query })).flatMap(
          ({ tmdbId, title, released, poster, popularity }): Ranked[] =>
            poster == null ? [] : [{ type, tmdbId, title, released, poster, popularity }],
        ),
      ),
    )
    const titles = uniqueUpcomingTitles(
      found.flat().toSorted((a, b) => b.popularity - a.popularity),
    )
    const held = this.library.heldOf(titles)
    return {
      titles: titles
        .filter((title) => !held.has(requestKeyOf(title)))
        .slice(0, UPCOMING_SEARCH_SIZE)
        .map(({ popularity: _popularity, ...title }) => title),
    }
  }
}
