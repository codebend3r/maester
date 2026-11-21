import { KIT_COPY } from '@/copy/kit'
import { LIBRARY_COPY, LIBRARY_PAGE_COPY } from '@/copy/screens'

/** Where one library's listing stands, as `useQueries` reports it. */
type Listing<T> = { data: readonly T[] | undefined; error: Error | null; isSuccess: boolean }

/** Where the music libraries themselves stand, as each app's `useMusicLibraries` reports them. */
type MusicLibraries = { libraries: readonly unknown[]; isRead: boolean; failure: Error | null }

/** Where a list over every music library stands: why it failed, whether it is read, and whether raven holds no music. */
export type ListState = { failure: Error | null; isRead: boolean; hasNoMusic: boolean }

/** Where one query stands, as TanStack Query reports it. */
type QueryState = Pick<Listing<unknown>, 'error' | 'isSuccess'>

/** A list one query reads that no music library holds, such as the account's playlists. */
export const queryListStateOf = ({ error, isSuccess }: QueryState): ListState => ({
  failure: error,
  isRead: isSuccess,
  hasNoMusic: false,
})

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

/** Where one library's count stands, as `useQueries` reports it. */
type Count = { data: number | undefined; isSuccess: boolean }

type SongCountOfProps = { music: Pick<MusicLibraries, 'isRead'>; counts: readonly Count[] }

/**
 * Every music library's count added up; null until the libraries and every count have answered,
 * or when one could not, so a count is never guessed.
 */
export const songCountOf = ({ music, counts }: SongCountOfProps): number | null => {
  if (!music.isRead || !counts.every(({ isSuccess }) => isSuccess)) return null
  return counts.reduce((sum, { data }) => sum + (data ?? 0), 0)
}

type EmptyCopyOfProps = {
  /** What the list was searched for; blank when nothing was typed. */
  query: string
  /** What the list says when it holds nothing at all. */
  none: string
}

/** What a searchable list says when it shows nothing: that it holds none, or that nothing matches. */
export const emptyCopyOf = ({ query, none }: EmptyCopyOfProps): string =>
  query === '' ? none : LIBRARY_PAGE_COPY.noMatches

type ListNoticeOfProps = { listing: ListState; empty: string }

/**
 * What a list says in place of its entries: that it could not be read, that it is, that raven
 * holds no music, or that it is empty.
 */
export const listNoticeOf = ({
  listing: { failure, isRead, hasNoMusic },
  empty,
}: ListNoticeOfProps): string => {
  if (failure !== null) return LIBRARY_PAGE_COPY.failed
  if (!isRead) return KIT_COPY.loading
  return hasNoMusic ? LIBRARY_COPY.noMusic : empty
}
