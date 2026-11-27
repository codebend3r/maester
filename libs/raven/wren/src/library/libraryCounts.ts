import type { LibraryCounts } from '@raven/core'

import { LIBRARY_PAGE_COPY } from '@/copy/screens'
import { countValueOf } from '@/counts'
import { songCountOf } from '@/library/listState'
import { LIBRARY_SEGMENTS, type SharedSegment } from '@/library/segments'

/** How many songs Recently finished lists, as raven's own tab lists them; past it the count reads "48+". */
export const FINISHED_SHOWN = 48

/** Where one music library's counts stand, as `useQueries` reports them. */
type CountsRead = { data: LibraryCounts | undefined; isSuccess: boolean }

/** A count the server keeps for each library. */
type Tally = keyof LibraryCounts

/** The server's counts a category reads, by their names in `LibraryCounts`. */
const TALLIES = {
  albums: 'albums',
  artists: 'artists',
  unmatchedAlbums: 'unmatchedAlbums',
  favourites: 'favourites',
} as const satisfies Record<string, Tally>

type TallyOfProps = {
  music: { isRead: boolean }
  counts: readonly CountsRead[]
  tally: Tally
}

/**
 * One of the server's counts added up over every music library; null until the libraries and
 * every library's counts have answered, when one could not, or when one leaves it out (an older
 * server counts no albums or artists), so a count is never guessed.
 */
const tallyOf = ({ music, counts, tally }: TallyOfProps): number | null =>
  songCountOf({
    music,
    counts: counts.map(({ data, isSuccess }) => ({
      data: data?.[tally],
      isSuccess: isSuccess && data?.[tally] !== undefined,
    })),
  })

type LibraryValuesOfProps = {
  music: { isRead: boolean }
  /** Each music library's counts, `libraryCountsQuery`'s answers. */
  counts: readonly CountsRead[]
  /** The account's playlists, or null until they are read. */
  playlists: number | null
  /** Every music library's songs, or null until they are counted. */
  songs: number | null
  /** The songs left partway and played to their end on this device, in the libraries worn. */
  progress: { inProgress: number; finished: number }
}

/**
 * What each category Wren shares with the web holds, beside its row: its count over every music
 * library (In progress and Recently finished from this device's own), "None yet" beside
 * Playlists, and nothing while a count is on its way, failed or none, so a zero is never shown.
 */
export const libraryValuesOf = ({
  music,
  counts,
  playlists,
  songs,
  progress,
}: LibraryValuesOfProps): Record<SharedSegment, string | undefined> => {
  const valueOf = (tally: Tally) => countValueOf({ n: tallyOf({ music, counts, tally }) })
  return {
    [LIBRARY_SEGMENTS.albums]: valueOf(TALLIES.albums),
    [LIBRARY_SEGMENTS.artists]: valueOf(TALLIES.artists),
    [LIBRARY_SEGMENTS.playlists]: countValueOf({ n: playlists, none: LIBRARY_PAGE_COPY.noneYet }),
    [LIBRARY_SEGMENTS.unmatchedAlbums]: valueOf(TALLIES.unmatchedAlbums),
    [LIBRARY_SEGMENTS.inProgress]: countValueOf({ n: music.isRead ? progress.inProgress : null }),
    [LIBRARY_SEGMENTS.favourites]: valueOf(TALLIES.favourites),
    [LIBRARY_SEGMENTS.finished]: countValueOf({
      n: music.isRead ? progress.finished : null,
      most: FINISHED_SHOWN,
    }),
    [LIBRARY_SEGMENTS.songs]: countValueOf({ n: songs }),
  }
}
