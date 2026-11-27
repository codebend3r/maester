import { useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { autofillFor, keyboardFor } from '@raven/native/headless'

import { type FieldProps, type FormKit, type FormProps } from '@/layouts/formKit'
import { FIELD_COPY } from '@/layouts/copy'
import { FormButton } from '@/layouts/FormButton.focus'
import { Text } from '@/layouts/Text'
import { ScanPanel } from '@/layouts/ScanPanel.focus'
import { ShowSecretToggle } from '@/layouts/ShowSecretToggle'
import { useTvFormStyles } from '@/layouts/formStyles'
import { FormMasthead } from '@/layouts/FormMasthead'
import { TvTextField } from '@/layouts/tvControls'
import { TV_SIZES } from '@/theme/tvSizes'
import { ListenButton } from '@/voice/ListenButton'

/** How wide the mark stands over a form. */
const LOGO_WIDTH = TV_SIZES.space6

/** The form in the middle of the screen, or to the left of its `aside` when it has one. */
const Form = ({ title, children, aside }: FormProps) => {
  const formStyles = useTvFormStyles()
  return (
    <View style={[formStyles.ground, styles.ground]}>
      <View style={styles.columns}>
        <View style={styles.content}>
          <FormMasthead formStyles={formStyles} logoWidth={LOGO_WIDTH} title={title} />
          {children}
        </View>
        {!!aside && <View style={styles.aside}>{aside}</View>}
      </View>
    </View>
  )
}

/**
 * A labelled field; the step's first takes the remote as it is drawn, and where the device can
 * hear (Android TV), a button under it fills it from speech.
 */
const Field = ({
  label,
  value,
  onChangeText,
  onSubmit,
  placeholder,
  isSecret = false,
  isEmail = false,
  isNumber = false,
  isFirst = false,
}: FieldProps) => {
  const formStyles = useTvFormStyles()
  const [isShown, setShown] = useState(false)
  return (
    <View style={styles.field}>
      <Text style={[formStyles.label, styles.label]}>{label}</Text>
      <TvTextField
        {...autofillFor({ isSecret, isEmail })}
        isPreferred={isFirst}
        keyboardType={keyboardFor({ isSecret, isEmail, isNumber })}
        label={label}
        onChangeText={onChangeText}
        onSubmit={(text) => onSubmit({ text })}
        placeholder={placeholder}
        returnKeyType="go"
        secureTextEntry={isSecret && !isShown}
        value={value}
      />
      <ListenButton isEmail={isEmail} label={label} onHeard={onChangeText} />
      {isSecret && (
        <ShowSecretToggle
          formStyles={formStyles}
          isShown={isShown}
          label={FIELD_COPY.showPassword}
          onToggle={() => setShown((shown) => !shown)}
        />
      )}
    </View>
  )
}

/** The TV form: read from the sofa, so larger, and driven by the remote's focus. */
export const focusForm: FormKit = {
  Form,
  Field,
  FormButton,
  ScanPanel,
  useFormStyles: useTvFormStyles,
}

const styles = StyleSheet.create({
  ground: { justifyContent: 'center', padding: TV_SIZES.space5 },
  columns: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: TV_SIZES.space8,
  },
  content: { gap: TV_SIZES.space5, flexShrink: 1, width: '100%', maxWidth: TV_SIZES.measure },
  aside: { flexShrink: 0 },
  label: { fontSize: TV_SIZES.textLg },
  field: { gap: TV_SIZES.space3 },
})
