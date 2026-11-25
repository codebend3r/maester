import type { AudioQuality } from '@raven/core'
import { Text, View } from 'react-native'

import { qualityViewOf } from '@raven/wren'
import { type WrenTheme, themedStyles } from '@/theme/wrenTheme'
import { RADIUS, SIZE, SPACE, TYPE } from '@/theme/wrenTokens'

const useStyles = themedStyles(({ colors }: WrenTheme) => ({
  quality: { alignItems: 'center', flexDirection: 'row', gap: SPACE.s2 },
  chips: { flexDirection: 'row', gap: SPACE.s1 },
  chip: {
    borderColor: colors.line2,
    borderRadius: RADIUS.xs,
    borderWidth: SIZE.hairline,
    paddingHorizontal: SPACE.s2,
  },
  chipText: { ...TYPE.small, color: colors.text2 },
  facts: { ...TYPE.meta, color: colors.text3, flexShrink: 1 },
}))

type QualityChipsProps = {
  /** The format and quality of what is playing. */
  quality: AudioQuality
}

/**
 * The format and quality of what is playing: a chip for the format, one for a lossless file's
 * bit depth, then the rest as quiet words. A screen reader hears it once, as one sentence.
 */
export function QualityChips({ quality }: QualityChipsProps) {
  const styles = useStyles()
  const { chips, facts, label } = qualityViewOf(quality)
  return (
    <View accessibilityLabel={label} accessible style={styles.quality}>
      <View style={styles.chips}>
        {chips.map((chip) => (
          <View key={chip} style={styles.chip}>
            <Text style={styles.chipText}>{chip}</Text>
          </View>
        ))}
      </View>
      {facts !== null && (
        <Text numberOfLines={1} style={styles.facts}>
          {facts}
        </Text>
      )}
    </View>
  )
}
