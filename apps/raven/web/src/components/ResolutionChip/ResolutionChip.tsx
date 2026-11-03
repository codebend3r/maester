import {
  PICTURE_RANGES,
  RESOLUTIONS,
  type Resolution,
  VIDEO_CODECS,
  codecLabel,
  isResolution,
  splitPictureRest,
  splitResolution,
} from '@raven/core'
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

/** The codecs with a fill of their own; any other codec's chip stays on glass, as SD's does. */
const CODEC_FILLS: Readonly<Record<string, string>> = {
  [codecLabel(VIDEO_CODECS.hevc)]: styles.hevc ?? '',
}

type CodecChipProps = { codec: string }

/** A video's codec as a chip beside its resolution, by the name the facts give it (`HEVC`). */
const CodecChip = ({ codec }: CodecChipProps) => (
  <PictureChip label={RESOLUTION_CHIP_COPY.videoCodec(codec)} className={CODEC_FILLS[codec]}>
    {codec}
  </PictureChip>
)

type RangeLook = { className: string | undefined; label: string }

/** The ranges with a look of their own; every other high range wears HDR's rose and its own name. */
const RANGE_LOOKS: Readonly<Record<string, RangeLook>> = {
  [PICTURE_RANGES.dolbyVisionOnly]: {
    className: styles.dolbyVisionOnly,
    label: RESOLUTION_CHIP_COPY.dolbyVisionOnly,
  },
}

type RangeChipProps = { range: string }

/**
 * A picture's high range of light (`HDR`, `Dolby Vision`) as a chip of its
 * own colour; `DV5`, which a browser cannot show, in a warning's.
 */
export const RangeChip = ({ range }: RangeChipProps) => {
  const look = RANGE_LOOKS[range]
  return (
    <PictureChip label={look?.label ?? range} className={look?.className ?? styles.hdr}>
      {range}
    </PictureChip>
  )
}

type PictureFactProps = { resolution: Resolution | null; rest: string | null }

/**
 * A picture as a line of facts says it: the resolution's chip, then the
 * codec's and the range's (`(HEVC) HDR`) as chips of their own, and anything
 * else as words. The spaces between them are real text, so a copy or a
 * search reads `4K HEVC HDR`; the grid's gap draws them.
 */
export const PictureFact = ({ resolution, rest }: PictureFactProps) => {
  const { codec, range, words } = splitPictureRest(rest)
  return (
    <span className={styles.fact}>
      <ResolutionChip resolution={resolution} />
      {codec != null && (
        <>
          {' '}
          <CodecChip codec={codec} />
        </>
      )}
      {range != null && (
        <>
          {' '}
          <RangeChip range={range} />
        </>
      )}
      {words != null && <span> {words}</span>}
    </span>
  )
}

/**
 * Whether a fact or word opens with a resolution, drawn as the chip, is a
 * range of light alone (`HDR`, `DV5`), drawn as its chip, or is plain text.
 */
const FACT_KINDS = { chip: 'chip', range: 'range', text: 'text' } as const
type FactKind = (typeof FACT_KINDS)[keyof typeof FACT_KINDS]

type FactKindOfProps = { resolution: Resolution | null; range: string | null }

const factKindOf = ({ resolution, range }: FactKindOfProps): FactKind => {
  if (resolution != null) return FACT_KINDS.chip
  if (range != null) return FACT_KINDS.range
  return FACT_KINDS.text
}

/** The range a fact or word is, when it is that alone: `DV5`, not `(HEVC) HDR`. */
const rangeWordOf = (fact: string): string | null => {
  const { codec, range } = splitPictureRest(fact)
  return codec == null ? range : null
}

type SplitFactProps = {
  fact: string
  resolution: Resolution | null
  rest: string | null
  range: string | null
}

type PlainFactProps = SplitFactProps

const PlainFact = ({ fact }: PlainFactProps) => fact

type ChipFactProps = SplitFactProps

const ChipFact = ({ resolution, rest }: ChipFactProps) => (
  <PictureFact resolution={resolution} rest={rest} />
)

type RangeWordProps = SplitFactProps

const RangeWord = ({ range }: RangeWordProps) => range != null && <RangeChip range={range} />

const FACT_VIEWS = {
  [FACT_KINDS.chip]: ChipFact,
  [FACT_KINDS.range]: RangeWord,
  [FACT_KINDS.text]: PlainFact,
} as const satisfies Record<FactKind, ComponentType<SplitFactProps>>

type FactTextProps = { fact: string }

/**
 * A fact `@raven/core` writes with the resolution first (`4K HDR`,
 * `1080p (HEVC) HDR`), its resolution as the chip. The device app shows
 * these as they are, so the web marks the resolution here. Only for core's
 * facts: a name someone chose, such as a library called "4K Movies", is
 * not a picture and stays text. A range alone (`DV5` on an episode's row)
 * is its chip; any other fact with no resolution stays plain text.
 */
export const FactText = ({ fact }: FactTextProps) => {
  const { resolution, rest } = splitResolution(fact)
  const range = rangeWordOf(fact)
  const View = FACT_VIEWS[factKindOf({ resolution, range })]
  return <View fact={fact} resolution={resolution} rest={rest} range={range} />
}

type ChipWordProps = SplitFactProps

const ChipWord = ({ resolution }: ChipWordProps) => <ResolutionChip resolution={resolution} />

const WORD_VIEWS = {
  [FACT_KINDS.chip]: ChipWord,
  [FACT_KINDS.range]: RangeWord,
  [FACT_KINDS.text]: PlainFact,
} as const satisfies Record<FactKind, ComponentType<SplitFactProps>>

type WordFactProps = { fact: string }

/**
 * One word of a list of facts, such as `versionFacts`' or a tile's: the
 * chip when the word is a resolution or a range of light, else the word. Names someone chose
 * (an edition, a library) are not words of these lists, so they stay text.
 */
export const WordFact = ({ fact }: WordFactProps) => {
  const resolution = isResolution(fact) ? fact : null
  const range = rangeWordOf(fact)
  const View = WORD_VIEWS[factKindOf({ resolution, range })]
  return <View fact={fact} resolution={resolution} rest={null} range={range} />
}
