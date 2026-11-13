import {
  FACT_PART_KINDS,
  type FactPart,
  type FactPartKind,
  PICTURE_RANGES,
  RESOLUTIONS,
  type Resolution,
  VIDEO_CODECS,
  codecLabel,
  isResolution,
} from '@raven/core'
import type { ReactNode } from 'react'
import { StyleSheet, View } from 'react-native'

import { FACT_CHIP_COPY } from '@/layouts/copy'
import { Text } from '@/layouts/Text'
import { LINE_RATIO } from '@/layouts/textHeights'
import { CHIP_COLOURS, type Palette, SIZES, type Sizes } from '@/theme/appTheme'
import { TV_SIZES } from '@/theme/tvSizes'
import { themedStyles } from '@/theme/useTheme'

/** Each tier's own fill, as the web's; SD keeps the theme's raised ground. */
const TIER_FILLS = {
  [RESOLUTIONS.sd]: null,
  [RESOLUTIONS.p320]: CHIP_COLOURS.p320,
  [RESOLUTIONS.p480]: CHIP_COLOURS.p480,
  [RESOLUTIONS.p720]: CHIP_COLOURS.p720,
  [RESOLUTIONS.p1080]: CHIP_COLOURS.p1080,
  [RESOLUTIONS.uhd]: CHIP_COLOURS.uhd,
  [RESOLUTIONS.uhd8k]: CHIP_COLOURS.uhd8k,
} as const satisfies Record<Resolution, string | null>

/** The codecs with a fill of their own; any other keeps the raised ground, as SD does. */
const CODEC_FILLS: Readonly<Record<string, string>> = {
  [codecLabel(VIDEO_CODECS.hevc)]: CHIP_COLOURS.hevc,
}

/** The ranges with a fill of their own; every other high range wears HDR's. */
const RANGE_FILLS: Readonly<Record<string, string>> = {
  [PICTURE_RANGES.dolbyVisionOnly]: CHIP_COLOURS.dolbyVisionOnly,
  [PICTURE_RANGES.dolbyVisionDualLayer]: CHIP_COLOURS.dolbyVisionDualLayer,
}

type FillOf = (text: string) => string | null

const FILLS = {
  [FACT_PART_KINDS.resolution]: (text) => (isResolution(text) ? TIER_FILLS[text] : null),
  [FACT_PART_KINDS.codec]: (text) => CODEC_FILLS[text] ?? null,
  [FACT_PART_KINDS.range]: (text) => RANGE_FILLS[text] ?? CHIP_COLOURS.hdr,
  [FACT_PART_KINDS.text]: () => null,
} as const satisfies Record<FactPartKind, FillOf>

type LabelOf = (text: string) => string

const LABELS = {
  [FACT_PART_KINDS.resolution]: FACT_CHIP_COPY.videoResolution,
  [FACT_PART_KINDS.codec]: FACT_CHIP_COPY.videoCodec,
  [FACT_PART_KINDS.range]: (text) => text,
  [FACT_PART_KINDS.text]: (text) => text,
} as const satisfies Record<FactPartKind, LabelOf>

type ChipStylesOfProps = { colours: Palette; sizes: Sizes }

const chipStylesOf = ({ colours, sizes }: ChipStylesOfProps) =>
  StyleSheet.create({
    row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: sizes.space1 },
    // The theme's raised ground with a hairline, as the web's glass chip on the page.
    chip: {
      paddingHorizontal: sizes.space1,
      borderRadius: sizes.radiusSm,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colours.line,
      backgroundColor: colours.raised,
    },
    text: {
      color: colours.text,
      fontSize: sizes.textXs,
      lineHeight: sizes.textXs * LINE_RATIO,
      fontWeight: 'bold',
    },
    ink: { color: CHIP_COLOURS.ink },
  })

type ChipStyles = ReturnType<typeof chipStylesOf>

const useTouchChipStyles = themedStyles((colours) => chipStylesOf({ colours, sizes: SIZES }))

const useFocusChipStyles = themedStyles((colours) => chipStylesOf({ colours, sizes: TV_SIZES }))

type ChipProps = { part: FactPart; styles: ChipStyles }

/** One chip: a tier, HEVC or a range filled in its own colour with the dark ink, the rest on the raised ground. */
const Chip = ({ part, styles }: ChipProps) => {
  const fill = FILLS[part.kind](part.text)
  return (
    <View
      accessibilityLabel={LABELS[part.kind](part.text)}
      accessible
      style={[styles.chip, fill !== null && { backgroundColor: fill, borderColor: fill }]}
    >
      <Text style={[styles.text, fill !== null && styles.ink]}>{part.text}</Text>
    </View>
  )
}

type FactChipRowProps = { parts: readonly FactPart[]; styles: ChipStyles; children?: ReactNode }

const FactChipRow = ({ parts, styles, children }: FactChipRowProps) => (
  <View style={styles.row}>
    {parts.map((part) => (
      <Chip key={`${part.kind}:${part.text}`} part={part} styles={styles} />
    ))}
    {children}
  </View>
)

type FactChipsProps = {
  /** The chips, as `@raven/core`'s `factParts`, `wordPart` and `pictureParts` read them. */
  parts: readonly FactPart[]
  /** What follows the chips on their line: the words of the same facts. */
  children?: ReactNode
}

/**
 * The picture's chips on a wrapping line under the thumb, as the web marks them: the resolution
 * in its tier's colour, HEVC and the range of light in theirs, the rest on the raised ground.
 */
export const TouchFactChips = ({ parts, children }: FactChipsProps) => (
  <FactChipRow parts={parts} styles={useTouchChipStyles()}>
    {children}
  </FactChipRow>
)

/** The same chips on a TV, sized to be read from the sofa. */
export const FocusFactChips = ({ parts, children }: FactChipsProps) => (
  <FactChipRow parts={parts} styles={useFocusChipStyles()}>
    {children}
  </FactChipRow>
)
