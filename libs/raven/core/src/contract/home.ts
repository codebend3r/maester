import { isItemSummary, isMediaItem, isMediaList, isShowEntry } from '@/contract/items'
import {
  type Infer,
  isBoolean,
  isNumber,
  isString,
  listOf,
  nullable,
  object,
  oneOf,
  union,
} from '@/schema'

export const HOME_SHELF_TYPES = { shows: 'shows', media: 'media' } as const

/**
 * A library's row on the home page: a pinned library's newest arrivals,
 * newest first, or what a search found in it, by title. A TV shows library
 * gives its shows; any other library gives its videos.
 */
export const isHomeShelf = union(
  object({
    libraryId: isNumber,
    type: oneOf([HOME_SHELF_TYPES.shows]),
    shows: listOf(isShowEntry),
  }),
  object({ libraryId: isNumber, type: oneOf([HOME_SHELF_TYPES.media]), media: isMediaList }),
)

export type HomeShelf = Infer<typeof isHomeShelf>

/**
 * A video, and the item whose poster its card shows: the movie, or an
 * episode's season (else its show); null for a file matched to none.
 */
export const isPosterEntry = object({ media: isMediaItem, poster: nullable(isItemSummary) })

export type PosterEntry = Infer<typeof isPosterEntry>

/**
 * `GET /api/favourites`: every favourite with its poster, most recently
 * marked first. A library's own favourites and videos in progress come the
 * same way.
 */
export const isPosterEntries = listOf(isPosterEntry)

/**
 * `GET /api/favourites/titles`: every show and season marked a favourite,
 * most recently marked first. Videos are favourites by file, in
 * `GET /api/favourites`.
 */
export const isFavouriteTitles = listOf(isItemSummary)

/** `GET /api/home`: every video in progress, then each pinned library's shelf, as the side menu orders them. */
export const isHome = object({
  /** Videos with a saved spot, the most recently watched first. */
  inProgress: isPosterEntries,
  shelves: listOf(isHomeShelf),
})

export type Home = Infer<typeof isHome>

/**
 * `GET /api/home/search?q=`: a row for each library holding a match, as the
 * side menu orders them, and none for a library with nothing that matches.
 */
export const isHomeSearch = listOf(isHomeShelf)

export type HomeSearch = Infer<typeof isHomeSearch>

/**
 * One title in home's hero: a show with what its card shows, or a movie's
 * best file, in the library that holds it, and the line the hero reads under
 * its title (its summary, else its tagline).
 */
export const isHeroEntry = union(
  object({
    libraryId: isNumber,
    type: oneOf([HOME_SHELF_TYPES.shows]),
    entry: isShowEntry,
    line: nullable(isString),
  }),
  object({
    libraryId: isNumber,
    type: oneOf([HOME_SHELF_TYPES.media]),
    media: isMediaItem,
    line: nullable(isString),
  }),
)

export type HeroEntry = Infer<typeof isHeroEntry>

/**
 * `GET /api/home/hero`: the titles home's hero takes turns with. The ones the
 * admin picked when any are picked, else each pinned library's newest
 * released title, a round at a time; never more than the server's
 * `HERO_COUNT`.
 */
export const isHero = listOf(isHeroEntry)

export type Hero = Infer<typeof isHero>

/**
 * `GET /api/hero/picks`: the movies and shows the admin picked for the hero,
 * in the order they were picked, and how many titles the hero holds at most.
 */
export const isHeroPicks = object({ itemIds: listOf(isNumber), limit: isNumber })

export type HeroPicks = Infer<typeof isHeroPicks>

/** `PUT /api/hero/picks`: a movie or show to add to the hero, or take out of it. */
export const isHeroPickChange = object({ itemId: isNumber, isShown: isBoolean })

export type HeroPickChange = Infer<typeof isHeroPickChange>
