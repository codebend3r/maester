import { isPosterEntry } from '@/contract/home'
import { isMediaItem } from '@/contract/items'
import { type Infer, isNumber, isString, listOf, nullable, object, oneOf } from '@/schema'

/** Which cut of a movie a file is, as its name reads. */
export const isFileCut = object({
  /** The cut in the name's own words: `Revisited the Final Cut`. */
  label: isString,
  /** The cut folded, so two namings of one cut agree: `revisited final`. */
  key: isString,
})

export type FileCut = Infer<typeof isFileCut>

/** One file on a card that holds several, and the cut its name reads as; null for the cut most files are. */
export const isDuplicateFile = object({ media: isMediaItem, cut: nullable(isFileCut) })

export type DuplicateFile = Infer<typeof isDuplicateFile>

/** One of a movie's cards: the card as listed, and the files on it, best first. */
export const isDuplicateCard = object({ entry: isPosterEntry, files: listOf(isDuplicateFile) })

export type DuplicateCard = Infer<typeof isDuplicateCard>

/**
 * A movie with more than one file in a library, and the cards they make:
 * one while they share it, more once split apart, the movie's own first.
 */
export const isDuplicate = object({ itemId: isNumber, cards: listOf(isDuplicateCard) })

export type Duplicate = Infer<typeof isDuplicate>

/**
 * `GET /api/libraries/:id/duplicates`: a movie library's movies with more
 * than one file, split apart or not, by title. A split movie stays, so its
 * cards can be put back together.
 */
export const isDuplicates = listOf(isDuplicate)

export type Duplicates = Infer<typeof isDuplicates>

/**
 * How a card's files are split: `apart` gives each its own card; `smart`
 * gives each cut its own, keeping the files of one cut together.
 */
export const SPLIT_HOWS = { apart: 'apart', smart: 'smart' } as const

export const isSplitHow = oneOf(Object.values(SPLIT_HOWS))

export type SplitHow = Infer<typeof isSplitHow>

/** `POST /api/libraries/:id/duplicates/split`: the card, named by any file on it, and how. */
export const isSplitRequest = object({ mediaId: isNumber, how: isSplitHow })

export type SplitRequest = Infer<typeof isSplitRequest>

/** `POST /api/libraries/:id/duplicates/join`: the movie whose files share one card again. */
export const isJoinRequest = object({ itemId: isNumber })

export type JoinRequest = Infer<typeof isJoinRequest>
