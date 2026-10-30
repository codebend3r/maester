import { CONFIDENCE_TIERS, type ConfidenceTier, confidenceTierOf } from '@raven/core'
import { Icon } from '@raven/ui'
import { MATCH_TIER_COPY } from '@/components/MatchTier/copy'
import styles from '@/components/MatchTier/MatchTier.module.scss'

/** What each tier is called beside a Fix match result. */
const TIER_WORDS = {
  [CONFIDENCE_TIERS.strong]: MATCH_TIER_COPY.strong,
  [CONFIDENCE_TIERS.possible]: MATCH_TIER_COPY.possible,
  [CONFIDENCE_TIERS.weak]: MATCH_TIER_COPY.weak,
} as const satisfies Record<ConfidenceTier, string>

type MatchTierProps = {
  /** For the Choose button's `aria-describedby`. */
  id: string
  /** How sure raven is, 0 to 100. */
  confidence: number
  /** The first result when it is Strong: named the best match. */
  isBest: boolean
}

/**
 * How sure raven is of a Fix match result, in words and colour, with the
 * number read aloud: "Best match", "Strong match", "Possible match" or
 * "Weak match". Both Fix match dialogs, a film's or show's and an album's,
 * draw it.
 */
export const MatchTier = ({ id, confidence, isBest }: MatchTierProps) => {
  const tier = confidenceTierOf(confidence)
  return (
    <span id={id} className={`${styles.tier} ${styles[tier]}`}>
      {(isBest || tier === CONFIDENCE_TIERS.strong) && <Icon name="check" size={14} />}
      <span>{isBest ? MATCH_TIER_COPY.best : TIER_WORDS[tier]}</span>
      <span className="visually-hidden">{MATCH_TIER_COPY.confidence(confidence)}</span>
    </span>
  )
}

type HasBestMatchProps = { candidates: readonly { confidence: number }[] }

/** Whether a listing's first result is named the best match: only when it is Strong. */
export const hasBestMatch = ({ candidates }: HasBestMatchProps): boolean =>
  confidenceTierOf(candidates[0]?.confidence ?? 0) === CONFIDENCE_TIERS.strong
