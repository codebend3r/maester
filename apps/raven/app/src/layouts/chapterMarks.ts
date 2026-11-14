import type { Chapter } from '@raven/core'
import { chapterAt } from '@raven/ui/headless'

import { playedShareOf } from '@/layouts/playerKit'

/** Where a share of the line starts and how much of it it takes, as offsets and widths: `'40%'`. */
type LineSpan = { left: `${number}%`; width: `${number}%` }

/** The chapters as the scrubber marks them: a notch where each after the first begins, and the playing one's stretch. */
export type ChapterMarks = {
  /** Where each chapter after the first starts along the line. */
  notches: readonly { key: string; left: `${number}%` }[]
  /** The stretch of the chapter playing, from its start to the next one's, or null with none playing. */
  current: LineSpan | null
}

type ChapterMarksOfProps = { chapters: readonly Chapter[]; duration: number; at: number }

const NO_MARKS: ChapterMarks = { notches: [], current: null }

/**
 * The chapter marks for a line `duration` seconds long at the spot `at`: none for a file with
 * fewer than two chapters or no length yet, since a lone chapter is the whole line. A chapter
 * runs to the next one's start, the last to the end, whatever its own end says.
 */
export const chapterMarksOf = ({ chapters, duration, at }: ChapterMarksOfProps): ChapterMarks => {
  if (chapters.length < 2 || duration <= 0) return NO_MARKS
  const notches = chapters
    .slice(1)
    .filter((chapter) => chapter.start > 0 && chapter.start < duration)
    .map((chapter) => ({
      key: String(chapter.start),
      left: playedShareOf({ at: chapter.start, duration }),
    }))
  const place = chapterAt({ chapters, at })
  const playing = place === null ? undefined : chapters[place]
  if (place === null || playing === undefined) return { notches, current: null }
  const end = Math.min(duration, chapters[place + 1]?.start ?? duration)
  const start = Math.min(duration, Math.max(0, playing.start))
  return {
    notches,
    current: {
      left: playedShareOf({ at: start, duration }),
      width: playedShareOf({ at: end - start, duration }),
    },
  }
}
