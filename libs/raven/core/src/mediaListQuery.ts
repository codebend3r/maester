import { MEDIA_SORTS, type MediaSort, isMediaSort } from '@/contract'
import { fromQueryString, toQueryString } from '@/query'
import { isString } from '@/schema'

/** What a client asks a library's listing for; anything left out takes its default. */
export type MediaListOptions = {
  search?: string
  sort?: MediaSort
  /** Only counts with a random sort: the same seed deals the same order. */
  seed?: number
}

/** A listing's options as the server reads them, every one filled in. */
export type MediaListParams = Required<MediaListOptions>

/**
 * The `?q=&sort=&seed=` a library's videos and shows are listed by: written
 * by the client and read back by the server, so the two agree on it.
 */
export const mediaListQuery = {
  encode: ({ search = '', sort = MEDIA_SORTS.title, seed }: MediaListOptions): string =>
    toQueryString({
      sort,
      ...(sort === MEDIA_SORTS.random && seed !== undefined ? { seed: String(seed) } : {}),
      ...(search.trim() ? { q: search.trim() } : {}),
    }),

  /** Takes a query string, or the record a server framework parsed it into. */
  decode: (query: string | Record<string, unknown>): MediaListParams => {
    const params: Record<string, unknown> = isString(query) ? fromQueryString(query) : query
    const seed = isString(params.seed) ? Number.parseInt(params.seed, 10) : Number.NaN
    return {
      search: isString(params.q) ? params.q : '',
      sort: isMediaSort(params.sort) ? params.sort : MEDIA_SORTS.title,
      seed: Number.isInteger(seed) ? seed : 0,
    }
  },
}
