import type { Transport } from '@/apiClient/transport'
import { ROUTES } from '@/routes'
import {
  type AlbumShelf,
  type Hero,
  type HeroPickChange,
  type HeroPicks,
  type Home,
  type HomeSearch,
  type ItemSummary,
  type PosterEntry,
  type Upcoming,
  type UpcomingPage,
  type UpcomingShelf,
  UPCOMING_PARAMS,
} from '@/contract'
import { HOME_SEARCH_PARAM } from '@/search'

type UpcomingShelfQuery = {
  shelf: UpcomingShelf
  /** The cursor the page before answered as `next`; null for the first page. */
  after: string | null
}

/** The home page: what is in progress, each library's shelf, the hero, and the favourites across every library. */
export const homeCalls = ({ ask }: Transport) => ({
  /** Every video in progress, then each pinned library's newest arrivals; libraries still locked stay out. */
  getHome: (): Promise<Home> => ask({ route: ROUTES.getHome }),

  /** What `query` finds in every library, a row for each holding a match; libraries still locked stay out. */
  searchHome: (query: string): Promise<HomeSearch> =>
    ask({ route: ROUTES.searchHome, query: { [HOME_SEARCH_PARAM]: query.trim() } }),

  /** The titles home's hero takes turns with, each with the line it reads; libraries still locked stay out. */
  getHero: (): Promise<Hero> => ask({ route: ROUTES.getHero }),

  /** A shelf of albums for each pinned music library, the one added last first; libraries still locked stay out. */
  getHomeAlbums: (): Promise<AlbumShelf[]> => ask({ route: ROUTES.getHomeAlbums }),

  /** The movies and shows the admin picked for the hero, and how many it holds at most. */
  getHeroPicks: (): Promise<HeroPicks> => ask({ route: ROUTES.getHeroPicks }),

  /** Adds a movie or show to the hero, or takes it out; answers with the picks as they stand after. */
  setHeroPick: ({ itemId, isShown }: HeroPickChange): Promise<HeroPicks> =>
    ask({ route: ROUTES.setHeroPick, body: { itemId, isShown } satisfies HeroPickChange }),

  /** The movies, shows and documentaries TMDB says are still to come, the most popular first. */
  getUpcoming: (): Promise<Upcoming> => ask({ route: ROUTES.getUpcoming }),

  /** One page of a Coming soon shelf, the soonest out first. */
  getUpcomingShelf: ({ shelf, after }: UpcomingShelfQuery): Promise<UpcomingPage> =>
    ask({
      route: ROUTES.getUpcomingShelf,
      params: { [UPCOMING_PARAMS.shelf]: shelf },
      query: after === null ? {} : { [UPCOMING_PARAMS.after]: after },
    }),

  /** Every favourite across every library with the poster its card shows, most recently favourited first. */
  listFavourites: (): Promise<PosterEntry[]> => ask({ route: ROUTES.listFavourites }),

  /** Every show and season marked a favourite, most recently marked first. */
  listFavouriteTitles: (): Promise<ItemSummary[]> => ask({ route: ROUTES.listFavouriteTitles }),
})
