import type { AlbumSummary, Artist } from '@raven/core'

/** Where one library's listing stands, as `useQueries` reports it. */
type Listing<T> = { data: readonly T[] | undefined; error: Error | null; isSuccess: boolean }

type MergedOfProps<T> = {
  listings: readonly Listing<T>[]
  /** How entries from several libraries are put in one order; one library's keep the server's. */
  order: (entries: readonly T[]) => T[]
}

/**
 * The music libraries' listings as one: every entry read so far, in `order` when there are
 * several libraries, the first failure, and whether every library has answered.
 */
export const mergedOf = <T>({ listings, order }: MergedOfProps<T>) => {
  const entries = listings.flatMap(({ data }) => data ?? [])
  return {
    entries: listings.length > 1 ? order(entries) : entries,
    failure: listings.find(({ error }) => error !== null)?.error ?? null,
    isRead: listings.every(({ isSuccess }) => isSuccess),
  }
}

/** Albums of several libraries, by title as each library sorts its own. */
export const byTitle = (albums: readonly AlbumSummary[]): AlbumSummary[] =>
  albums.toSorted((a, b) => a.sortTitle.localeCompare(b.sortTitle))

/** Artists of several libraries, each once, by name as each library sorts its own. */
export const byName = (artists: readonly Artist[]): Artist[] =>
  [...new Map(artists.map((artist) => [artist.id, artist])).values()].toSorted((a, b) =>
    a.sortName.localeCompare(b.sortName),
  )
