import { useState } from 'react'
import { Text, TextInput, type TextInputProps, View } from 'react-native'

import { type WrenTheme, themedStyles, useWrenTheme } from '@/theme/wrenTheme'
import { RADIUS, SIZE, SPACE, TYPE } from '@/theme/wrenTokens'
import { IconButton } from '@/ui/IconButton'
import { ICONS, WrenIcon, type WrenIconName } from '@/ui/WrenIcon'

const useStyles = themedStyles(({ colors }: WrenTheme) => ({
  field: { gap: SPACE.s2 },
  label: { ...TYPE.metaStrong, color: colors.text2 },
  box: {
    alignItems: 'center',
    backgroundColor: colors.field,
    borderColor: colors.line2,
    borderRadius: RADIUS.md,
    borderWidth: SIZE.hairline,
    flexDirection: 'row',
    gap: SPACE.s3,
    minHeight: SIZE.field,
    paddingLeft: SPACE.s4,
    paddingRight: SPACE.s1,
  },
  focused: { borderColor: colors.accentText, borderWidth: SIZE.focusRing },
  failed: { borderColor: colors.accentText },
  input: { ...TYPE.input, color: colors.text, flex: 1, minHeight: SIZE.field - 2 * SIZE.focusRing },
  error: { alignItems: 'center', flexDirection: 'row', gap: SPACE.s1 },
  errorText: { ...TYPE.meta, color: colors.accentText, flex: 1 },
}))

/** A button at the field's end: Show password. */
type FieldAction = { icon: WrenIconName; label: string; onPress: () => void }

type TextFieldProps = Omit<TextInputProps, 'style' | 'accessibilityLabel'> & {
  label: string
  icon?: WrenIconName
  action?: FieldAction
  /** What is wrong with what was typed, said under the field. */
  error?: string | null
}

/** A labelled text box: its icon, what is typed, an optional action, and what is wrong with it. */
export function TextField({
  label,
  icon,
  action,
  error = null,
  onFocus,
  onBlur,
  ...input
}: TextFieldProps) {
  const styles = useStyles()
  const { colors } = useWrenTheme()
  const [isFocused, setIsFocused] = useState(false)
  const hasError = error !== null
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <View style={[styles.box, hasError && styles.failed, isFocused && styles.focused]}>
        {icon !== undefined && <WrenIcon color={colors.text3} name={icon} size={SIZE.navIcon} />}
        <TextInput
          {...input}
          accessibilityHint={error ?? undefined}
          accessibilityLabel={label}
          onBlur={(event) => {
            setIsFocused(false)
            onBlur?.(event)
          }}
          onFocus={(event) => {
            setIsFocused(true)
            onFocus?.(event)
          }}
          placeholderTextColor={colors.text3}
          selectionColor={colors.accentText}
          style={styles.input}
        />
        {action !== undefined && (
          <IconButton icon={action.icon} label={action.label} onPress={action.onPress} />
        )}
      </View>
      {hasError && (
        <View accessibilityLiveRegion="polite" style={styles.error}>
          <WrenIcon color={colors.accentText} name={ICONS.alert} size={SIZE.smallIcon} />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}
    </View>
  )
}
