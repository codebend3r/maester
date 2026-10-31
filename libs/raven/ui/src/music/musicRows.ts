import {
  type AlbumSummary,
  type PlaylistSummary,
  type Queue,
  type Track,
  artistNames,
  formatDuration,
  orderedOf,
  plural,
} from '@raven/core'

import { MUSIC_ROWS_COPY } from '@/music/copy'

type PlaylistFactsOfProps = { playlist: PlaylistSummary }

/** A playlist's facts on one line: "12 tracks · 53 min", the minutes left out under one. */
export const playlistFactsOf = ({ playlist }: PlaylistFactsOfProps): string => {
  const minutes = Math.round(playlist.duration / 60)
  return MUSIC_ROWS_COPY.facts([
    plural({ n: playlist.trackCount, ...MUSIC_ROWS_COPY.tracks }),
    ...(minutes > 0 ? [MUSIC_ROWS_COPY.minutes(minutes)] : []),
  ])
}

/** One track of a playlist's page, as every app draws it. */
export type PlaylistTrack = {
  /** Its media id and place, since a playlist may hold one track twice. */
  key: string
  id: number
  /** Its place in the playlist, which Play, Move up and Remove name. */
  index: number
  title: string
  line: string
  length: string
  /** What it is called aloud: "1. Airbag". */
  label: string
}

type PlaylistTracksOfProps = { tracks: readonly Track[] }

/** A playlist's tracks in order, each with its artists and length. */
export const playlistTracksOf = ({ tracks }: PlaylistTracksOfProps): PlaylistTrack[] =>
  tracks.map((track, index) => ({
    key: `${track.id}:${index}`,
    id: track.id,
    index,
    title: track.title,
    line: artistNames(track),
    length: formatDuration(track.duration),
    label: MUSIC_ROWS_COPY.numbered({ place: index + 1, title: track.title }),
  }))

type AlbumFactsOfProps = { album: AlbumSummary }

/** An album's facts on one line: "1997 · 12 tracks · 53:21". */
export const albumFactsOf = ({ album }: AlbumFactsOfProps): string =>
  MUSIC_ROWS_COPY.facts(
    [
      album.year === null ? null : String(album.year),
      plural({ n: album.trackCount, ...MUSIC_ROWS_COPY.tracks }),
      formatDuration(album.duration),
    ].filter((fact): fact is string => fact !== null),
  )

/** One track of an album's page, as every app draws it. */
export type AlbumTrack = {
  key: string
  /** The track's media id, to say whether it is the one playing. */
  id: number
  /** Where it sits in the album's tracks, which Play starts from. */
  index: number
  /** Its number on its disc, or its place in the album when the tags say none. */
  number: string
  title: string
  length: string
  /** What it is called aloud: "1. Airbag". */
  label: string
}

/** One disc of an album's page: its heading, on an album of several, and its tracks. */
export type AlbumDisc = { key: string; title: string | null; tracks: AlbumTrack[] }

type AlbumDiscsOfProps = { tracks: readonly Track[]; discCount: number }

/** An album's tracks by disc, each disc titled only when the album has more than one. */
export const albumDiscsOf = ({ tracks, discCount }: AlbumDiscsOfProps): AlbumDisc[] =>
  Array.from({ length: Math.max(1, discCount) }, (_, at) => at + 1).map((disc) => ({
    key: String(disc),
    title: discCount > 1 ? MUSIC_ROWS_COPY.disc(disc) : null,
    tracks: tracks.flatMap((track, index) =>
      track.disc === disc
        ? [
            {
              key: String(track.id),
              id: track.id,
              index,
              number: String(track.number ?? index + 1),
              title: track.title,
              length: formatDuration(track.duration),
              label: MUSIC_ROWS_COPY.numbered({ place: index + 1, title: track.title }),
            },
          ]
        : [],
    ),
  }))

/** One row of the queue on Now Playing, as every app draws it: a track in play order. */
export type QueueRow = {
  key: string
  /** Where it sits in the play order, which a jump or a remove names. */
  place: number
  title: string
  line: string
  isCurrent: boolean
}

type QueueRowsOfProps = { queue: Queue; tracks: Readonly<Record<number, Track>> }

/** The queue in play order, each track the store knows, keyed by its place so a repeat is its own row. */
export const queueRowsOf = ({ queue, tracks }: QueueRowsOfProps): QueueRow[] =>
  orderedOf(queue).flatMap(({ id, isCurrent }, place) => {
    const track = tracks[id]
    return track === undefined
      ? []
      : [{ key: `${id}:${place}`, place, title: track.title, line: artistNames(track), isCurrent }]
  })

type PlayTimeOfProps = { position: number; duration: number | null }

/** How far the track has played and how long it is: "1:02 / 4:44". */
export const playTimeOf = ({ position, duration }: PlayTimeOfProps): string =>
  MUSIC_ROWS_COPY.playTime({ at: formatDuration(position), length: formatDuration(duration) })
