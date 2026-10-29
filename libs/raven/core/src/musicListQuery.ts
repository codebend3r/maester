import { fromQueryString, toQueryString } from '@/query'
import { type Infer, isString, oneOf } from '@/schema'

/** The orders a music listing comes in: albums and tracks alike, artists by name. */
export const MUSIC_SORTS = {
  title: 'title',
  artist: 'artist',
  year: 'year',
  added: 'added',
} as const

export const isMusicSort = oneOf(Object.values(MUSIC_SORTS))

export type MusicSort = Infer<typeof isMusicSort>

/** The most tracks one page of a listing holds, and what a page holds when none is asked for. */
export const MUSIC_PAGE = { most: 500, fallback: 200 } as const

/** What a client asks a music listing for; anything left out takes its default. */
export type MusicListOptions = {
  search?: string
  sort?: MusicSort
  /** How many entries a page holds, up to `MUSIC_PAGE.most`; only the track listing pages. */
  limit?: number
  /** How many entries to skip, for the next page. */
  offset?: number
}

/** A music listing's options as the server reads them, every one filled in. */
export type MusicListParams = Required<MusicListOptions>

const wholeNumber = (value: unknown): number | null => {
  const parsed = isString(value) ? Number.parseInt(value, 10) : Number.NaN
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null
}

/**
 * The `?q=&sort=&limit=&offset=` a library's artists, albums and tracks are
 * listed by: written by the client and read back by the server, so the two
 * agree on it.
 */
export const musicListQuery = {
  encode: ({ search = '', sort = MUSIC_SORTS.title, limit, offset }: MusicListOptions): string =>
    toQueryString({
      sort,
      ...(limit === undefined ? {} : { limit: String(limit) }),
      ...(offset === undefined || offset === 0 ? {} : { offset: String(offset) }),
      ...(search.trim() ? { q: search.trim() } : {}),
    }),

  /** Takes a query string, or the record a server framework parsed it into. */
  decode: (query: string | Record<string, unknown>): MusicListParams => {
    const params: Record<string, unknown> = isString(query) ? fromQueryString(query) : query
    const limit = wholeNumber(params.limit)
    return {
      search: isString(params.q) ? params.q : '',
      sort: isMusicSort(params.sort) ? params.sort : MUSIC_SORTS.title,
      limit: limit === null || limit === 0 ? MUSIC_PAGE.fallback : Math.min(limit, MUSIC_PAGE.most),
      offset: wholeNumber(params.offset) ?? 0,
    }
  },
}
