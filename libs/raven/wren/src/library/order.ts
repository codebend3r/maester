import type { AlbumSummary, Artist } from '@raven/core'

/** Two albums by title, as each library sorts its own. */
export const byTitle = (a: AlbumSummary, b: AlbumSummary): number =>
  a.sortTitle.localeCompare(b.sortTitle)

/** Albums of several libraries by title, as each library sorts its own. */
export const albumsByTitle = (albums: readonly AlbumSummary[]): AlbumSummary[] =>
  albums.toSorted(byTitle)

/** Artists of several libraries, each once, by name as each library sorts its own. */
export const artistsByName = (artists: readonly Artist[]): Artist[] =>
  [...new Map(artists.map((artist) => [artist.id, artist])).values()].toSorted((a, b) =>
    a.sortName.localeCompare(b.sortName),
  )
