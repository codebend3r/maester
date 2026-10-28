import { type Infer, isNumber, isString, listOf, nullable, object, oneOf } from '@/schema'

/** The stretches of a video a player can skip or roll on from. */
export const MARKER_KINDS = { intro: 'intro', credits: 'credits' } as const

export type MarkerKind = (typeof MARKER_KINDS)[keyof typeof MARKER_KINDS]

/** Where a marker came from, strongest first: a stronger source replaces a weaker one, and nothing replaces `manual`. */
export const MARKER_SOURCES = {
  manual: 'manual',
  chapter: 'chapter',
  fingerprint: 'fingerprint',
  visual: 'visual',
} as const

export type MarkerSource = (typeof MARKER_SOURCES)[keyof typeof MARKER_SOURCES]

/**
 * One stretch of a file, in seconds on the file's own clock, so direct
 * play, HLS and mpv all seek to it as it is. `confidence` runs 0 to 1; a
 * named chapter's is 1.
 */
export const isMarker = object({
  kind: oneOf(Object.values(MARKER_KINDS)),
  start: isNumber,
  end: isNumber,
  source: oneOf(Object.values(MARKER_SOURCES)),
  confidence: isNumber,
})

export type Marker = Infer<typeof isMarker>

/** A chapter the file names, in seconds; `title` is null for an untitled one. */
export const isChapter = object({ start: isNumber, end: isNumber, title: nullable(isString) })

export type Chapter = Infer<typeof isChapter>

/** What the player knows of a file's stretches: its intro and credits, each null when none is known, and its chapters. */
export const isMediaMarkers = object({
  intro: nullable(isMarker),
  credits: nullable(isMarker),
  chapters: listOf(isChapter),
})

export type MediaMarkers = Infer<typeof isMediaMarkers>
