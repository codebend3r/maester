import { type WrenIconName } from '@raven/wren'
import { Text, View } from 'react-native'

import { type WrenTheme, themedStyles, useWrenTheme } from '@/theme/wrenTheme'
import { RADIUS, SIZE, SPACE, TYPE } from '@/theme/wrenTokens'
import { BUTTON_VARIANTS, Button, type ButtonVariant } from '@/ui/Button'
import { WrenIcon } from '@/ui/WrenIcon'

const useStyles = themedStyles(({ colors }: WrenTheme) => ({
  empty: { alignItems: 'center', gap: SPACE.s4, paddingVertical: SPACE.s8 },
  tile: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.line,
    borderRadius: RADIUS.xl,
    borderWidth: SIZE.hairline,
    height: SIZE.emptyTile,
    justifyContent: 'center',
    width: SIZE.emptyTile,
  },
  text: { alignItems: 'center', gap: SPACE.s2, maxWidth: SIZE.emptyMeasure },
  title: { ...TYPE.emptyTitle, color: colors.text, textAlign: 'center' },
  body: { ...TYPE.body, color: colors.text2, textAlign: 'center' },
}))

/** The button an empty state offers: New playlist, Clear search. */
type EmptyAction = { label: string; onPress: () => void; variant?: ButtonVariant }

type EmptyStateProps = {
  icon: WrenIconName
  title: string
  body: string
  action?: EmptyAction
}

/** What a list says when it holds nothing: an icon, a heading, what to do, and a button to do it. */
export function EmptyState({ icon, title, body, action }: EmptyStateProps) {
  const styles = useStyles()
  const { colors } = useWrenTheme()
  return (
    <View style={styles.empty}>
      <View style={styles.tile}>
        <WrenIcon color={colors.text2} name={icon} size={SIZE.emptyIcon} />
      </View>
      <View style={styles.text}>
        <Text accessibilityRole="header" style={styles.title}>
          {title}
        </Text>
        <Text style={styles.body}>{body}</Text>
      </View>
      {action !== undefined && (
        <Button
          label={action.label}
          onPress={action.onPress}
          variant={action.variant ?? BUTTON_VARIANTS.primary}
        />
      )}
    </View>
  )
}
