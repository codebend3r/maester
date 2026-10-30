import { type Infer, isNumber, isString, listOf, object, oneOf, union } from '@/schema'

/** What a track's lyrics are: lines timed to the music, text with no times, or nothing known. */
export const LYRICS_KINDS = { synced: 'synced', plain: 'plain', none: 'none' } as const

/**
 * Where a track's lyrics came from, in the order they are looked for: the
 * file's own tag, an `.lrc` file of the same name beside it, then LRCLIB.
 */
export const LYRICS_SOURCES = { tags: 'tags', sidecar: 'sidecar', lrclib: 'lrclib' } as const

export const isLyricsSource = oneOf(Object.values(LYRICS_SOURCES))

export type LyricsSource = Infer<typeof isLyricsSource>

/** One line of synced lyrics: when it is sung, in seconds from the track's start, and its words. */
export const isLyricLine = object({ at: isNumber, text: isString })

export type LyricLine = Infer<typeof isLyricLine>

/** `GET /api/tracks/:id/lyrics`: synced lines in time order, plain text, or none. */
export const isLyrics = union(
  object({
    kind: oneOf([LYRICS_KINDS.synced]),
    source: isLyricsSource,
    lines: listOf(isLyricLine),
  }),
  object({ kind: oneOf([LYRICS_KINDS.plain]), source: isLyricsSource, text: isString }),
  object({ kind: oneOf([LYRICS_KINDS.none]) }),
)

export type Lyrics = Infer<typeof isLyrics>

/** What a track with no lyrics anywhere answers. */
export const NO_LYRICS = { kind: LYRICS_KINDS.none } as const satisfies Lyrics
