import { useState } from 'react'
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'

import {
  type FieldProps,
  type FormButtonProps,
  type FormKit,
  type FormProps,
  keyboardFor,
} from '@/layouts/formKit'
import { formStyles, toneStyles } from '@/layouts/formStyles'
import { tvFieldStyles } from '@/layouts/tvControls'
import { SIZES } from '@/theme/appTheme'

const Form = ({ title, children }: FormProps) => (
  <View style={[formStyles.ground, styles.ground]}>
    <View style={styles.content}>
      <Text accessibilityRole="header" style={formStyles.title}>
        {title}
      </Text>
      {children}
    </View>
  </View>
)

// Selecting a field with the remote opens the platform's own keyboard, which reports
// the text back as it is typed; the field only needs to show where focus is. Leaving the
// keyboard with Menu cancels the edit: the native field goes back to what it held, but no
// change is reported, so the field takes the text it ends editing with as the truth.
const Field = ({
  label,
  value,
  onChangeText,
  onSubmit,
  placeholder,
  isSecret = false,
  isNumeric = false,
  isFirst = false,
}: FieldProps) => {
  const [isFocused, setFocused] = useState(false)
  return (
    <View style={styles.field}>
      <Text style={[formStyles.label, styles.label]}>{label}</Text>
      <View style={[formStyles.input, tvFieldStyles.frame, isFocused && formStyles.focused]}>
        <TextInput
          accessibilityLabel={label}
          autoCapitalize="none"
          autoCorrect={false}
          hasTVPreferredFocus={isFirst}
          keyboardType={keyboardFor({ isNumeric, isSecret })}
          onBlur={() => setFocused(false)}
          onChangeText={onChangeText}
          onEndEditing={({ nativeEvent }) => onChangeText(nativeEvent.text)}
          onFocus={() => setFocused(true)}
          onSubmitEditing={({ nativeEvent }) => onSubmit({ text: nativeEvent.text })}
          placeholder={placeholder}
          returnKeyType="go"
          secureTextEntry={isSecret}
          style={tvFieldStyles.input}
          value={value}
        />
      </View>
    </View>
  )
}

const FormButton = ({ label, onPress, tone, isDisabled = false }: FormButtonProps) => (
  <Pressable
    accessibilityRole="button"
    accessibilityState={{ disabled: isDisabled }}
    disabled={isDisabled}
    onPress={onPress}
    style={({ focused }) => [
      formStyles.button,
      styles.button,
      toneStyles[tone].button,
      focused && formStyles.focused,
      isDisabled && formStyles.disabled,
    ]}
  >
    <Text style={[formStyles.buttonText, styles.buttonText, toneStyles[tone].label]}>{label}</Text>
  </Pressable>
)

/** The TV form: read from the sofa, so larger, and driven by the remote's focus. */
export const focusForm: FormKit = { Form, Field, FormButton }

const styles = StyleSheet.create({
  ground: { justifyContent: 'center', padding: SIZES.space5 },
  content: { gap: SIZES.space5, width: '100%', maxWidth: SIZES.measure, alignSelf: 'center' },
  label: { fontSize: SIZES.textLg },
  field: { gap: SIZES.space3 },
  button: { minHeight: SIZES.controlLarge, borderWidth: SIZES.tvFocusRing },
  buttonText: { fontSize: SIZES.textLg },
})
