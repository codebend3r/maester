import type { ReactNode } from 'react'
import {
  KeyboardAvoidingView,
  type KeyboardTypeOptions,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'

import { OPACITIES, PALETTE, SIZES } from '@/theme/wrenTheme'

/** The web's `Button` tones: the one action a step is for, another way on, and a way out. */
export const BUTTON_TONES = { primary: 'primary', quiet: 'quiet', ghost: 'ghost' } as const

type ButtonTone = (typeof BUTTON_TONES)[keyof typeof BUTTON_TONES]

type FormProps = { title: string; note?: string; children: ReactNode }

/** One column under the thumb, lifted clear of the keyboard. */
export function Form({ title, note, children }: FormProps) {
  return (
    <KeyboardAvoidingView behavior="padding" style={styles.ground}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text accessibilityRole="header" style={styles.title}>
          {title}
        </Text>
        {note !== undefined && <Text style={styles.note}>{note}</Text>}
        {children}
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

type FieldKindProps = { isSecret: boolean; isNumeric: boolean; isEmail: boolean }

type AutoCompleteForProps = FieldKindProps

/** What the system offers to fill a field with: the email, a saved password, or nothing. */
const autoCompleteFor = ({ isSecret, isNumeric, isEmail }: AutoCompleteForProps) => {
  if (isEmail) return 'email'
  return isSecret && !isNumeric ? 'password' : 'off'
}

type KeyboardForProps = FieldKindProps

/** The keyboard a field brings up: digits for a PIN, the email one, else the default. */
const keyboardFor = ({ isNumeric, isEmail }: KeyboardForProps): KeyboardTypeOptions => {
  if (isNumeric) return 'number-pad'
  return isEmail ? 'email-address' : 'default'
}

type FieldProps = {
  label: string
  value: string
  onChangeText: (text: string) => void
  onSubmit: () => void
  isSecret?: boolean
  isNumeric?: boolean
  isEmail?: boolean
}

export function Field({
  label,
  value,
  onChangeText,
  onSubmit,
  isSecret = false,
  isNumeric = false,
  isEmail = false,
}: FieldProps) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        autoCapitalize="none"
        autoComplete={autoCompleteFor({ isSecret, isNumeric, isEmail })}
        autoCorrect={false}
        keyboardType={keyboardFor({ isSecret, isNumeric, isEmail })}
        onChangeText={onChangeText}
        onSubmitEditing={onSubmit}
        returnKeyType="go"
        secureTextEntry={isSecret}
        style={styles.input}
        value={value}
      />
    </View>
  )
}

type FormButtonProps = {
  label: string
  onPress: () => void
  tone: ButtonTone
  isDisabled?: boolean
}

export function FormButton({ label, onPress, tone, isDisabled = false }: FormButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled }}
      disabled={isDisabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        TONES[tone].button,
        pressed && styles.pressed,
        isDisabled && styles.disabled,
      ]}
    >
      <Text style={[styles.buttonText, TONES[tone].label]}>{label}</Text>
    </Pressable>
  )
}

type FormLineProps = { text: string; isError?: boolean }

/** What the server or the step said, read out as it changes. */
export function FormLine({ text, isError = false }: FormLineProps) {
  return (
    <Text accessibilityLiveRegion="polite" style={isError ? styles.error : styles.notice}>
      {text}
    </Text>
  )
}

const TONES = {
  [BUTTON_TONES.primary]: StyleSheet.create({
    button: { backgroundColor: PALETTE.accent },
    label: { color: PALETTE.onAccent },
  }),
  [BUTTON_TONES.quiet]: StyleSheet.create({
    button: { backgroundColor: PALETTE.quiet },
    label: { color: PALETTE.text },
  }),
  [BUTTON_TONES.ghost]: StyleSheet.create({
    button: { backgroundColor: 'transparent' },
    label: { color: PALETTE.text },
  }),
} as const satisfies Record<ButtonTone, unknown>

const styles = StyleSheet.create({
  ground: { flex: 1, backgroundColor: PALETTE.ground },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    gap: SIZES.space3,
    padding: SIZES.space5,
    width: '100%',
    maxWidth: SIZES.measure,
    alignSelf: 'center',
  },
  title: { color: PALETTE.text, fontSize: SIZES.textXl, fontWeight: 'bold' },
  note: { color: PALETTE.muted, fontSize: SIZES.text },
  field: { gap: SIZES.space1 },
  label: { color: PALETTE.muted, fontSize: SIZES.textSm },
  input: {
    color: PALETTE.text,
    backgroundColor: PALETTE.raised,
    borderColor: PALETTE.line,
    borderWidth: 1,
    borderRadius: SIZES.radius,
    minHeight: SIZES.fieldHeight,
    paddingHorizontal: SIZES.space2,
    fontSize: SIZES.text,
  },
  button: {
    alignItems: 'center',
    borderRadius: SIZES.radius,
    justifyContent: 'center',
    minHeight: SIZES.fieldHeight,
    paddingHorizontal: SIZES.space2,
  },
  buttonText: { fontSize: SIZES.text, fontWeight: 'bold' },
  pressed: { opacity: OPACITIES.pressed },
  disabled: { opacity: OPACITIES.disabled },
  notice: { color: PALETTE.notice, fontSize: SIZES.text },
  error: { color: PALETTE.error, fontSize: SIZES.text },
})
