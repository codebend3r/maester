import { RESOLUTIONS, type Resolution, isResolution, splitResolution } from '@raven/core'
import type { ComponentType, ReactNode } from 'react'
import { RESOLUTION_CHIP_COPY } from '@/components/ResolutionChip/copy'
import styles from '@/components/ResolutionChip/ResolutionChip.module.scss'

type PictureChipProps = {
  label?: string
  className?: string
  children: ReactNode
}

/** A short label on glass over a picture: a resolution, HDR. */
export const PictureChip = ({ label, className, children }: PictureChipProps) => (
  <span className={className ? `${styles.chip} ${className}` : styles.chip} aria-label={label}>
    {children}
  </span>
)

/** Each tier's own colour; SD stays on plain glass. */
const TIERS: Record<Resolution, string | undefined> = {
  [RESOLUTIONS.sd]: undefined,
  [RESOLUTIONS.p320]: styles.p320,
  [RESOLUTIONS.p480]: styles.p480,
  [RESOLUTIONS.p720]: styles.hd,
  [RESOLUTIONS.p1080]: styles.fullHd,
  [RESOLUTIONS.uhd]: styles.uhd,
  [RESOLUTIONS.uhd8k]: styles.uhd8k,
}

type ResolutionChipProps = { resolution: Resolution | null }

/**
 * A video's resolution as a compact mark coloured by its tier, the same
 * chip wherever a page shows one: over a picture, in a table, beside facts.
 * Nothing before the file is probed.
 */
export const ResolutionChip = ({ resolution }: ResolutionChipProps) =>
  resolution != null && (
    <PictureChip
      label={RESOLUTION_CHIP_COPY.videoResolution(resolution)}
      className={TIERS[resolution]}
    >
      {resolution}
    </PictureChip>
  )

type PictureFactProps = { resolution: Resolution | null; rest: string | null }

/**
 * A picture as a line of facts says it: the resolution's chip, then the
 * rest (`HDR`, `(HEVC) HDR`) as words. The space before the rest is real
 * text, so a copy or a search reads `4K HDR`; the grid's gap draws it.
 */
export const PictureFact = ({ resolution, rest }: PictureFactProps) => (
  <span className={styles.fact}>
    <ResolutionChip resolution={resolution} />
    {!!rest && <span> {rest}</span>}
  </span>
)

/** Whether a fact or word opens with a resolution, drawn as the chip, or is plain text. */
const FACT_KINDS = { chip: 'chip', text: 'text' } as const
type FactKind = (typeof FACT_KINDS)[keyof typeof FACT_KINDS]

type FactKindOfProps = { resolution: Resolution | null }

const factKindOf = ({ resolution }: FactKindOfProps): FactKind =>
  resolution == null ? FACT_KINDS.text : FACT_KINDS.chip

type SplitFactProps = { fact: string; resolution: Resolution | null; rest: string | null }

type PlainFactProps = SplitFactProps

const PlainFact = ({ fact }: PlainFactProps) => fact

type ChipFactProps = SplitFactProps

const ChipFact = ({ resolution, rest }: ChipFactProps) => (
  <PictureFact resolution={resolution} rest={rest} />
)

const FACT_VIEWS = {
  [FACT_KINDS.chip]: ChipFact,
  [FACT_KINDS.text]: PlainFact,
} as const satisfies Record<FactKind, ComponentType<SplitFactProps>>

type FactTextProps = { fact: string }

/**
 * A fact `@raven/core` writes with the resolution first (`4K HDR`,
 * `1080p (HEVC) HDR`), its resolution as the chip. The device app shows
 * these as they are, so the web marks the resolution here. Only for core's
 * facts: a name someone chose, such as a library called "4K Movies", is
 * not a picture and stays text. A fact with no resolution stays plain text.
 */
export const FactText = ({ fact }: FactTextProps) => {
  const { resolution, rest } = splitResolution(fact)
  const View = FACT_VIEWS[factKindOf({ resolution })]
  return <View fact={fact} resolution={resolution} rest={rest} />
}

type ChipWordProps = SplitFactProps

const ChipWord = ({ resolution }: ChipWordProps) => <ResolutionChip resolution={resolution} />

const WORD_VIEWS = {
  [FACT_KINDS.chip]: ChipWord,
  [FACT_KINDS.text]: PlainFact,
} as const satisfies Record<FactKind, ComponentType<SplitFactProps>>

type WordFactProps = { fact: string }

/**
 * One word of a list of facts, such as `versionFacts`' or a tile's: the
 * chip when the word is a resolution, else the word. Names someone chose
 * (an edition, a library) are not words of these lists, so they stay text.
 */
export const WordFact = ({ fact }: WordFactProps) => {
  const resolution = isResolution(fact) ? fact : null
  const View = WORD_VIEWS[factKindOf({ resolution })]
  return <View fact={fact} resolution={resolution} rest={null} />
}
