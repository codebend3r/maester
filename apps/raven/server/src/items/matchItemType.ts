import { MATCHED_KINDS, type MatchItemType, matchedItemType } from '@raven/core'

/** What a matched library's files are matched to: movies and shows. */
const MATCH_ITEM_TYPES: readonly MatchItemType[] = MATCHED_KINDS.map((kind) =>
  matchedItemType(kind),
)

/** A movie or a show: what Fix match searches for and Edit images chooses pictures of. */
export const isMatchItemType = (value: unknown): value is MatchItemType =>
  MATCH_ITEM_TYPES.some((type) => type === value)
