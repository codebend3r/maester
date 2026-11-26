import { ON_PICTURE } from '@raven/wren'
import { View } from 'react-native'

import { SIZE } from '@/theme/tvTokens'
import { themedStyles, useWrenTheme } from '@/theme/wrenTheme'

/** The bars' heights, as shares of the mark's height: a still equalizer, as a paused one stands. */
const BARS = [0.55, 1, 0.7] as const

/** How much shorter the bars stand while the music is paused. */
const PAUSED_SHARE = 0.4

const useStyles = themedStyles(() => ({
  mark: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    gap: SIZE.equalizer / 6,
    height: SIZE.equalizer,
  },
  overCover: { position: 'absolute' },
  bar: { borderRadius: SIZE.equalizer / 8, width: SIZE.equalizer / 5 },
}))

type EqualizerProps = {
  /** Whether the queue's track plays rather than waits, which the bars' height says. */
  isPlaying: boolean
  /** Whether it sits over a cover, where it is drawn in the picture's ink. */
  isOnPicture?: boolean
}

/**
 * The queue's track's mark: three bars in the accent, standing tall while it plays and low while
 * it is paused. A TV draws it still, since a moving mark in every row would pull the eye from the
 * remote's focus.
 */
export function Equalizer({ isPlaying, isOnPicture = false }: EqualizerProps) {
  const styles = useStyles()
  const { colors } = useWrenTheme()
  const color = isOnPicture ? ON_PICTURE.ink : colors.accentText
  const share = isPlaying ? 1 : PAUSED_SHARE
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.mark, isOnPicture && styles.overCover]}
    >
      {BARS.map((height) => (
        <View
          // Each bar's height is its own, so it is its key.
          key={height}
          style={[styles.bar, { backgroundColor: color, height: SIZE.equalizer * height * share }]}
        />
      ))}
    </View>
  )
}
