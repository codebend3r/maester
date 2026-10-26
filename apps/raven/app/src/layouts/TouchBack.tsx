import { Pressable, StyleSheet } from 'react-native'

import { Text } from '@/layouts/Text'
import { SIZES } from '@/theme/appTheme'
import { themedStyles } from '@/theme/useTheme'

/** The way back, and what it is called aloud without its arrow. */
const BACK = { text: '‹ Back', label: 'Back' } as const

type TouchBackProps = {
  onPress: () => void
  isRaised?: boolean
}

/**
 * The way back on a touch screen, at the top of a page, as tall as a finger needs. `isRaised`
 * raises it on the picture's dark glass, drawn from the `overPicture` palette, the same in
 * every theme, for where it sits over a picture.
 */
export const TouchBack = ({ onPress, isRaised = false }: TouchBackProps) => {
  const styles = useStyles({ isOverPicture: isRaised })
  return (
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
}

const useStyles = themedStyles((colours) =>
  StyleSheet.create({
    back: { alignSelf: 'flex-start', minHeight: SIZES.fieldHeight, justifyContent: 'center' },
    raised: {
      paddingHorizontal: SIZES.space2,
      borderRadius: SIZES.radius,
      backgroundColor: colours.raised,
    },
    label: { color: colours.muted, fontSize: SIZES.text },
    raisedLabel: { color: colours.text },
    pressed: { opacity: 0.6 },
  }),
)
