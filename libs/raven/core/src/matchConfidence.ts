import { type Infer, oneOf } from '@/schema'

/** How sure Fix match is that a result is the folder's or file's movie or show. */
export const isConfidenceTier = oneOf(['strong', 'possible', 'weak'])

export type ConfidenceTier = Infer<typeof isConfidenceTier>

/** The lowest Strong confidence, the only tier Fix match names a best match in. */
export const CONFIDENCE_STRONG = 80

/** The lowest Possible confidence; below it a result is Weak. */
export const CONFIDENCE_POSSIBLE = 50

export const confidenceTierOf = (confidence: number): ConfidenceTier => {
  if (confidence >= CONFIDENCE_STRONG) return 'strong'
  if (confidence >= CONFIDENCE_POSSIBLE) return 'possible'
  return 'weak'
}
