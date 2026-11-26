import { type ComponentProps, useState } from 'react'
import { Text, TextInput, View } from 'react-native'

import { RADIUS, SIZE, SPACE, TYPE } from '@/theme/tvTokens'
import { themedStyles, useWrenTheme } from '@/theme/wrenTheme'

const useStyles = themedStyles(({ colors }) => ({
  field: { gap: SPACE.s1, width: SIZE.fieldWidth },
  label: { ...TYPE.meta, color: colors.text2 },
  input: {
    ...TYPE.body,
    backgroundColor: colors.field,
    borderColor: colors.line2,
    borderRadius: RADIUS.item,
    borderWidth: SIZE.focusRing,
    color: colors.text,
    minHeight: SIZE.field,
    paddingHorizontal: SPACE.s3,
  },
  focused: { borderColor: colors.text },
  error: { ...TYPE.meta, color: colors.accentText },
}))

type TextFieldProps = Pick<
  ComponentProps<typeof TextInput>,
  | 'autoComplete'
  | 'keyboardType'
  | 'onSubmitEditing'
  | 'placeholder'
  | 'returnKeyType'
  | 'secureTextEntry'
  | 'textContentType'
  | 'testID'
> & {
  label: string
  value: string
  /** Why what was typed was refused, said under the field. */
  error?: string | null
  onChangeText: (text: string) => void
  hasPreferredFocus?: boolean
}

/**
 * A field the remote reaches: its label over it, and the TV's own keyboard once select is
 * pressed on it. It rings in the theme's text colour while the remote is on it.
 */
export function TextField({
  label,
  error = null,
  hasPreferredFocus = false,
  ...input
}: TextFieldProps) {
  const styles = useStyles()
  const { colors } = useWrenTheme()
  const [isFocused, setIsFocused] = useState(false)
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        {...input}
        accessibilityLabel={label}
        autoCapitalize="none"
        autoCorrect={false}
        hasTVPreferredFocus={hasPreferredFocus}
        onBlur={() => setIsFocused(false)}
        onFocus={() => setIsFocused(true)}
        placeholderTextColor={colors.text3}
        style={[styles.input, isFocused && styles.focused]}
      />
      {error !== null && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
    </View>
  )
}
