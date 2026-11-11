import { isMatchItemType } from '@/contract/items'
import { type Infer, isString, listOf, nullable, object, oneOf } from '@/schema'

/** Where the server answers with what is coming soon. */
export const UPCOMING_PATH = '/api/upcoming'

/** Coming soon's shelves, each also a page of its own. */
export const UPCOMING_SHELVES = {
  movies: 'movies',
  shows: 'shows',
  documentaries: 'documentaries',
} as const

export type UpcomingShelf = (typeof UPCOMING_SHELVES)[keyof typeof UPCOMING_SHELVES]

export const isUpcomingShelf = oneOf(Object.values(UPCOMING_SHELVES))

/** The parameters of a shelf's own pages: which shelf, and the cursor a page before answered as `next`. */
export const UPCOMING_PARAMS = { shelf: 'shelf', after: 'after' } as const

/** Where the server answers with one shelf a page at a time, the soonest out first. */
export const UPCOMING_SHELF_PATH = `${UPCOMING_PATH}/:${UPCOMING_PARAMS.shelf}`

/** How many titles the server sends for each of Coming soon's shelves: two rows of eight, or one. */
export const UPCOMING_SHELF_SIZES = {
  [UPCOMING_SHELVES.movies]: 16,
  [UPCOMING_SHELVES.shows]: 16,
  [UPCOMING_SHELVES.documentaries]: 8,
} as const satisfies Record<UpcomingShelf, number>

/** How many titles a page of a shelf of its own holds at most. */
export const UPCOMING_PAGE_SIZE = 20

/** A movie or show TMDB says is still to come, whether or not raven holds it. */
export const isUpcomingTitle = object({
  type: isMatchItemType,
  tmdbId: isString,
  title: isString,
  /** `YYYY-MM-DD`: a movie's release, or a show's first episode. */
  released: isString,
  /** TMDB's poster path, served through `/api/images/poster`. */
  poster: isString,
})

export type UpcomingTitle = Infer<typeof isUpcomingTitle>

/** `titles` with each movie or show once, where it first comes: TMDB can list one twice. */
export const uniqueUpcomingTitles = <Title extends Pick<UpcomingTitle, 'type' | 'tmdbId'>>(
  titles: readonly Title[],
): Title[] =>
  titles.filter(
    (title, index) =>
      titles.findIndex((other) => other.type === title.type && other.tmdbId === title.tmdbId) ===
      index,
  )

/**
 * Coming soon's three shelves, the most popular first in each: movies and
 * shows that are no documentary, then the documentaries of both kinds.
 */
export const isUpcoming = object({
  movies: listOf(isUpcomingTitle),
  shows: listOf(isUpcomingTitle),
  documentaries: listOf(isUpcomingTitle),
})

export type Upcoming = Infer<typeof isUpcoming>

/**
 * A page of one shelf, the soonest out first. `next` is the cursor for the
 * page after it, null on the last; a page may hold fewer than
 * `UPCOMING_PAGE_SIZE` titles and still have one after it.
 */
export const isUpcomingPage = object({
  titles: listOf(isUpcomingTitle),
  next: nullable(isString),
})

export type UpcomingPage = Infer<typeof isUpcomingPage>
