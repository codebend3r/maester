import { Pressable, StyleSheet, Text, View } from 'react-native'

import { OPACITIES, PALETTE, SIZES } from '@/theme/wrenTheme'

type Segment<K extends string> = { key: K; label: string }

type SegmentsProps<K extends string> = {
  segments: readonly Segment<K>[]
  selected: K
  onSelect: (key: K) => void
}

/** A row of tabs picking which list a page shows. */
export function Segments<K extends string>({ segments, selected, onSelect }: SegmentsProps<K>) {
  return (
    <View accessibilityRole="tablist" style={styles.segments}>
      {segments.map(({ key, label }) => {
        const isSelected = key === selected
        return (
          <Pressable
            accessibilityLabel={label}
            accessibilityRole="tab"
            accessibilityState={{ selected: isSelected }}
            key={key}
            onPress={() => onSelect(key)}
            style={({ pressed }) => [
              styles.segment,
              isSelected && styles.selected,
              pressed && styles.pressed,
            ]}
          >
            <Text numberOfLines={1} style={[styles.label, isSelected && styles.selectedLabel]}>
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
