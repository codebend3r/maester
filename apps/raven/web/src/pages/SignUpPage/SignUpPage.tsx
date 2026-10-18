import { useMutation, useQuery } from '@tanstack/react-query'
import { type FormEvent, useId, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AUTH_CONFIG_STATES } from '@raven/core'
import { Button } from '@raven/ui'
import { authConfigQuery } from '@/lib/queries'
import { AUTH_ERRORS } from '@/lib/authClient'
import {
  RATE_LIMITED_COPY,
  errorCodeOf,
  isRateLimited,
  weakPasswordMessage,
} from '@/lib/authErrors'
import { AUTH_ROUTES, checkEmailPath, confirmUrl } from '@/lib/authRoutes'
import { AuthScreen, Brand } from '@/pages/SignInPage/AuthScreen'
import { PasswordFields } from '@/pages/SignUpPage/PasswordFields'
import { useAuthSession } from '@/stores/authSession'
import signInStyles from '@/pages/SignInPage/SignInPage.module.scss'
import styles from '@/pages/SignUpPage/SignUpPage.module.scss'

const FAILED_COPY = 'Sign up failed. Try again.'

/** The server's own words for a weak password; the rest of what it says stays out of the page. */
const failureCopy = (error: unknown): string => {
  if (isRateLimited(error)) return RATE_LIMITED_COPY
  return weakPasswordMessage(error) ?? FAILED_COPY
}

// The same answer for a new address and for one that already has an account,
// so the page gives nothing away about who is registered.
const isAlreadyRegistered = (error: unknown): boolean =>
  errorCodeOf(error) === AUTH_ERRORS.userAlreadyExists

const SignUpForm = () => {
  const emailId = useId()
  const navigate = useNavigate()
  const client = useAuthSession((state) => state.client)
  const config = useQuery(authConfigQuery).data
  const webUrl = config?.state === AUTH_CONFIG_STATES.ready ? config.webUrl : window.location.origin
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
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
          <label htmlFor={emailId} className={signInStyles.label}>
            Email
          </label>
          <input
            id={emailId}
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
        <PasswordFields
          password={password}
          confirmation={confirmation}
          refusal={isRefused ? failureCopy(signUp.error) : null}
          isMismatched={isMismatched}
          onPasswordChange={setPassword}
          onConfirmationChange={setConfirmation}
        />
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
