import type { AlbumDetails, AlbumSummary, Artist, PlaylistSummary } from '@raven/core'

import { DETAIL_COPY } from '@/screens/copy'
import { countsLineOf, factsLineOf } from '@/ui/counts'

const SECONDS_PER_MINUTE = 60
const MINUTES_PER_HOUR = 60

/** A collection's length in hours and minutes, "1 hr 24 min" or "53 min"; null under half a minute. */
export const lengthOf = (seconds: number): string | null => {
  const minutes = Math.round(seconds / SECONDS_PER_MINUTE)
  const hours = Math.floor(minutes / MINUTES_PER_HOUR)
  const rest = minutes % MINUTES_PER_HOUR
  const parts = [
    ...(hours > 0 ? [DETAIL_COPY.hours(hours)] : []),
    ...(rest > 0 ? [DETAIL_COPY.minutes(rest)] : []),
  ]
  return parts.length === 0 ? null : DETAIL_COPY.length(parts)
}

type AlbumMetaOfProps = {
  details: Pick<AlbumDetails, 'genres'> & {
    album: Pick<AlbumSummary, 'year' | 'trackCount' | 'duration'>
  }
}

/** An album's line under its artist: "Pop · 2014 · 20 songs · 1 hr 24 min". */
export const albumMetaOf = ({ details: { album, genres } }: AlbumMetaOfProps): string =>
  factsLineOf([
    genres[0] ?? null,
    album.year === null ? null : String(album.year),
    countsLineOf({ songs: album.trackCount }),
    lengthOf(album.duration),
  ])

type PlaylistMetaOfProps = { playlist: Pick<PlaylistSummary, 'trackCount' | 'duration'> }

/** A playlist's line under its name: "12 songs · 53 min". */
export const playlistMetaOf = ({ playlist }: PlaylistMetaOfProps): string =>
  factsLineOf([countsLineOf({ songs: playlist.trackCount }), lengthOf(playlist.duration)])

type ArtistMetaOfProps = { artist: Pick<Artist, 'albumCount' | 'trackCount'> }

/** An artist's counts under their name, zeros dropped: "8 albums · 132 songs". */
export const artistMetaOf = ({ artist }: ArtistMetaOfProps): string =>
  countsLineOf({ albums: artist.albumCount, songs: artist.trackCount })
