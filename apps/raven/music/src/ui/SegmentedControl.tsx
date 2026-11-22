import { Pressable, Text, View } from 'react-native'

import { type WrenTheme, themedStyles, shadowOf } from '@/theme/wrenTheme'
import { RADIUS, SHADOWS, SIZE, SPACE, TYPE } from '@/theme/wrenTokens'
import { hitSlopOf, pressedStyleOf } from '@/ui/press'

// A segment is shorter than a finger, so it answers above and below its edges.
const SEGMENT_SLOP = { top: hitSlopOf(SIZE.segment), bottom: hitSlopOf(SIZE.segment) } as const

/** One choice of a control or a chip row: what it stands for and what it says. */
export type Choice<K extends string | number> = { key: K; label: string }

const useStyles = themedStyles(({ colors }: WrenTheme) => ({
  track: {
    backgroundColor: colors.surface2,
    borderRadius: RADIUS.item,
    flexDirection: 'row',
    gap: SIZE.segmentGap,
    padding: SIZE.segmentInset,
  },
  segment: {
    alignItems: 'center',
    borderRadius: RADIUS.item - SIZE.segmentInset,
    flex: 1,
    justifyContent: 'center',
    minHeight: SIZE.segment,
    paddingHorizontal: SPACE.s1,
  },
  selected: {
    backgroundColor: colors.raised,
    ...shadowOf({ shadow: SHADOWS.segment, color: colors.shadow }),
  },
  label: { ...TYPE.metaStrong, color: colors.text },
  idle: { ...TYPE.meta, color: colors.text2 },
}))

type SegmentedControlProps<K extends string | number> = {
  /** What the control sets, said aloud before its choices. */
  label: string
  choices: readonly Choice<K>[]
  selected: K
  onSelect: (key: K) => void
}

/**
 * A row of equal-width choices on a track, one of them picked: Download quality's 128, 256 and
 * 320. It never scrolls sideways, so its labels are kept short enough to fit.
 */
export function SegmentedControl<K extends string | number>({
  label,
  choices,
  selected,
  onSelect,
}: SegmentedControlProps<K>) {
  const styles = useStyles()
  return (
    <View accessibilityLabel={label} accessibilityRole="radiogroup" style={styles.track}>
      {choices.map((choice) => {
        const isSelected = choice.key === selected
        return (
          <Pressable
            accessibilityLabel={choice.label}
            accessibilityRole="radio"
            accessibilityState={{ checked: isSelected }}
            hitSlop={SEGMENT_SLOP}
            key={choice.key}
            onPress={() => onSelect(choice.key)}
            style={pressedStyleOf({ style: [styles.segment, isSelected && styles.selected] })}
          >
            <Text numberOfLines={1} style={isSelected ? styles.label : styles.idle}>
              {choice.label}
            </Text>
          </Pressable>
        )
      })}
    </View>
  )
}
