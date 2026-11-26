import { Text, View } from 'react-native'

import { SETTINGS_COPY } from '@raven/wren'
import { useWrenAccount } from '@raven/wren-native'
import { type WrenTheme, themedStyles } from '@/theme/wrenTheme'
import { RADIUS, SIZE, SPACE, TYPE } from '@/theme/wrenTokens'
import { BUTTON_VARIANTS, Button } from '@/ui/Button'
import { Card } from '@/ui/Card'

const useStyles = themedStyles(({ colors }: WrenTheme) => ({
  card: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: SIZE.rowGap,
    padding: SPACE.s4,
  },
  avatar: {
    alignItems: 'center',
    backgroundColor: colors.accent,
    borderRadius: RADIUS.pill,
    height: SIZE.avatar,
    justifyContent: 'center',
    width: SIZE.avatar,
  },
  initial: { ...TYPE.dialogTitle, color: colors.accentInk },
  who: { flex: 1 },
  name: { ...TYPE.rowStrong, color: colors.text },
}))

/**
 * The account signed in: its initial on a red disc, its email, and Sign out, which forgets it
 * and lands on sign-in. A build that opens with no sign-in (the end to end fixture's) has none.
 */
export function AccountCard() {
  const styles = useStyles()
  const email = useWrenAccount((state) => state.session?.email ?? '')
  const signOut = useWrenAccount((state) => state.signOut)
  // TODO(redesign): the account carries no display name yet, so its email stands in for one.
  return (
    email !== '' && (
      <Card style={styles.card}>
        <View accessibilityElementsHidden importantForAccessibility="no" style={styles.avatar}>
          <Text style={styles.initial}>{email.charAt(0).toUpperCase()}</Text>
        </View>
        <Text numberOfLines={1} style={[styles.who, styles.name]}>
          {email}
        </Text>
        <Button label={SETTINGS_COPY.signOut} onPress={signOut} variant={BUTTON_VARIANTS.ghost} />
      </Card>
    )
  )
}
