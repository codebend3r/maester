import { Text, View } from 'react-native'

import { SIZE, SPACE, TYPE } from '@/theme/tvTokens'
import { themedStyles, useWrenTheme } from '@/theme/wrenTheme'
import { BUTTON_TONES, FocusButton } from '@/ui/FocusButton'
import { WrenIcon, type WrenIconName } from '@/ui/WrenIcon'

const useStyles = themedStyles(({ colors }) => ({
  empty: { alignItems: 'center', gap: SPACE.s3, paddingVertical: SPACE.s8 },
  title: { ...TYPE.cardTitle, color: colors.text, textAlign: 'center' },
  body: { ...TYPE.body, color: colors.text2, maxWidth: SIZE.fieldWidth, textAlign: 'center' },
}))

/** The button an empty state offers: what it says, and what a press does. */
type EmptyAction = { text: string; onPress: () => void }

type EmptyStateProps = {
  icon: WrenIconName
  title: string
  body: string | null
  action?: EmptyAction
}

/** What a list says when it holds nothing, or could not be read: an icon, a heading, what to do. */
export function EmptyState({ icon, title, body, action }: EmptyStateProps) {
  const styles = useStyles()
  const { colors } = useWrenTheme()
  return (
    <View style={styles.empty}>
      <WrenIcon color={colors.text2} name={icon} size={SIZE.button} />
      <Text accessibilityRole="header" style={styles.title}>
        {title}
      </Text>
      {body !== null && <Text style={styles.body}>{body}</Text>}
      {action !== undefined && (
        <FocusButton
          label={action.text}
          onPress={action.onPress}
          text={action.text}
          tone={BUTTON_TONES.primary}
        />
      )}
    </View>
  )
}
