import { isItemSummary, isMediaItem, isMediaList, isShowEntry } from '@/contract/items'
import { isAlbumList } from '@/contract/music'
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
  literal,
} from '@/schema'

export const HOME_SHELF_TYPES = { shows: 'shows', media: 'media' } as const

/**
 * The two orders a library's shelf on Home comes in: what the library gained last first, or
 * what came out last first (a film's or a show's year, an album's release).
 */
export const SHELF_ORDERS = { added: 'added', released: 'released' } as const

export type ShelfOrder = (typeof SHELF_ORDERS)[keyof typeof SHELF_ORDERS]

export const isShelfOrder = oneOf(Object.values(SHELF_ORDERS))

/** The order a shelf comes in when nothing names one. */
export const DEFAULT_SHELF_ORDER: ShelfOrder = SHELF_ORDERS.added

/** The query parameter `GET /api/home` and `GET /api/home/albums` take a shelf order in: `?order=`. */
export const SHELF_ORDER_PARAM = 'order'

/**
 * A library's row on the home page: a library's newest arrivals or newest
 * releases, as `?order=` asks, or what a search found in it, by title. A TV shows library
 * gives its shows; any other library gives its videos.
 */
export const isHomeShelf = union(
  object({
    libraryId: isNumber,
    type: literal(HOME_SHELF_TYPES.shows),
    shows: listOf(isShowEntry),
  }),
  object({ libraryId: isNumber, type: literal(HOME_SHELF_TYPES.media), media: isMediaList }),
)

export type HomeShelf = Infer<typeof isHomeShelf>

/** A music library's row on the home page: its albums, the one added or released last first, one cover for each. */
export const isAlbumShelf = object({ libraryId: isNumber, albums: isAlbumList })

export type AlbumShelf = Infer<typeof isAlbumShelf>

/**
 * `GET /api/home/albums?order=`: a shelf of albums for each music library, as
 * the side menu orders them, the newest arrivals first when no order is named. Read apart from the shelves, which keep each
 * music library's files for the clients that do not draw albums.
 */
export const isAlbumShelves = listOf(isAlbumShelf)

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

/**
 * `GET /api/home?order=`: every video in progress, then each library's shelf in that order (the
 * newest arrivals when none is named), as the side menu orders them.
 */
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
    type: literal(HOME_SHELF_TYPES.shows),
    entry: isShowEntry,
    line: nullable(isString),
  }),
  object({
    libraryId: isNumber,
    type: literal(HOME_SHELF_TYPES.media),
    media: isMediaItem,
    line: nullable(isString),
  }),
)

export type HeroEntry = Infer<typeof isHeroEntry>

/**
 * `GET /api/home/hero`: the titles home's hero takes turns with. The ones the
 * admin picked when any are picked, else each included library's newest
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
