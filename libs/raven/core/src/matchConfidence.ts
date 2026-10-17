import { type Infer, oneOf } from '@/schema'

/** How sure Fix match is that a result is the folder's or file's movie or show. */
export const CONFIDENCE_TIERS = { strong: 'strong', possible: 'possible', weak: 'weak' } as const

export const isConfidenceTier = oneOf(Object.values(CONFIDENCE_TIERS))

export type ConfidenceTier = Infer<typeof isConfidenceTier>

/** The lowest Strong confidence, the only tier Fix match names a best match in. */
export const CONFIDENCE_STRONG = 80

/** The lowest Possible confidence; below it a result is Weak. */
const CONFIDENCE_POSSIBLE = 50

export const confidenceTierOf = (confidence: number): ConfidenceTier => {
  if (confidence >= CONFIDENCE_STRONG) return CONFIDENCE_TIERS.strong
  if (confidence >= CONFIDENCE_POSSIBLE) return CONFIDENCE_TIERS.possible
  return CONFIDENCE_TIERS.weak
}
