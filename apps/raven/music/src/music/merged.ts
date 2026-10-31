import type { AlbumSummary, Artist } from '@raven/core'

import type { useMusicLibraries } from '@/music/musicLibraries'

/** Where one library's listing stands, as `useQueries` reports it. */
type Listing<T> = { data: readonly T[] | undefined; error: Error | null; isSuccess: boolean }

/** Where the music libraries themselves stand. */
type MusicLibraries = ReturnType<typeof useMusicLibraries>

/** Where a list over every music library stands: why it failed, whether it is read, and whether raven holds no music. */
export type ListState = { failure: Error | null; isRead: boolean; hasNoMusic: boolean }

type ListStateOfProps = { music: MusicLibraries } & Pick<ListState, 'failure' | 'isRead'>

/** A list over every music library with nothing of its own to merge, such as the songs' one query. */
export const listStateOf = ({ music, failure, isRead }: ListStateOfProps): ListState => {
  const hasNoMusic = music.isRead && music.libraries.length === 0
  return {
    failure: music.failure ?? failure,
    isRead: music.isRead && (hasNoMusic || isRead),
    hasNoMusic,
  }
}

type MergedOfProps<T> = {
  music: MusicLibraries
  listings: readonly Listing<T>[]
  /** How entries from several libraries are put in one order; one library's keep the server's. */
  order: (entries: readonly T[]) => T[]
}

/**
 * The music libraries' listings as one: every entry read so far, in `order` when there are
 * several libraries, and the list's state folded with the libraries': the first failure,
 * whether the libraries and every listing have answered, and whether raven holds no music.
 */
export const mergedOf = <T>({ music, listings, order }: MergedOfProps<T>) => {
  const entries = listings.flatMap(({ data }) => data ?? [])
  return {
    entries: listings.length > 1 ? order(entries) : entries,
    ...listStateOf({
      music,
      failure: listings.find(({ error }) => error !== null)?.error ?? null,
      isRead: listings.every(({ isSuccess }) => isSuccess),
    }),
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
