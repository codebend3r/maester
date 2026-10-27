import type { Transport } from '@/apiClient/transport'
import {
  type Hero,
  type HeroPickChange,
  type HeroPicks,
  type Home,
  type HomeSearch,
  isFavouriteTitles,
  isHero,
  isHeroPicks,
  isHome,
  isHomeSearch,
  isPosterEntries,
  type ItemSummary,
  type PosterEntry,
} from '@/contract'
import { toQueryString } from '@/query'

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

  /** Every favourite across every library with the poster its card shows, most recently favourited first. */
  listFavourites: (): Promise<PosterEntry[]> =>
    expect({ request: send({ path: '/api/favourites' }), guard: isPosterEntries }),

  /** Every show and season marked a favourite, most recently marked first. */
  listFavouriteTitles: (): Promise<ItemSummary[]> =>
    expect({ request: send({ path: '/api/favourites/titles' }), guard: isFavouriteTitles }),
})
