import {
  type AlbumDetails,
  type AlbumSummary,
  type Artist,
  MUSIC_FACTS,
  type MusicFactWording,
  type PlaylistSummary,
  albumDateLabel,
  formatCount,
} from '@raven/core'

import { DETAIL_COPY } from '@/copy/screens'
import { factsLineOf } from '@/copy/kit'
import { countsLineOf } from '@/counts'
import { qualityLineOf } from '@/nowPlaying/quality'

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
    album: Pick<AlbumSummary, 'year' | 'releaseDate' | 'trackCount' | 'duration'>
  }
}

/**
 * An album's line under its artist: "Pop · November 15, 2011 · 17 songs · 1 hr 20 min", its
 * release date as precise as it is known, else its year.
 */
export const albumMetaOf = ({ details: { album, genres } }: AlbumMetaOfProps): string =>
  factsLineOf([
    genres[0] ?? null,
    albumDateLabel({ releaseDate: album.releaseDate, year: album.year }),
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

/**
 * How Wren words and orders a held cover's facts. An album's: its kind when it is not a plain
 * album, its release date, its genres and label, its songs, its length and the format its files
 * share. A song's: its album, the album's release date and genres, its length and its file's
 * format. Its title and artists are the sheet's head, so they are not facts here.
 */
export const COVER_FACT_WORDING = {
  albumFacts: [
    MUSIC_FACTS.kind,
    MUSIC_FACTS.released,
    MUSIC_FACTS.genres,
    MUSIC_FACTS.label,
    MUSIC_FACTS.tracks,
    MUSIC_FACTS.length,
    MUSIC_FACTS.format,
  ],
  trackFacts: [
    MUSIC_FACTS.album,
    MUSIC_FACTS.released,
    MUSIC_FACTS.genres,
    MUSIC_FACTS.length,
    MUSIC_FACTS.format,
  ],
  /** "12", the label saying they are songs; unsaid when there are none. */
  trackCount: (count: number) => (count > 0 ? formatCount(count) : null),
  /** "Rock · Electronic". */
  genres: factsLineOf,
  albumLength: lengthOf,
  /** "FLAC · 16-bit / 44.1 kHz · 912 kbps". */
  quality: qualityLineOf,
} as const satisfies MusicFactWording
