import {
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'

import {
  type FieldProps,
  type FormButtonProps,
  type FormKit,
  type FormProps,
  keyboardFor,
} from '@/layouts/formKit'
import { useToneStyles, useTouchFormStyles } from '@/layouts/formStyles'
import { Logo } from '@/layouts/Logo'
import { SIZES } from '@/theme/appTheme'
import { useTheme } from '@/theme/useTheme'

/** How wide the mark stands over a form. */
const LOGO_WIDTH = SIZES.space6

const Form = ({ title, children }: FormProps) => {
  const formStyles = useTouchFormStyles()
  return (
    <KeyboardAvoidingView behavior="padding" style={formStyles.ground}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Logo width={LOGO_WIDTH} />
        <Text accessibilityRole="header" style={formStyles.title}>
          {title}
        </Text>
        {children}
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

const Field = ({
  label,
  value,
  onChangeText,
  onSubmit,
  placeholder,
  isSecret = false,
  isNumeric = false,
}: FieldProps) => {
  const formStyles = useTouchFormStyles()
  const muted = useTheme((theme) => theme.palette.muted)
  return (
    <View style={styles.field}>
      <Text style={formStyles.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType={keyboardFor({ isNumeric, isSecret })}
        onChangeText={onChangeText}
        onSubmitEditing={({ nativeEvent }) => onSubmit({ text: nativeEvent.text })}
        placeholder={placeholder}
        placeholderTextColor={muted}
        returnKeyType="go"
        secureTextEntry={isSecret}
        style={formStyles.input}
        value={value}
      />
    </View>
  )
}

const FormButton = ({ label, onPress, tone, isDisabled = false }: FormButtonProps) => {
  const formStyles = useTouchFormStyles()
  const toneStyles = useToneStyles()
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled }}
      disabled={isDisabled}
      onPress={onPress}
      style={({ pressed }) => [
        formStyles.button,
        toneStyles[tone].button,
        pressed && formStyles.focused,
        isDisabled && formStyles.disabled,
      ]}
    >
      <Text style={[formStyles.buttonText, toneStyles[tone].label]}>{label}</Text>
    </Pressable>
  )
}

/** The phone and tablet form: one column under the thumb, lifted clear of the keyboard. */
export const touchForm: FormKit = {
  Form,
  Field,
  FormButton,
  useFormStyles: useTouchFormStyles,
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    gap: SIZES.space3,
    padding: SIZES.space5,
    width: '100%',
    maxWidth: SIZES.measure,
    alignSelf: 'center',
  },
  field: { gap: SIZES.space1 },
})
