import { Pressable, StyleSheet, Text } from 'react-native'

import { COLOURS, SIZES } from '@/theme/appTheme'

/** The way back, and what it is called aloud without its arrow. */
const BACK = { text: '‹ Back', label: 'Back' } as const

/**
 * The way back on a touch screen, at the top of a page, as tall as a finger needs. `isRaised`
 * gives it a ground of its own, for where it sits over a picture.
 */
export const TouchBack = ({
  onPress,
  isRaised = false,
}: {
  onPress: () => void
  isRaised?: boolean
}) => (
  <Pressable
    accessibilityLabel={BACK.label}
    accessibilityRole="button"
    hitSlop={SIZES.space2}
    onPress={onPress}
    style={({ pressed }) => [styles.back, isRaised && styles.raised, pressed && styles.pressed]}
  >
    <Text style={[styles.label, isRaised && styles.raisedLabel]}>{BACK.text}</Text>
  </Pressable>
)

const styles = StyleSheet.create({
  back: { alignSelf: 'flex-start', minHeight: SIZES.fieldHeight, justifyContent: 'center' },
  raised: {
    paddingHorizontal: SIZES.space2,
    borderRadius: SIZES.radius,
    backgroundColor: COLOURS.deep,
  },
  label: { color: COLOURS.muted, fontSize: SIZES.text },
  raisedLabel: { color: COLOURS.text },
  pressed: { opacity: 0.6 },
})
