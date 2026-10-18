import { useMutation, useQuery } from '@tanstack/react-query'
import { type FormEvent, useId, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AUTH_CONFIG_STATES } from '@raven/core'
import { Button, Icon } from '@raven/ui'
import { authConfigQuery } from '@/lib/queries'
import { AUTH_ERRORS } from '@/lib/authClient'
import { RATE_LIMITED_COPY, errorCodeOf } from '@/lib/authErrors'
import { AUTH_ROUTES, checkEmailPath, confirmUrl } from '@/lib/authRoutes'
import { AuthScreen, Brand } from '@/pages/SignInPage/AuthScreen'
import { useAuthSession } from '@/stores/authSession'
import signInStyles from '@/pages/SignInPage/SignInPage.module.scss'
import styles from '@/pages/SignUpPage/SignUpPage.module.scss'

const MISMATCH_COPY = 'The passwords do not match.'
const FAILED_COPY = 'Sign up failed. Try again.'

/** The server's own words for a weak password; the rest of what it says stays out of the page. */
const failureCopy = (error: unknown): string => {
  switch (errorCodeOf(error)) {
    case AUTH_ERRORS.weakPassword:
      return error instanceof Error && error.message !== '' ? error.message : FAILED_COPY
    case AUTH_ERRORS.overEmailSendRateLimit:
      return RATE_LIMITED_COPY
    default:
      return FAILED_COPY
  }
}

// The same answer for a new address and for one that already has an account,
// so the page gives nothing away about who is registered.
const isAlreadyRegistered = (error: unknown): boolean =>
  errorCodeOf(error) === AUTH_ERRORS.userAlreadyExists

const SignUpForm = () => {
  const ids = { email: useId(), password: useId(), confirm: useId(), error: useId() }
  const navigate = useNavigate()
  const client = useAuthSession((state) => state.client)
  const config = useQuery(authConfigQuery).data
  const webUrl = config?.state === AUTH_CONFIG_STATES.ready ? config.webUrl : window.location.origin
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [isShown, setShown] = useState(false)
  const [hasTried, setTried] = useState(false)
  const signUp = useMutation({
    mutationFn: async (credentials: { email: string; password: string }) => {
      if (client === null) throw new Error('Sign up is not ready yet')
      const { error } = await client.signUp({
        ...credentials,
        options: { emailRedirectTo: confirmUrl({ webUrl }) },
      })
      if (error && !isAlreadyRegistered(error)) throw error
    },
    onSuccess: (_result, { email: address }) =>
      navigate(checkEmailPath({ email: address }), { replace: true }),
  })
  const isMismatched = hasTried && password !== confirmation
  const isRefused = signUp.isError && !isMismatched
  const type = isShown ? 'text' : 'password'

  const submit = (event: FormEvent) => {
    event.preventDefault()
    setTried(true)
    if (password !== confirmation) return
    signUp.mutate({ email: email.trim(), password })
  }

  return (
    <form className={signInStyles.form} onSubmit={submit}>
      <Brand />
      <header className={signInStyles.welcome}>
        <h1 className={signInStyles.title}>Create your account</h1>
        <p className={signInStyles.lead}>Sign up to watch on {window.location.hostname}</p>
      </header>
      <p className={styles.note}>
        We will email you a link to confirm your address. The owner of this raven approves each new
        account by hand, so you can start watching once they have.
      </p>
      <div className={signInStyles.fields}>
        <div className={signInStyles.field}>
          <label htmlFor={ids.email} className={signInStyles.label}>
            Email
          </label>
          <input
            id={ids.email}
            className={signInStyles.input}
            type="email"
            name="email"
            inputMode="email"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>
        <div className={signInStyles.field}>
          <label htmlFor={ids.password} className={signInStyles.label}>
            Password
          </label>
          <div
            className={
              isRefused
                ? `${signInStyles.box} ${signInStyles.secret} ${signInStyles.invalid}`
                : `${signInStyles.box} ${signInStyles.secret}`
            }
          >
            <input
              id={ids.password}
              className={signInStyles.boxed}
              type={type}
              name="password"
              autoComplete="new-password"
              autoCapitalize="none"
              spellCheck={false}
              required
              aria-invalid={isRefused}
              aria-describedby={isRefused ? ids.error : undefined}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            <Button
              tone="ghost"
              className={signInStyles.reveal}
              aria-controls={`${ids.password} ${ids.confirm}`}
              onClick={() => setShown((now) => !now)}
            >
              {isShown ? 'Hide' : 'Show'}
              <span className="visually-hidden"> password</span>
            </Button>
          </div>
          {isRefused && (
            <p id={ids.error} role="alert" className={signInStyles.alert}>
              <span className={signInStyles.alertIcon}>
                <Icon name="alert" size={18} />
              </span>
              <span className={signInStyles.alertText}>{failureCopy(signUp.error)}</span>
            </p>
          )}
        </div>
        <div className={signInStyles.field}>
          <label htmlFor={ids.confirm} className={signInStyles.label}>
            Confirm password
          </label>
          <input
            id={ids.confirm}
            className={signInStyles.input}
            type={type}
            name="confirm-password"
            autoComplete="new-password"
            autoCapitalize="none"
            spellCheck={false}
            required
            aria-invalid={isMismatched}
            aria-describedby={isMismatched ? ids.error : undefined}
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
          />
          {isMismatched && (
            <p id={ids.error} role="alert" className={signInStyles.alert}>
              <span className={signInStyles.alertIcon}>
                <Icon name="alert" size={18} />
              </span>
              <span className={signInStyles.alertText}>{MISMATCH_COPY}</span>
            </p>
          )}
        </div>
      </div>
      <Button
        type="submit"
        tone="primary"
        className={signInStyles.submit}
        disabled={signUp.isPending || client === null}
      >
        {signUp.isPending ? 'Creating account…' : 'Create account'}
      </Button>
      <p className={signInStyles.switch}>
        Already have an account? <Link to={AUTH_ROUTES.signIn}>Sign in</Link>
      </p>
    </form>
  )
}

/**
 * `/sign-up`: an email and a password, typed twice. The two must match before
 * anything is sent. Whatever Supabase answers about the address, a new one or
 * one already registered, the visitor goes on to ask them to check their email.
 */
export const SignUpPage = () => (
  <AuthScreen>
    <SignUpForm />
  </AuthScreen>
)
