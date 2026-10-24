import { type ComponentRef, useRef, useState } from 'react'
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native'

import { useFocusOnMount } from '@/layouts/focus'
import {
  BUTTON_TONES,
  type ConfirmProps,
  type FieldProps,
  type FormButtonProps,
  type FormKit,
  type FormProps,
  type FormSheetProps,
  type WebPagesProps,
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
  isEmail = false,
  isFirst = false,
}: FieldProps) => {
  const formStyles = useTvFormStyles()
  return (
    <View style={styles.field}>
      <Text style={[formStyles.label, styles.label]}>{label}</Text>
      <TvTextField
        isPreferred={isFirst}
        keyboardType={keyboardFor({ isNumeric, isSecret, isEmail })}
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

/**
 * A button on a plate. `isPreferred` gives it the remote as it is drawn, once: asked for
 * again once mounted, since Android TV takes no preferred focus a view asks for before it is
 * in the window, and let go once it has had the focus, so the remote stays where the viewer
 * moves it.
 */
const FormButton = ({
  label,
  onPress,
  tone,
  isDisabled = false,
  isPreferred = false,
}: FormButtonProps) => {
  const formStyles = useTvFormStyles()
  const toneStyles = useToneStyles()
  const button = useRef<ComponentRef<typeof Pressable>>(null)
  const [hasHadFocus, setHadFocus] = useState(false)
  useFocusOnMount({ view: button, isAsked: isPreferred })
  return (
    <Pressable
      ref={button}
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled }}
      disabled={isDisabled}
      hasTVPreferredFocus={isPreferred && !hasHadFocus}
      onFocus={() => setHadFocus(true)}
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

/**
 * A question asked as a step of the form, since a TV's alert is the system's and the remote
 * would open on whichever button it likes: the remote opens on the answer that changes
 * nothing.
 */
const Confirm = ({ title, question, detail, yesLabel, noLabel, onAnswer }: ConfirmProps) => {
  const formStyles = useTvFormStyles()
  return (
    <Form title={title}>
      <Text accessibilityLiveRegion="polite" style={formStyles.notice}>
        {question}
      </Text>
      <Text style={formStyles.note}>{detail}</Text>
      <FormButton
        label={yesLabel}
        onPress={() => onAnswer({ isYes: true })}
        tone={BUTTON_TONES.primary}
      />
      <FormButton
        isPreferred
        label={noLabel}
        onPress={() => onAnswer({ isYes: false })}
        tone={BUTTON_TONES.ghost}
      />
    </Form>
  )
}

/**
 * A step over the screen, in a `Modal` whose `onRequestClose` hears Menu or Back, so the remote's
 * own way back closes the step where the native stack would otherwise leave the screen.
 */
const FormSheet = ({ onClose, children }: FormSheetProps) => (
  <Modal visible onRequestClose={onClose}>
    {children}
  </Modal>
)

/** A TV opens no browser (Apple TV has none), so it says where the pages are instead. */
const WebPages = ({ note }: WebPagesProps) => {
  const formStyles = useTvFormStyles()
  return <Text style={formStyles.note}>{note}</Text>
}

/** The TV form: read from the sofa, so larger, and driven by the remote's focus. */
export const focusForm: FormKit = {
  Form,
  Field,
  FormButton,
  Confirm,
  FormSheet,
  WebPages,
  useFormStyles: useTvFormStyles,
}

const styles = StyleSheet.create({
  ground: { justifyContent: 'center', padding: TV_SIZES.space5 },
  content: { gap: TV_SIZES.space5, width: '100%', maxWidth: TV_SIZES.measure, alignSelf: 'center' },
  label: { fontSize: TV_SIZES.textLg },
  field: { gap: TV_SIZES.space3 },
  button: { minHeight: TV_SIZES.controlLarge, borderWidth: TV_SIZES.tvFocusRing },
  buttonText: { fontSize: TV_SIZES.textLg },
})
