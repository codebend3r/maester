import { Pressable, StyleSheet, Text, View } from 'react-native'

import { OPACITIES, PALETTE, SIZES } from '@/theme/wrenTheme'

/** How far a label may shrink to fit its segment before it is cut short, on a narrow phone. */
const MINIMUM_FONT_SCALE = 0.7

/** What a segment stands for: a list's name, or a setting's value. */
export type SegmentKey = string | number | null

type Segment<K extends SegmentKey> = { key: K; label: string }

type SegmentsProps<K extends SegmentKey> = {
  segments: readonly Segment<K>[]
  selected: K
  onSelect: (key: K) => void
}

/** A row of tabs picking which list a page shows, or which value a setting takes. */
export function Segments<K extends SegmentKey>({ segments, selected, onSelect }: SegmentsProps<K>) {
  return (
    <View accessibilityRole="tablist" style={styles.segments}>
      {segments.map(({ key, label }) => {
        const isSelected = key === selected
        return (
          <Pressable
            accessibilityLabel={label}
            accessibilityRole="tab"
            accessibilityState={{ selected: isSelected }}
            key={String(key)}
            onPress={() => onSelect(key)}
            style={({ pressed }) => [
              styles.segment,
              isSelected && styles.selected,
              pressed && styles.pressed,
            ]}
          >
            <Text
              adjustsFontSizeToFit
              minimumFontScale={MINIMUM_FONT_SCALE}
              numberOfLines={1}
              style={[styles.label, isSelected && styles.selectedLabel]}
            >
              {label}
            </Text>
          </Pressable>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  segments: {
    backgroundColor: PALETTE.raised,
    borderRadius: SIZES.radius,
    flexDirection: 'row',
    gap: SIZES.space1,
    padding: SIZES.space1,
  },
  segment: {
    alignItems: 'center',
    borderRadius: SIZES.radius,
    flex: 1,
    justifyContent: 'center',
    minHeight: SIZES.fieldHeight,
  },
  selected: { backgroundColor: PALETTE.quiet },
  label: { color: PALETTE.muted, fontSize: SIZES.textSm, fontWeight: 'bold' },
  selectedLabel: { color: PALETTE.text },
  pressed: { opacity: OPACITIES.pressed },
})
