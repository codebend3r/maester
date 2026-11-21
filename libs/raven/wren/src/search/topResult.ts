import type { AlbumSummary, Artist, Track } from '@raven/core'

/** What the top result is: a song, an album or an artist. */
export const TOP_RESULT_KINDS = { song: 'song', album: 'album', artist: 'artist' } as const

export type TopResult =
  | { kind: typeof TOP_RESULT_KINDS.song; track: Track }
  | { kind: typeof TOP_RESULT_KINDS.album; album: AlbumSummary }
  | { kind: typeof TOP_RESULT_KINDS.artist; artist: Artist }

type TopResultOfProps = {
  query: string
  albums: readonly AlbumSummary[]
  artists: readonly Artist[]
  songs: readonly Track[]
}

type IsNamedProps = { name: string; query: string }

const isNamed = ({ name, query }: IsNamedProps): boolean =>
  name.toLocaleLowerCase() === query.toLocaleLowerCase()

/**
 * The result a search most likely meant: an artist or an album named exactly what was typed,
 * else the first song, else the first album, else the first artist; null when nothing matched.
 */
export const topResultOf = ({
  query,
  albums,
  artists,
  songs,
}: TopResultOfProps): TopResult | null => {
  const term = query.trim()
  const artist = artists.find(({ name }) => isNamed({ name, query: term }))
  if (artist !== undefined) return { kind: TOP_RESULT_KINDS.artist, artist }
  const album = albums.find(({ title }) => isNamed({ name: title, query: term }))
  if (album !== undefined) return { kind: TOP_RESULT_KINDS.album, album }
  const [firstSong] = songs
  if (firstSong !== undefined) return { kind: TOP_RESULT_KINDS.song, track: firstSong }
  const [firstAlbum] = albums
  if (firstAlbum !== undefined) return { kind: TOP_RESULT_KINDS.album, album: firstAlbum }
  const [firstArtist] = artists
  return firstArtist === undefined ? null : { kind: TOP_RESULT_KINDS.artist, artist: firstArtist }
}
