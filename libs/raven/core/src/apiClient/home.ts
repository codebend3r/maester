import type { Transport } from '@/apiClient/transport'
import {
  type AlbumShelf,
  type Hero,
  type HeroPickChange,
  type HeroPicks,
  type Home,
  type HomeSearch,
  isAlbumShelves,
  isFavouriteTitles,
  isHero,
  isHeroPicks,
  isHome,
  isHomeSearch,
  isPosterEntries,
  isUpcoming,
  isUpcomingPage,
  type ItemSummary,
  type PosterEntry,
  type Upcoming,
  type UpcomingPage,
  type UpcomingShelf,
  UPCOMING_PARAMS,
  UPCOMING_PATH,
  UPCOMING_SHELF_PATH,
} from '@/contract'
import { fillPath, pathWithQuery, toQueryString } from '@/query'

type UpcomingShelfQuery = {
  shelf: UpcomingShelf
  /** The cursor the page before answered as `next`; null for the first page. */
  after: string | null
}

/** The home page: what is in progress, each library's shelf, the hero, and the favourites across every library. */
export const homeCalls = ({ send, expect }: Transport) => ({
  /** Every video in progress, then each pinned library's newest arrivals; libraries still locked stay out. */
  getHome: (): Promise<Home> => expect({ request: send({ path: '/api/home' }), guard: isHome }),

  /** What `query` finds in every library, a row for each holding a match; libraries still locked stay out. */
  searchHome: (query: string): Promise<HomeSearch> =>
    expect({
      request: send({ path: `/api/home/search?${toQueryString({ q: query.trim() })}` }),
      guard: isHomeSearch,
    }),

  /** The titles home's hero takes turns with, each with the line it reads; libraries still locked stay out. */
  getHero: (): Promise<Hero> =>
    expect({ request: send({ path: '/api/home/hero' }), guard: isHero }),

  /** A shelf of albums for each pinned music library, the one added last first; libraries still locked stay out. */
  getHomeAlbums: (): Promise<AlbumShelf[]> =>
    expect({ request: send({ path: '/api/home/albums' }), guard: isAlbumShelves }),

  /** The movies and shows the admin picked for the hero, and how many it holds at most. */
  getHeroPicks: (): Promise<HeroPicks> =>
    expect({ request: send({ path: '/api/hero/picks' }), guard: isHeroPicks }),

  /** Adds a movie or show to the hero, or takes it out; answers with the picks as they stand after. */
  setHeroPick: ({ itemId, isShown }: HeroPickChange): Promise<HeroPicks> =>
    expect({
      request: send({
        path: '/api/hero/picks',
        method: 'PUT',
        body: { itemId, isShown } satisfies HeroPickChange,
      }),
      guard: isHeroPicks,
    }),

  /** The movies, shows and documentaries TMDB says are still to come, the most popular first. */
  getUpcoming: (): Promise<Upcoming> =>
    expect({ request: send({ path: UPCOMING_PATH }), guard: isUpcoming }),

  /** One page of a Coming soon shelf, the soonest out first. */
  getUpcomingShelf: ({ shelf, after }: UpcomingShelfQuery): Promise<UpcomingPage> =>
    expect({
      request: send({
        path: pathWithQuery({
          path: fillPath({ path: UPCOMING_SHELF_PATH, params: { [UPCOMING_PARAMS.shelf]: shelf } }),
          query: after === null ? {} : { [UPCOMING_PARAMS.after]: after },
        }),
      }),
      guard: isUpcomingPage,
    }),

  /** Every favourite across every library with the poster its card shows, most recently favourited first. */
  listFavourites: (): Promise<PosterEntry[]> =>
    expect({ request: send({ path: '/api/favourites' }), guard: isPosterEntries }),

  /** Every show and season marked a favourite, most recently marked first. */
  listFavouriteTitles: (): Promise<ItemSummary[]> =>
    expect({ request: send({ path: '/api/favourites/titles' }), guard: isFavouriteTitles }),
})
