import { type AlbumSummary, type PlaylistSummary, type Track, artistNames } from '@/contract'
import { formatDuration } from '@/format'
import { plural } from '@/plural'
import { type Queue, orderedOf } from '@/queue'

type NumberedProps = { place: number; title: string }

/** The words the shared music rows say, in every app. */
export const MUSIC_ROWS_COPY = {
  /** A disc's heading on an album of several. */
  disc: (n: number) => `Disc ${n}`,
  tracks: { one: 'track', many: 'tracks' },
  /** A playlist's length in whole minutes: "53 min". */
  minutes: (minutes: number) => `${minutes} min`,
  /** Facts on one line: "1997 · 12 tracks · 53:21". */
  facts: (facts: readonly string[]) => facts.join(' · '),
  /** A track as it is read out: "1. Airbag". */
  numbered: ({ place, title }: NumberedProps) => `${place}. ${title}`,
  /** How long is left of the track, as a scrubber's end says it: "-3:42". */
  remaining: (left: string) => `-${left}`,
} as const

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
  /** The track itself, for what a row's menu and cover read. */
  track: Track
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
    track,
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
  /** The track itself, for what a row's menu reads. */
  track: Track
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
              track,
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
  /** The track itself, for what a row's menu and cover read. */
  track: Track
  title: string
  line: string
  /** How long the track runs, "4:05", so every listing of songs says it. */
  length: string
  isCurrent: boolean
}

type QueueRowsOfProps = { queue: Queue; tracks: Readonly<Record<number, Track>> }

/** The queue in play order, each track the store knows, keyed by its place so a repeat is its own row. */
export const queueRowsOf = ({ queue, tracks }: QueueRowsOfProps): QueueRow[] =>
  orderedOf(queue).flatMap(({ id, isCurrent }, place) => {
    const track = tracks[id]
    return track === undefined
      ? []
      : [
          {
            key: `${id}:${place}`,
            place,
            track,
            title: track.title,
            line: artistNames(track),
            length: formatDuration(track.duration),
            isCurrent,
          },
        ]
  })

type RemainingTimeOfProps = { position: number; length: number }

/** How long is left of the track, never less than none: "-3:42". */
export const remainingTimeOf = ({ position, length }: RemainingTimeOfProps): string =>
  MUSIC_ROWS_COPY.remaining(formatDuration(Math.max(length - position, 0)))
