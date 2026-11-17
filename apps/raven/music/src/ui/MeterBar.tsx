import { View } from 'react-native'

import { type WrenTheme, themedStyles } from '@/theme/wrenTheme'
import { RADIUS, SIZE } from '@/theme/wrenTokens'

const useStyles = themedStyles(({ colors }: WrenTheme) => ({
  track: {
    backgroundColor: colors.surface2,
    borderRadius: RADIUS.pill,
    height: SIZE.scrubTrack,
    overflow: 'hidden',
  },
  fill: { backgroundColor: colors.accentText, height: '100%' },
}))

type MeterBarProps = {
  /** How full it is, from 0 to 1. */
  fraction: number
}

/** A thin red bar over a quiet track: how much of something is used. Decorative; its words say it. */
export function MeterBar({ fraction }: MeterBarProps) {
  const styles = useStyles()
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={styles.track}
    >
      <View style={[styles.fill, { width: `${fraction * 100}%` }]} />
    </View>
  )
}
