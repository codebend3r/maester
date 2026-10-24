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
import { formStyles, toneStyles } from '@/layouts/formStyles'
import { SIZES } from '@/theme/appTheme'

const Form = ({ title, children }: FormProps) => (
  <KeyboardAvoidingView behavior="padding" style={formStyles.ground}>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text accessibilityRole="header" style={formStyles.title}>
        {title}
      </Text>
      {children}
    </ScrollView>
  </KeyboardAvoidingView>
)

const Field = ({
  label,
  value,
  onChangeText,
  onSubmit,
  placeholder,
  isSecret = false,
  isNumeric = false,
}: FieldProps) => (
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
      returnKeyType="go"
      secureTextEntry={isSecret}
      style={formStyles.input}
      value={value}
    />
  </View>
)

const FormButton = ({ label, onPress, tone, isDisabled = false }: FormButtonProps) => (
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

/** The phone and tablet form: one column under the thumb, lifted clear of the keyboard. */
export const touchForm: FormKit = { Form, Field, FormButton }

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
