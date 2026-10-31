import { type Chapter, LYRICS_KINDS, type Lyrics, formatDuration } from '@raven/core'
import { activeLineAt } from '@raven/ui/headless'

import { MUSIC_COPY } from '@/layouts/copy'
import { type BookControls, NOW_PLAYING_ASIDES, type NowPlayingAside } from '@/layouts/musicKit'

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
