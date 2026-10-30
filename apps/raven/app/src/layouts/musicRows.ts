import {
  type AlbumSummary,
  type Chapter,
  LYRICS_KINDS,
  type Lyrics,
  type PlaylistSummary,
  type Queue,
  type Track,
  artistNames,
  formatDuration,
  orderedOf,
  plural,
} from '@raven/core'
import { activeLineAt } from '@raven/ui/headless'

import { MUSIC_COPY } from '@/layouts/copy'
import { type BookControls, NOW_PLAYING_ASIDES, type NowPlayingAside } from '@/layouts/musicKit'

type PlaylistFactsOfProps = { playlist: PlaylistSummary }

/** A playlist's facts on one line: "12 tracks · 53 min", the minutes left out under one. */
export const playlistFactsOf = ({ playlist }: PlaylistFactsOfProps): string => {
  const minutes = Math.round(playlist.duration / 60)
  return MUSIC_COPY.facts([
    plural({ n: playlist.trackCount, ...MUSIC_COPY.tracks }),
    ...(minutes > 0 ? [MUSIC_COPY.minutes(minutes)] : []),
  ])
}

/** One track of a playlist's page, as both layouts draw it. */
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
    label: MUSIC_COPY.numbered({ place: index + 1, title: track.title }),
  }))

/** One line of synced lyrics as both layouts draw it, a line with no words as a note. */
type LyricRow = { key: string; text: string; isCurrent: boolean }

/** Synced lyrics as rows, with the place of the line being sung, or null before the first. */
export type SyncedLyrics = {
  kind: typeof LYRICS_KINDS.synced
  lines: LyricRow[]
  current: number | null
}

/** The playing track's lyrics as both layouts draw them: timed lines, plain text, or none. */
export type LyricsView =
  | SyncedLyrics
  | { kind: typeof LYRICS_KINDS.plain; text: string }
  | { kind: typeof LYRICS_KINDS.none }

type LyricsViewOfProps = {
  lyrics: Lyrics
  /** Seconds into the track. */
  at: number
}

/** The lyrics to draw, synced lines as rows with the one being sung at `at` marked. */
const lyricsViewOf = ({ lyrics, at }: LyricsViewOfProps): LyricsView => {
  switch (lyrics.kind) {
    case LYRICS_KINDS.synced: {
      const current = activeLineAt({ lines: lyrics.lines, at })
      return {
        kind: LYRICS_KINDS.synced,
        current,
        lines: lyrics.lines.map((line, place) => ({
          // A song repeats lines, so a line is known by its place and time.
          key: `${place}:${line.at}`,
          text: line.text === '' ? MUSIC_COPY.instrumental : line.text,
          isCurrent: place === current,
        })),
      }
    }
    case LYRICS_KINDS.plain:
      return { kind: LYRICS_KINDS.plain, text: lyrics.text }
    case LYRICS_KINDS.none:
      return lyrics
    default: {
      const unknown: never = lyrics
      return unknown
    }
  }
}

type NowPlayingAsideOfProps = {
  /** The book's controls, or null for music. */
  book: BookControls | null
  /** The playing track's lyrics, or null while they are read and while nothing plays. */
  lyrics: Lyrics | null
  /** Seconds into the track. */
  at: number
}

/** What Now Playing draws below the controls: a book's controls, else the lyrics once read. */
export const nowPlayingAsideOf = ({
  book,
  lyrics,
  at,
}: NowPlayingAsideOfProps): NowPlayingAside => {
  if (book !== null) return { kind: NOW_PLAYING_ASIDES.book, book }
  if (lyrics === null) return { kind: NOW_PLAYING_ASIDES.none }
  return { kind: NOW_PLAYING_ASIDES.lyrics, lyrics: lyricsViewOf({ lyrics, at }) }
}

/** One chapter of an audiobook on Now Playing. */
export type ChapterRow = {
  key: string
  /** Where the chapter starts, in seconds, which a press seeks to. */
  start: number
  title: string
  /** "12:40". */
  at: string
  /** What it is called aloud: "Opening, 0:00". */
  label: string
  isCurrent: boolean
}

type ChapterRowsOfProps = { chapters: readonly Chapter[]; current: number | null }

/** A book's chapters as rows, each named by its title or its place, the one playing marked. */
export const chapterRowsOf = ({ chapters, current }: ChapterRowsOfProps): ChapterRow[] =>
  chapters.map((chapter, place) => {
    const title = chapter.title ?? MUSIC_COPY.chapter(place + 1)
    const at = formatDuration(chapter.start)
    return {
      key: String(chapter.start),
      start: chapter.start,
      title,
      at,
      label: MUSIC_COPY.chapterLabel({ title, at }),
      isCurrent: place === current,
    }
  })

type AlbumFactsOfProps = { album: AlbumSummary }

/** An album's facts on one line: "1997 · 12 tracks · 53:21". */
export const albumFactsOf = ({ album }: AlbumFactsOfProps): string =>
  MUSIC_COPY.facts(
    [
      album.year === null ? null : String(album.year),
      plural({ n: album.trackCount, ...MUSIC_COPY.tracks }),
      formatDuration(album.duration),
    ].filter((fact): fact is string => fact !== null),
  )

/** One track of an album's page, as both layouts draw it. */
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
    title: discCount > 1 ? MUSIC_COPY.disc(disc) : null,
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
              label: MUSIC_COPY.numbered({ place: index + 1, title: track.title }),
            },
          ]
        : [],
    ),
  }))

/** One row of the queue on Now Playing: a track in play order. */
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
  MUSIC_COPY.playTime({ at: formatDuration(position), length: formatDuration(duration) })
