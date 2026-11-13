import {
  FACT_PART_KINDS,
  type FactPart,
  type FactPartKind,
  type MediaItem,
  PICTURE_RANGES,
  RESOLUTIONS,
  type Resolution,
  VIDEO_CODECS,
  codecLabel,
  factParts,
  isResolution,
  pictureParts,
  pictureRestParts,
  wordPart,
} from '@raven/core'
import { type ComponentType, Fragment, type ReactNode } from 'react'
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
export const CodecChip = ({ codec }: CodecChipProps) => (
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
  [PICTURE_RANGES.dolbyVisionDualLayer]: {
    className: styles.dolbyVisionDualLayer,
    label: RESOLUTION_CHIP_COPY.dolbyVisionDualLayer,
  },
}

type RangeChipProps = { range: string }

/**
 * A picture's high range of light (`HDR`, `Dolby Vision`) as a chip of its
 * own colour; `DV5`, which a browser cannot show, in a warning's, and `DV7`,
 * a 4K Blu-ray's, in one of its own.
 */
export const RangeChip = ({ range }: RangeChipProps) => {
  const look = RANGE_LOOKS[range]
  return (
    <PictureChip label={look?.label ?? range} className={look?.className ?? styles.hdr}>
      {range}
    </PictureChip>
  )
}

type PartViewProps = { text: string }

const ResolutionPart = ({ text }: PartViewProps) => (
  <ResolutionChip resolution={isResolution(text) ? text : null} />
)

const CodecPart = ({ text }: PartViewProps) => <CodecChip codec={text} />

const RangePart = ({ text }: PartViewProps) => <RangeChip range={text} />

const TextPart = ({ text }: PartViewProps) => text

const PART_VIEWS = {
  [FACT_PART_KINDS.resolution]: ResolutionPart,
  [FACT_PART_KINDS.codec]: CodecPart,
  [FACT_PART_KINDS.range]: RangePart,
  [FACT_PART_KINDS.text]: TextPart,
} as const satisfies Record<FactPartKind, ComponentType<PartViewProps>>

type PartProps = { part: FactPart }

const Part = ({ part }: PartProps) => {
  const View = PART_VIEWS[part.kind]
  return <View text={part.text} />
}

/** Whether a line of parts says nothing, is one part on its own, or is a run of them. */
const PART_RUNS = { none: 'none', one: 'one', many: 'many' } as const
type PartRun = (typeof PART_RUNS)[keyof typeof PART_RUNS]

const partRunOf = (parts: readonly FactPart[]): PartRun => {
  if (parts.length === 0) return PART_RUNS.none
  return parts.length === 1 ? PART_RUNS.one : PART_RUNS.many
}

type FactPartsProps = { parts: readonly FactPart[] }

const NoParts = () => null

const OnePart = ({ parts }: FactPartsProps) =>
  parts.map((part) => <Part key={part.kind} part={part} />)

/**
 * The parts in a row, the grid's gap between them. The spaces between them
 * are real text, so a copy or a search reads `4K HEVC HDR`.
 */
const ManyParts = ({ parts }: FactPartsProps) => (
  <span className={styles.fact}>
    {parts.map((part, index) => (
      <Fragment key={`${part.kind}:${part.text}`}>
        {index > 0 && ' '}
        <Part part={part} />
      </Fragment>
    ))}
  </span>
)

const PART_LINES = {
  [PART_RUNS.none]: NoParts,
  [PART_RUNS.one]: OnePart,
  [PART_RUNS.many]: ManyParts,
} as const satisfies Record<PartRun, ComponentType<FactPartsProps>>

/** A line of facts' parts as `@raven/core` reads them: each resolution, codec and range its chip, the rest words. */
export const FactParts = ({ parts }: FactPartsProps) => {
  const Line = PART_LINES[partRunOf(parts)]
  return <Line parts={parts} />
}

type PictureFactProps = { resolution: Resolution | null; rest: string | null }

/**
 * A picture as a line of facts says it: the resolution's chip, then the
 * codec's and the range's (`(HEVC) HDR`) as chips of their own, and anything
 * else as words.
 */
export const PictureFact = ({ resolution, rest }: PictureFactProps) => (
  <FactParts parts={pictureRestParts({ resolution, rest })} />
)

type PictureChipsProps = { media: MediaItem }

/** A file's resolution, range and video codec as chips, in that order; nothing before it is probed. */
export const PictureChips = ({ media }: PictureChipsProps) => (
  <FactParts parts={pictureParts(media)} />
)

type FactTextProps = { fact: string }

/**
 * A fact `@raven/core` writes with the resolution first (`4K HDR`,
 * `1080p (HEVC) HDR`), or a codec or range alone (`DV5` on an episode's
 * row), with each of those as its chip; the device app reads the same parts
 * through `factParts`. Only for core's facts: a name someone chose, such as
 * a library called "4K Movies", is not a picture and stays text.
 */
export const FactText = ({ fact }: FactTextProps) => <FactParts parts={factParts(fact)} />

type WordFactProps = { fact: string }

/**
 * One word of a list of facts, such as `versionFacts`' or a tile's: the
 * chip when the word is a resolution, a video codec or a range of light,
 * else the word. Names someone chose (an edition, a library) stay text.
 */
export const WordFact = ({ fact }: WordFactProps) => <FactParts parts={[wordPart(fact)]} />
