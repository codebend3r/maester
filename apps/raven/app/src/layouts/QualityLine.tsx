import { StyleSheet, View } from 'react-native'

import { FocusFactChips, TouchFactChips } from '@/layouts/FactChips'
import type { PlayingQuality } from '@/layouts/musicKit'
import { Text } from '@/layouts/Text'
import { type Palette, SIZES, type Sizes } from '@/theme/appTheme'
import { TV_SIZES } from '@/theme/tvSizes'
import { themedStyles } from '@/theme/useTheme'

type QualityStylesOfProps = { colours: Palette; sizes: Sizes }

const qualityStylesOf = ({ colours, sizes }: QualityStylesOfProps) =>
  StyleSheet.create({ facts: { color: colours.muted, fontSize: sizes.textSm } })

type QualityStyles = ReturnType<typeof qualityStylesOf>

const useTouchStyles = themedStyles((colours) => qualityStylesOf({ colours, sizes: SIZES }))

const useFocusStyles = themedStyles((colours) => qualityStylesOf({ colours, sizes: TV_SIZES }))

type QualityLineProps = { quality: PlayingQuality }

type QualityLineBodyProps = QualityLineProps & {
  Chips: typeof TouchFactChips
  styles: QualityStyles
}

const QualityLineBody = ({ quality, Chips, styles }: QualityLineBodyProps) => (
  <View accessibilityLabel={quality.label} accessible>
    <Chips parts={quality.chips}>
      {quality.facts !== null && <Text style={styles.facts}>{quality.facts}</Text>}
    </Chips>
  </View>
)

/**
 * The format and quality of what plays, under the thumb: the format and a lossless file's bit
 * depth as chips, then the sample rate, the bitrate and Downloaded in quiet words, read out as
 * one sentence in place of its chips and words apart.
 */
export const TouchQualityLine = ({ quality }: QualityLineProps) => (
  <QualityLineBody Chips={TouchFactChips} quality={quality} styles={useTouchStyles()} />
)

/** The same line on a TV, sized to be read from the sofa. */
export const FocusQualityLine = ({ quality }: QualityLineProps) => (
  <QualityLineBody Chips={FocusFactChips} quality={quality} styles={useFocusStyles()} />
)
