import type { AudioQuality } from '@raven/core'
import { qualityViewOf } from '@raven/wren'
import { Text, View } from 'react-native'

import { RADIUS, SIZE, SPACE, TYPE } from '@/theme/tvTokens'
import { themedStyles } from '@/theme/wrenTheme'

const useStyles = themedStyles(({ colors }) => ({
  quality: { alignItems: 'center', flexDirection: 'row', gap: SPACE.s2 },
  chips: { flexDirection: 'row', gap: SPACE.s1 },
  chip: {
    borderColor: colors.line2,
    borderRadius: RADIUS.thumb,
    borderWidth: SIZE.focusRing / 2,
    paddingHorizontal: SPACE.s2,
  },
  chipText: { ...TYPE.meta, color: colors.text2 },
  facts: { ...TYPE.meta, color: colors.text3, flexShrink: 1 },
}))

type QualityChipsProps = {
  /** The format and quality of what is playing. */
  quality: AudioQuality
}

/**
 * The format and quality of what is playing, as every Wren says it: a chip for the format, one
 * for a lossless file's bit depth, then the rest as quiet words, heard once as one sentence.
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
