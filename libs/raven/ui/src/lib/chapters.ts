import { type Chapter, LIBRARY_KINDS, type Library, RESTART_AFTER_S, type Track } from '@raven/core'

type ChapterAtProps = { chapters: readonly Chapter[]; at: number }

/** The place of the chapter playing at `at`: the last to have started, or null before the first. */
export const chapterAt = ({ chapters, at }: ChapterAtProps): number | null => {
  const place = chapters.findLastIndex((chapter) => chapter.start <= at)
  return place === -1 ? null : place
}

type PreviousChapterStartProps = { chapters: readonly Chapter[]; at: number }

/**
 * Where Previous chapter goes from `at`: back to the start of the chapter
 * playing once more than `RESTART_AFTER_S` seconds of it have played, as
 * Previous track does, else to the start of the one before it.
 */
export const previousChapterStart = ({ chapters, at }: PreviousChapterStartProps): number => {
  const place = chapterAt({ chapters, at })
  if (place === null) return 0
  const start = chapters[place]?.start ?? 0
  if (at - start > RESTART_AFTER_S) return start
  return chapters[place - 1]?.start ?? start
}

type NextChapterStartProps = { chapters: readonly Chapter[]; at: number }

/** Where Next chapter goes from `at`: the start of the chapter after the one playing, or null in the last. */
export const nextChapterStart = ({ chapters, at }: NextChapterStartProps): number | null =>
  chapters.find((chapter) => chapter.start > at)?.start ?? null

type IsAudiobookTrackProps = { track: Track; libraries: readonly Library[] }

/** Whether a track is a file of an audiobooks library, which plays chapters and a speed of its own. */
export const isAudiobookTrack = ({ track, libraries }: IsAudiobookTrackProps): boolean =>
  (libraries.find((library) => library.id === track.libraryId)?.settings.kind ?? null) ===
  LIBRARY_KINDS.audiobooks
