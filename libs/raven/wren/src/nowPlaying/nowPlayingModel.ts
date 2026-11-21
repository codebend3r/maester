import {
  type Lyrics,
  LYRICS_KINDS,
  NO_LYRICS,
  type Queue,
  type QueueSource,
  QUEUE_SOURCE_KINDS,
  type Track,
  queueRowsOf,
} from '@raven/core'

import { PLAYER_COPY } from '@/copy/kit'
import { NOW_PLAYING_COPY } from '@/copy/screens'

/** What Now Playing shows under its header: the player, the lyrics, or what plays next. */
export const PANES = { player: 'player', lyrics: 'lyrics', upNext: 'upNext' } as const

export type Pane = (typeof PANES)[keyof typeof PANES]

type PaneAfterProps = { current: Pane; pressed: Pane }

/** The pane a press on the bottom bar leaves showing: the one pressed, or the player again when it was already open. */
export const paneAfter = ({ current, pressed }: PaneAfterProps): Pane =>
  pressed === current ? PANES.player : pressed

/** What one of the bottom bar's buttons says: its name, and the words beside its icon, if any. */
type BarWords = { label: string; text: string | null }

type BarWordsOfProps = {
  pane: Pane
  /** Where the music plays, "raven · This iPhone". */
  output: string
}

/** A bottom bar button's words: Lyrics and Up next by name alone, the player's as where it plays. */
export const barWordsOf = ({ pane, output }: BarWordsOfProps): BarWords => {
  const words = {
    [PANES.player]: { label: output, text: output },
    [PANES.lyrics]: { label: PLAYER_COPY.lyrics, text: null },
    [PANES.upNext]: { label: PLAYER_COPY.upNext, text: null },
  } as const satisfies Record<Pane, BarWords>
  return words[pane]
}

/** A song still to play, as Up next lists it. */
export type UpNextRow = {
  key: string
  /** Where it sits in the play order, which a jump, a move or a remove names. */
  place: number
  track: Track
  /** "Sia · 3:36". */
  line: string
  /** How a screen reader names it: "Chandelier, Sia". */
  label: string
}

type UpNextRowsOfProps = { queue: Queue; tracks: Readonly<Record<number, Track>> }

/** The songs after the one playing, in play order, keyed by their place so a repeat is its own row. */
export const upNextRowsOf = ({ queue, tracks }: UpNextRowsOfProps): UpNextRow[] =>
  queueRowsOf({ queue, tracks })
    .filter(({ place }) => queue.at === null || place > queue.at)
    .map(({ key, place, track, title, line, length }) => ({
      key,
      place,
      track,
      line: NOW_PLAYING_COPY.rowLine({ artists: line, length }),
      label: NOW_PLAYING_COPY.entry({ title, line }),
    }))

/** Where the queue started, as the header names it: an overline and a name. */
export type SourceTitle = {
  overline: string
  name: string
  /** The source's name for Up next's line, or null when the queue has none to name. */
  sourceName: string | null
}

type SourceIdOfProps = { source: QueueSource | null; kind: QueueSource['kind'] }

/** The id of the playlist or the artist the queue started from, or null when it started from another kind. */
export const sourceIdOf = ({ source, kind }: SourceIdOfProps): number | null =>
  source?.kind === kind && typeof source.id === 'number' ? source.id : null

type SourceTitleOfProps = {
  source: QueueSource | null
  track: Track
  /** The playlist's or the artist's name once read, null until then. */
  playlistName: string | null
  artistName: string | null
}

/**
 * What the header says the queue plays from: the album, the playlist or the artist it was
 * started from, by name, or the playing song's album when it names none of them.
 */
export const sourceTitleOf = ({
  source,
  track,
  playlistName,
  artistName,
}: SourceTitleOfProps): SourceTitle => {
  const album = track.album.title
  const kind = source?.kind ?? null
  if (kind === QUEUE_SOURCE_KINDS.playlist && playlistName !== null) {
    return {
      overline: NOW_PLAYING_COPY.from.playlist,
      name: playlistName,
      sourceName: playlistName,
    }
  }
  if (kind === QUEUE_SOURCE_KINDS.artist && artistName !== null) {
    return { overline: NOW_PLAYING_COPY.from.artist, name: artistName, sourceName: artistName }
  }
  if (kind === QUEUE_SOURCE_KINDS.album) {
    return { overline: NOW_PLAYING_COPY.from.album, name: album, sourceName: album }
  }
  return { overline: NOW_PLAYING_COPY.from.other, name: album, sourceName: null }
}

/** How a synced line is drawn: already sung, being sung, or still to come. */
export const LYRIC_TONES = { sung: 'sung', current: 'current', upcoming: 'upcoming' } as const

export type LyricTone = (typeof LYRIC_TONES)[keyof typeof LYRIC_TONES]

type LyricToneOfProps = { place: number; current: number | null }

/** A line's tone by where it is against the one being sung; all are to come before the first. */
export const lyricToneOf = ({ place, current }: LyricToneOfProps): LyricTone => {
  if (current === null || place > current) return LYRIC_TONES.upcoming
  return place === current ? LYRIC_TONES.current : LYRIC_TONES.sung
}

// The share of the lyrics' height above the line being sung.
const LYRIC_ANCHOR = 1 / 3

type LyricOffsetOfProps = { lineTop: number; viewport: number }

/** Where the lyrics scroll to keep the line being sung about a third of the way down. */
export const lyricOffsetOf = ({ lineTop, viewport }: LyricOffsetOfProps): number =>
  Math.max(0, lineTop - viewport * LYRIC_ANCHOR)

/** The places Clear removes, last first, so each removal leaves the next one's place as it was. */
export const placesToClearOf = (rows: readonly UpNextRow[]): number[] =>
  rows.map(({ place }) => place).toSorted((a, b) => b - a)

type ShownLyricsOfProps = {
  isAudiobook: boolean
  /** Where the read of the song's lyrics stands, as TanStack Query reports it. */
  lyrics: { data: Lyrics | undefined; isError: boolean }
}

/** What the lyrics pane shows: one of the kinds a track's lyrics come in, or that they are still being read. */
export const SHOWN_LYRICS_KINDS = { ...LYRICS_KINDS, reading: 'reading' } as const

/** The lyrics still being read, which the pane shows as nothing yet. */
export const READING_LYRICS = { kind: SHOWN_LYRICS_KINDS.reading } as const

export type ShownLyrics = Lyrics | typeof READING_LYRICS

/** The lyrics shown: none for a book, and none, quietly, for a failed read; `READING_LYRICS` while they are read. */
export const shownLyricsOf = ({ isAudiobook, lyrics }: ShownLyricsOfProps): ShownLyrics => {
  if (isAudiobook) return NO_LYRICS
  if (lyrics.data !== undefined) return lyrics.data
  return lyrics.isError ? NO_LYRICS : READING_LYRICS
}
