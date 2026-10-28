import {
  type Chapter,
  MARKER_KINDS,
  MARKER_SOURCES,
  type Marker,
  type MarkerKind,
  isNumber,
  isRecord,
  isString,
} from '@raven/core'

/**
 * The chapter titles that name an intro or the credits. Spike 1's census
 * settled them: anime Blu-ray remuxes name `Opening` and `Ending`, films end
 * on `End Credits`, `Credits` or `Cast and End Credits`. Numbered
 * (`Chapter 02`) and timestamp (`01:34:18.277`) titles name nothing.
 */
const CHAPTER_PATTERNS = {
  intro: /^(intro|opening|op|opening credits|title sequence|main titles?)$/iu,
  credits: /^(credits|end credits|cast and end credits|ending|ed|closing credits|outro)$/iu,
} as const satisfies Record<MarkerKind, RegExp>

/** ffprobe writes times as strings ("43.043000"); 0 is a time here, the first chapter's start. */
const secondsOf = (value: unknown): number | null => {
  const parsed = isString(value) ? Number(value) : value
  return isNumber(parsed) && parsed >= 0 ? parsed : null
}

const titleOf = (tags: unknown): string | null => {
  const title = isRecord(tags) ? tags.title : null
  return isString(title) && title.trim() !== '' ? title.trim() : null
}

/**
 * Reads `ffprobe -show_chapters -of json` output: each chapter's start, end
 * and title, in seconds on the file's own clock, in order. A chapter with no
 * length, or times ffprobe could not read, is left out.
 */
export const parseChapters = (output: unknown): Chapter[] => {
  const chapters = isRecord(output) && Array.isArray(output.chapters) ? output.chapters : []
  return chapters
    .filter(isRecord)
    .flatMap((chapter) => {
      const start = secondsOf(chapter.start_time)
      const end = secondsOf(chapter.end_time)
      if (start == null || end == null || end <= start) return []
      return [{ start, end, title: titleOf(chapter.tags) }]
    })
    .toSorted((a, b) => a.start - b.start)
}

type ChapterMarkerProps = { chapters: readonly Chapter[]; kind: MarkerKind }

/** The first chapter whose title names `kind`, as a marker; none when no title does. */
const chapterMarker = ({ chapters, kind }: ChapterMarkerProps): Marker[] => {
  const named = chapters.find(({ title }) => title != null && CHAPTER_PATTERNS[kind].test(title))
  if (!named) return []
  return [
    { kind, start: named.start, end: named.end, source: MARKER_SOURCES.chapter, confidence: 1 },
  ]
}

/** The intro and credits the file's chapter titles name, trusted fully: the file says so. */
export const chapterMarkers = (chapters: readonly Chapter[]): Marker[] =>
  Object.values(MARKER_KINDS).flatMap((kind) => chapterMarker({ chapters, kind }))
