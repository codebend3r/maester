/**
 * What `media.split` holds for a movie file split off its movie's card:
 * `file:<id>` for a card of its own, `cut:<label>` for one it shares with
 * the movie's other files of that cut. Null keeps it on the movie's card.
 */
const SPLIT_PREFIXES = { file: 'file:', cut: 'cut:' } as const

/** The split that gives a file a card of its own, named by its id, which outlives a rename. */
export const fileSplit = (mediaId: number): string => `${SPLIT_PREFIXES.file}${mediaId}`

/** The split that puts a file on its cut's card. */
export const cutSplit = (label: string): string => `${SPLIT_PREFIXES.cut}${label}`

/** The cut a split names, or null for one that names none. */
export const cutOfSplit = (split: string): string | null =>
  split.startsWith(SPLIT_PREFIXES.cut) ? split.slice(SPLIT_PREFIXES.cut.length) : null
