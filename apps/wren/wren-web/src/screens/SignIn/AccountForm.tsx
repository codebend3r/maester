import { SIGN_IN_COPY, signInErrorsOf, WREN_ICONS } from '@raven/wren'
import { type FormEvent, useState } from 'react'
import type { SignInFlow } from '@/screens/SignIn/useSignInFlow'
import { COLORS, SIZES } from '@/theme/tokens'
import { BUTTON_SIZES, Button } from '@/ui/Button/Button'
import { TextField } from '@/ui/TextField/TextField'
import { WrenIcon } from '@/ui/WrenIcon/WrenIcon'
import styles from '@/screens/SignIn/AccountForm.module.scss'

type AlertBannerProps = { text: string }

/** Why the last submit failed, over the button, read out as it changes. */
function AlertBanner({ text }: AlertBannerProps) {
  return (
    <p className={styles.banner} role="alert">
      <WrenIcon color={COLORS.accentText} name={WREN_ICONS.alert} size={SIZES.smallIcon} />
      <span>{text}</span>
    </p>
  )
}

/** The password field's end button, and how the field shows what is typed, by whether the password shows. */
const PASSWORD_TOGGLES = {
  show: { icon: WREN_ICONS.eye, label: SIGN_IN_COPY.showPassword, type: 'password' },
  hide: { icon: WREN_ICONS.eyeOff, label: SIGN_IN_COPY.hidePassword, type: 'text' },
} as const

type AccountFormProps = { flow: SignInFlow }

/** The raven account's email and password, what went wrong with them, and Sign in. */
export function AccountForm({ flow }: AccountFormProps) {
  const { email, setEmail, password, setPassword, isBusy, error, submitAccount } = flow
  const [isPasswordShown, setIsPasswordShown] = useState(false)
  const errors = signInErrorsOf({ error, email, password })
  const { type, ...toggle } = isPasswordShown ? PASSWORD_TOGGLES.hide : PASSWORD_TOGGLES.show
  const submit = (event: FormEvent) => {
    event.preventDefault()
    submitAccount()
  }
  // TODO(redesign): "Forgot password?" goes under Sign in once raven has a way to reset one from Wren.
  return (
    <form className={styles.form} noValidate onSubmit={submit}>
      <TextField
        autoCapitalize="none"
        autoComplete="email"
        autoCorrect="off"
        enterKeyHint="go"
        error={errors.email}
        icon={WREN_ICONS.mail}
        inputMode="email"
        label={SIGN_IN_COPY.email}
        name="email"
        onChangeText={setEmail}
        placeholder={SIGN_IN_COPY.emailPlaceholder}
        type="email"
        value={email}
      />
      <TextField
        action={{ ...toggle, onPress: () => setIsPasswordShown(!isPasswordShown) }}
        autoCapitalize="none"
        autoComplete="current-password"
        autoCorrect="off"
        enterKeyHint="go"
        error={errors.password}
        icon={WREN_ICONS.lock}
        label={SIGN_IN_COPY.password}
        name="password"
        onChangeText={setPassword}
        placeholder={SIGN_IN_COPY.passwordPlaceholder}
        type={type}
        value={password}
      />
      {errors.banner !== null && <AlertBanner text={errors.banner} />}
      <Button isLoading={isBusy} isSubmit label={SIGN_IN_COPY.signIn} size={BUTTON_SIZES.large} />
    </form>
  )
}
