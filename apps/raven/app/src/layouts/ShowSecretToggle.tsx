import { Pressable, View } from 'react-native'

import { Text } from '@/layouts/Text'
import type { FormStyles } from '@/layouts/formStyles'

/** The mark in a ticked box: a check mark, in text presentation so no emoji draws. */
const TICK = '\u2713\uFE0E'

type ShowSecretToggleProps = {
  label: string
  isShown: boolean
  onToggle: () => void
  formStyles: FormStyles
}

/**
 * The checkbox under a secret field that shows what is typed. The remote's focus or a press
 * turns its edge to the text colour, as a button's.
 */
export const ShowSecretToggle = ({
  label,
  isShown,
  onToggle,
  formStyles,
}: ShowSecretToggleProps) => (
  <Pressable
    accessibilityLabel={label}
    accessibilityRole="checkbox"
    accessibilityState={{ checked: isShown }}
    onPress={onToggle}
    style={({ pressed, focused }) => [
      formStyles.checkRow,
      (pressed || focused) && formStyles.focused,
    ]}
  >
    <View style={[formStyles.checkBox, isShown && formStyles.checkBoxOn]}>
      {isShown && <Text style={formStyles.checkTick}>{TICK}</Text>}
    </View>
    <Text style={formStyles.checkText}>{label}</Text>
  </Pressable>
)
