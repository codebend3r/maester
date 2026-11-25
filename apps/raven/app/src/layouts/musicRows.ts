import {
  type AudioQuality,
  type Chapter,
  FACT_PART_KINDS,
  LYRICS_KINDS,
  type Lyrics,
  type QueueRow,
  REPEAT_MODES,
  type RepeatMode,
  activeLineAt,
  formatDuration,
  plural,
  qualityChipsOf,
  qualityRestOf,
} from '@raven/core'
import { type IconName, repeatIconOf } from '@raven/ui/iconDrawings'

import { MUSIC_COPY } from '@/layouts/copy'
import {
  type BookControls,
  NOW_PLAYING_ASIDES,
  type NowPlayingAside,
  type PlayingQuality,
} from '@/layouts/musicKit'

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

/**
 * The format and quality of what plays, from the stream the host chose: the format and bit
 * depth as chips, then the sample rate, the bitrate and Downloaded as one quiet line.
 */
export const playingQualityOf = (quality: AudioQuality): PlayingQuality => {
  const chips = qualityChipsOf(quality)
  const facts = qualityRestOf(quality)
  return {
    chips: chips.map((text) => ({ kind: FACT_PART_KINDS.text, text })),
    facts: facts.length === 0 ? null : MUSIC_COPY.facts(facts),
    label: MUSIC_COPY.qualityLabel([...chips, ...facts]),
  }
}

/** How much is queued, over Up next: "12 tracks · 53:21". */
export const queueFactsOf = (queue: readonly QueueRow[]): string =>
  MUSIC_COPY.facts([
    plural({ n: queue.length, ...MUSIC_COPY.tracks }),
    formatDuration(queue.reduce((total, row) => total + (row.track.duration ?? 0), 0)),
  ])

type QueueLineOfProps = Pick<QueueRow, 'line' | 'length'>

/** What a queue row says under its title: "Radiohead · 4:44". */
export const queueLineOf = ({ line, length }: QueueLineOfProps): string =>
  MUSIC_COPY.facts([line, length])

/** How the queue plays, as both layouts' Shuffle and Repeat controls draw it. */
type PlayModes = {
  shuffle: { isOn: boolean; label: string }
  repeat: { isOn: boolean; label: string; icon: IconName }
}

type PlayModesOfProps = { isShuffled: boolean; repeat: RepeatMode }

/**
 * Shuffle and Repeat, ready to draw: whether each is on, what it says ("Shuffle on", "Repeat
 * one"), and Repeat's icon, the loop with a one inside while one track repeats.
 */
export const playModesOf = ({ isShuffled, repeat }: PlayModesOfProps): PlayModes => ({
  shuffle: {
    isOn: isShuffled,
    label: isShuffled ? MUSIC_COPY.shuffleOn : MUSIC_COPY.shuffleOff,
  },
  repeat: {
    isOn: repeat !== REPEAT_MODES.off,
    label: MUSIC_COPY.repeat[repeat],
    icon: repeatIconOf(repeat),
  },
})
