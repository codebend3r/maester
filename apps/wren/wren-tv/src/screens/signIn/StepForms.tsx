import { SIGN_IN_STEPS, type SignInStep, keyboardFor } from '@raven/native/headless'
import { SIGN_IN_COPY, signInErrorsOf } from '@raven/wren'
import type { ComponentType } from 'react'
import { Text, View } from 'react-native'

import type { SignInFlow } from '@raven/wren-native'
import { RADIUS, SIZE, SPACE, TYPE } from '@/theme/tvTokens'
import { themedStyles, useWrenTheme } from '@/theme/wrenTheme'
import { BUTTON_TONES, FocusButton } from '@/ui/FocusButton'
import { TextField } from '@/ui/TextField'
import { ICONS, WrenIcon } from '@/ui/WrenIcon'

const useStyles = themedStyles(({ colors }) => ({
  form: { gap: SPACE.s4, width: SIZE.fieldWidth },
  banner: {
    alignItems: 'flex-start',
    backgroundColor: colors.accentSoft,
    borderRadius: RADIUS.item,
    flexDirection: 'row',
    gap: SPACE.s3,
    padding: SPACE.s3,
  },
  bannerText: { ...TYPE.body, color: colors.text, flex: 1 },
  notice: { ...TYPE.body, color: colors.text2 },
}))

/** What each step's form is handed: the flow that runs it, and where a finished one goes. */
type StepFormProps = { flow: SignInFlow; onDone: () => void }

type AlertBannerProps = { text: string }

/** Why the last submit failed, over the button, read out as it changes. */
function AlertBanner({ text }: AlertBannerProps) {
  const styles = useStyles()
  const { colors } = useWrenTheme()
  return (
    <View
      accessibilityLiveRegion="polite"
      accessibilityRole="alert"
      accessible
      style={styles.banner}
    >
      <WrenIcon color={colors.accentText} name={ICONS.alert} size={SIZE.iconSmall} />
      <Text style={styles.bannerText}>{text}</Text>
    </View>
  )
}

const EMAIL_KEYBOARD = keyboardFor({ isSecret: false, isEmail: true, isNumber: false })
const PASSWORD_KEYBOARD = keyboardFor({ isSecret: true, isEmail: false, isNumber: false })

/**
 * The raven account's email and password on the TV's keyboard, what went wrong with them, and
 * Sign in. A TV's keyboard has no Show password: the system hides what is typed as it is typed.
 */
function AccountForm({ flow }: StepFormProps) {
  const styles = useStyles()
  const { email, setEmail, password, setPassword, isBusy, error, submitAccount } = flow
  const errors = signInErrorsOf({ error, email, password })
  const submit = () => submitAccount()
  // The keyboard's Go can come before the typed password reaches the state.
  const submitTyped = (typed: string) => {
    setPassword(typed)
    submitAccount({ password: typed })
  }
  return (
    <View style={styles.form}>
      <TextField
        autoComplete="email"
        error={errors.email}
        hasPreferredFocus
        keyboardType={EMAIL_KEYBOARD}
        label={SIGN_IN_COPY.email}
        onChangeText={setEmail}
        onSubmitEditing={submit}
        placeholder={SIGN_IN_COPY.emailPlaceholder}
        returnKeyType="next"
        textContentType="emailAddress"
        value={email}
      />
      <TextField
        autoComplete="password"
        error={errors.password}
        keyboardType={PASSWORD_KEYBOARD}
        label={SIGN_IN_COPY.password}
        onChangeText={setPassword}
        onSubmitEditing={({ nativeEvent }) => submitTyped(nativeEvent.text)}
        placeholder={SIGN_IN_COPY.passwordPlaceholder}
        returnKeyType="go"
        secureTextEntry
        textContentType="password"
        value={password}
      />
      {errors.banner !== null && <AlertBanner text={errors.banner} />}
      <FocusButton
        isDisabled={isBusy}
        label={SIGN_IN_COPY.signIn}
        onPress={submit}
        text={SIGN_IN_COPY.signIn}
        tone={BUTTON_TONES.primary}
      />
    </View>
  )
}

/** A server without media tickets, said before the tabs. */
function TicketsOffForm({ onDone }: StepFormProps) {
  const styles = useStyles()
  return (
    <View style={styles.form}>
      <Text accessibilityLiveRegion="polite" style={styles.notice}>
        {SIGN_IN_COPY.ticketsOff}
      </Text>
      <FocusButton
        hasPreferredFocus
        label={SIGN_IN_COPY.continue}
        onPress={onDone}
        text={SIGN_IN_COPY.continue}
        tone={BUTTON_TONES.primary}
      />
    </View>
  )
}

/** The form each step of sign-in draws. */
export const SIGN_IN_VIEWS = {
  [SIGN_IN_STEPS.account]: AccountForm,
  [SIGN_IN_STEPS.ticketsOff]: TicketsOffForm,
} as const satisfies Record<SignInStep['kind'], ComponentType<StepFormProps>>
