import { Pressable, Text, View } from 'react-native'

import { type WrenTheme, themedStyles } from '@/theme/wrenTheme'
import { RADIUS, SIZE, SPACE, TYPE } from '@/theme/wrenTokens'
import { hitSlopOf, pressedStyleOf } from '@/ui/press'
import type { Choice } from '@/ui/SegmentedControl'

const useStyles = themedStyles(({ colors }: WrenTheme) => ({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.s2 },
  chip: {
    alignItems: 'center',
    borderColor: colors.line2,
    borderRadius: RADIUS.pill,
    borderWidth: SIZE.hairline,
    justifyContent: 'center',
    minHeight: SIZE.chip,
    paddingHorizontal: SPACE.s4,
  },
  selected: { backgroundColor: colors.text, borderColor: colors.text },
  label: { ...TYPE.metaStrong, color: colors.text },
  selectedLabel: { color: colors.bg },
}))

type FilterChipsProps<K extends string | number> = {
  label: string
  chips: readonly Choice<K>[]
  selected: K
  onSelect: (key: K) => void
}

/** Pills narrowing a list to one kind: All, Songs, Albums, Artists. */
export function FilterChips<K extends string | number>({
  label,
  chips,
  selected,
  onSelect,
}: FilterChipsProps<K>) {
  const styles = useStyles()
  return (
    <View accessibilityLabel={label} accessibilityRole="radiogroup" style={styles.row}>
      {chips.map((chip) => {
        const isSelected = chip.key === selected
        return (
          <Pressable
            accessibilityLabel={chip.label}
            accessibilityRole="radio"
            accessibilityState={{ checked: isSelected }}
            hitSlop={hitSlopOf(SIZE.chip)}
            key={chip.key}
            onPress={() => onSelect(chip.key)}
            style={pressedStyleOf({ style: [styles.chip, isSelected && styles.selected] })}
          >
            <Text style={[styles.label, isSelected && styles.selectedLabel]}>{chip.label}</Text>
          </Pressable>
        )
      })}
    </View>
  )
}
