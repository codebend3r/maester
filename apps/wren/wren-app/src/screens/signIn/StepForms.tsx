import { SIGN_IN_STEPS, type SignInStep, keyboardFor } from '@raven/native/headless'
import { type ComponentType, useState } from 'react'
import { Text, View } from 'react-native'

import { SIGN_IN_COPY, signInErrorsOf } from '@raven/wren'
import type { SignInFlow } from '@/screens/signIn/useSignInFlow'
import { type WrenTheme, themedStyles, useWrenTheme } from '@/theme/wrenTheme'
import { RADIUS, SIZE, SPACE, TYPE } from '@/theme/wrenTokens'
import { BUTTON_SIZES, Button } from '@/ui/Button'
import { TextField } from '@/ui/TextField'
import { ICONS, WrenIcon } from '@/ui/WrenIcon'

const useStyles = themedStyles(({ colors }: WrenTheme) => ({
  form: { gap: SPACE.s4 },
  banner: {
    alignItems: 'flex-start',
    backgroundColor: colors.accentSoft,
    borderRadius: RADIUS.md,
    flexDirection: 'row',
    gap: SPACE.s3,
    paddingHorizontal: SPACE.s4,
    paddingVertical: SPACE.s3,
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
      <WrenIcon color={colors.accentText} name={ICONS.alert} size={SIZE.smallIcon} />
      <Text style={styles.bannerText}>{text}</Text>
    </View>
  )
}

/** The password field's end button, by whether the password shows. */
const PASSWORD_TOGGLES = {
  show: { icon: ICONS.eye, label: SIGN_IN_COPY.showPassword },
  hide: { icon: ICONS.eyeOff, label: SIGN_IN_COPY.hidePassword },
} as const

const EMAIL_KEYBOARD = keyboardFor({ isSecret: false, isEmail: true, isNumber: false })
const PASSWORD_KEYBOARD = keyboardFor({ isSecret: true, isEmail: false, isNumber: false })

type AccountFormProps = StepFormProps

/** The raven account's email and password, what went wrong with them, and Sign in. */
function AccountForm({ flow }: AccountFormProps) {
  const styles = useStyles()
  const { email, setEmail, password, setPassword, isBusy, error, submitAccount } = flow
  const [isPasswordShown, setIsPasswordShown] = useState(false)
  const errors = signInErrorsOf({ error, email, password })
  const toggle = isPasswordShown ? PASSWORD_TOGGLES.hide : PASSWORD_TOGGLES.show
  const submit = () => submitAccount()
  // The field's submit can come before the typed password reaches the state.
  const submitTyped = (typed: string) => {
    setPassword(typed)
    submitAccount({ password: typed })
  }
  // TODO(redesign): "Forgot password?" goes under Sign in once raven has a way to reset one.
  return (
    <View style={styles.form}>
      <TextField
        autoCapitalize="none"
        autoComplete="email"
        autoCorrect={false}
        error={errors.email}
        icon={ICONS.mail}
        keyboardType={EMAIL_KEYBOARD}
        label={SIGN_IN_COPY.email}
        onChangeText={setEmail}
        onSubmitEditing={submit}
        placeholder={SIGN_IN_COPY.emailPlaceholder}
        returnKeyType="go"
        textContentType="emailAddress"
        value={email}
      />
      <TextField
        action={{ ...toggle, onPress: () => setIsPasswordShown(!isPasswordShown) }}
        autoCapitalize="none"
        autoComplete="password"
        autoCorrect={false}
        error={errors.password}
        icon={ICONS.lock}
        keyboardType={PASSWORD_KEYBOARD}
        label={SIGN_IN_COPY.password}
        onChangeText={setPassword}
        onSubmitEditing={({ nativeEvent }) => submitTyped(nativeEvent.text)}
        placeholder={SIGN_IN_COPY.passwordPlaceholder}
        returnKeyType="go"
        secureTextEntry={!isPasswordShown}
        textContentType="password"
        value={password}
      />
      {errors.banner !== null && <AlertBanner text={errors.banner} />}
      <Button
        isLoading={isBusy}
        label={SIGN_IN_COPY.signIn}
        onPress={submit}
        size={BUTTON_SIZES.large}
      />
    </View>
  )
}

type TicketsOffFormProps = StepFormProps

/** A server without media tickets, said before the tabs. */
function TicketsOffForm({ onDone }: TicketsOffFormProps) {
  const styles = useStyles()
  return (
    <View style={styles.form}>
      <Text accessibilityLiveRegion="polite" style={styles.notice}>
        {SIGN_IN_COPY.ticketsOff}
      </Text>
      <Button label={SIGN_IN_COPY.continue} onPress={onDone} size={BUTTON_SIZES.large} />
    </View>
  )
}

/** The form each step of sign-in draws. */
export const SIGN_IN_VIEWS = {
  [SIGN_IN_STEPS.account]: AccountForm,
  [SIGN_IN_STEPS.ticketsOff]: TicketsOffForm,
} as const satisfies Record<SignInStep['kind'], ComponentType<StepFormProps>>
