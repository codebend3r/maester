import { SETTINGS_COPY } from '@raven/wren'
import { Text, View } from 'react-native'

import { useWrenAccount } from '@raven/wren-native'
import { RADIUS, SIZE, SPACE, TYPE } from '@/theme/tvTokens'
import { themedStyles } from '@/theme/wrenTheme'
import { FocusButton } from '@/ui/FocusButton'

const useStyles = themedStyles(({ colors }) => ({
  card: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: RADIUS.card,
    flexDirection: 'row',
    gap: SPACE.s3,
    padding: SPACE.s3,
  },
  avatar: {
    alignItems: 'center',
    backgroundColor: colors.accent,
    borderRadius: RADIUS.pill,
    height: SIZE.button,
    justifyContent: 'center',
    width: SIZE.button,
  },
  initial: { ...TYPE.cardTitle, color: colors.accentInk },
  email: { ...TYPE.row, color: colors.text, flex: 1 },
}))

/**
 * The account signed in: its initial on a red disc, its email, and Sign out, which forgets it and
 * lands on sign-in. A build that opens with no sign-in (the end to end fixture's) has none.
 */
export function AccountGroup() {
  const styles = useStyles()
  const email = useWrenAccount((state) => state.session?.email ?? '')
  const signOut = useWrenAccount((state) => state.signOut)
  return (
    email !== '' && (
      <View style={styles.card}>
        <View accessibilityElementsHidden importantForAccessibility="no" style={styles.avatar}>
          <Text style={styles.initial}>{email.charAt(0).toUpperCase()}</Text>
        </View>
        <Text numberOfLines={1} style={styles.email}>
          {email}
        </Text>
        <FocusButton label={SETTINGS_COPY.signOut} onPress={signOut} text={SETTINGS_COPY.signOut} />
      </View>
    )
  )
}
