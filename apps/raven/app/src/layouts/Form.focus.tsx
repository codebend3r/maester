import { Pressable, StyleSheet, Text, View } from 'react-native'

import {
  type FieldProps,
  type FormButtonProps,
  type FormKit,
  type FormProps,
  keyboardFor,
} from '@/layouts/formKit'
import { useToneStyles, useTvFormStyles } from '@/layouts/formStyles'
import { Logo } from '@/layouts/Logo'
import { TvTextField } from '@/layouts/tvControls'
import { TV_SIZES } from '@/theme/tvSizes'

/** How wide the mark stands over a form. */
const LOGO_WIDTH = TV_SIZES.space6

const Form = ({ title, children }: FormProps) => {
  const formStyles = useTvFormStyles()
  return (
    <View style={[formStyles.ground, styles.ground]}>
      <View style={styles.content}>
        <Logo width={LOGO_WIDTH} />
        <Text accessibilityRole="header" style={formStyles.title}>
          {title}
        </Text>
        {children}
      </View>
    </View>
  )
}

/** A labelled field; the step's first takes the remote as it is drawn. */
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
  const formStyles = useTvFormStyles()
  return (
    <View style={styles.field}>
      <Text style={[formStyles.label, styles.label]}>{label}</Text>
      <TvTextField
        isPreferred={isFirst}
        keyboardType={keyboardFor({ isNumeric, isSecret })}
        label={label}
        onChangeText={onChangeText}
        onSubmit={(text) => onSubmit({ text })}
        placeholder={placeholder}
        returnKeyType="go"
        secureTextEntry={isSecret}
        value={value}
      />
    </View>
  )
}

const FormButton = ({ label, onPress, tone, isDisabled = false }: FormButtonProps) => {
  const formStyles = useTvFormStyles()
  const toneStyles = useToneStyles()
  return (
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
      <Text style={[formStyles.buttonText, styles.buttonText, toneStyles[tone].label]}>
        {label}
      </Text>
    </Pressable>
  )
}

/** The TV form: read from the sofa, so larger, and driven by the remote's focus. */
export const focusForm: FormKit = { Form, Field, FormButton, useFormStyles: useTvFormStyles }

const styles = StyleSheet.create({
  ground: { justifyContent: 'center', padding: TV_SIZES.space5 },
  content: { gap: TV_SIZES.space5, width: '100%', maxWidth: TV_SIZES.measure, alignSelf: 'center' },
  label: { fontSize: TV_SIZES.textLg },
  field: { gap: TV_SIZES.space3 },
  button: { minHeight: TV_SIZES.controlLarge, borderWidth: TV_SIZES.tvFocusRing },
  buttonText: { fontSize: TV_SIZES.textLg },
})
