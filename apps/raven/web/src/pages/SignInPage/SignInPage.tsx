import { useMutation } from '@tanstack/react-query'
import { type FormEvent, type ReactNode, useId, useState } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { Button, Icon } from '@raven/ui'
import { Logo } from '@/components/Logo/Logo'
import { ACCESS_KINDS, useAccessState } from '@/lib/accessState'
import { AUTH_ERRORS } from '@/lib/authClient'
import { AUTH_QUERY, AUTH_ROUTES, checkEmailPath, safeReturnPath } from '@/lib/authRoutes'
import { PosterWall } from '@/pages/SignInPage/PosterWall'
import { useAuthSession } from '@/stores/authSession'
import styles from '@/pages/SignInPage/SignInPage.module.scss'

const SIGN_IN_FAILURES = {
  invalidCredentials: 'invalidCredentials',
  emailNotConfirmed: 'emailNotConfirmed',
  failed: 'failed',
} as const

type SignInFailure = (typeof SIGN_IN_FAILURES)[keyof typeof SIGN_IN_FAILURES]

const FAILURE_COPY = {
  [SIGN_IN_FAILURES.invalidCredentials]: 'Email or password is wrong.',
  [SIGN_IN_FAILURES.emailNotConfirmed]: 'Confirm your email to sign in.',
  [SIGN_IN_FAILURES.failed]: 'Sign in failed. Try again.',
} as const satisfies Record<SignInFailure, string>

const HOME = '/'

/** The `code` a Supabase auth error carries; a network failure has none. */
const codeOf = (error: unknown): unknown =>
  typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined

const failureOf = (error: unknown): SignInFailure => {
  switch (codeOf(error)) {
    case AUTH_ERRORS.invalidCredentials:
      return SIGN_IN_FAILURES.invalidCredentials
    case AUTH_ERRORS.emailNotConfirmed:
      return SIGN_IN_FAILURES.emailNotConfirmed
    default:
      return SIGN_IN_FAILURES.failed
  }
}

const resendFailureCopy = (error: unknown): string =>
  codeOf(error) === AUTH_ERRORS.overEmailSendRateLimit
    ? 'Wait a moment before asking again.'
    : 'Could not resend. Try again.'

const Brand = () => (
  <span className={styles.brand}>
    <Logo />
  </span>
)

const Frame = ({ children }: { children: ReactNode }) => (
  <div className={styles.page}>
    <PosterWall />
    <main className={styles.side}>{children}</main>
  </div>
)

const Waiting = () => (
  <section className={styles.form}>
    <Brand />
    <output className={styles.lead}>Checking your account</output>
  </section>
)

const Unavailable = () => (
  <section className={styles.form}>
    <Brand />
    <header className={styles.welcome}>
      <h1 className={styles.title}>Sign in is temporarily unavailable</h1>
      <p className={styles.lead}>raven could not reach its accounts. Try again in a moment.</p>
    </header>
  </section>
)

const SignInForm = ({ returnPath }: { returnPath: string }) => {
  const ids = { email: useId(), password: useId(), error: useId() }
  const navigate = useNavigate()
  const client = useAuthSession((state) => state.client)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isShown, setShown] = useState(false)
  const signIn = useMutation({
    mutationFn: async (credentials: { email: string; password: string }) => {
      if (client === null) throw new Error('Sign in is not ready yet')
      const { error } = await client.signInWithPassword(credentials)
      if (error) throw error
    },
    onSuccess: () => navigate(returnPath, { replace: true }),
  })
  const resend = useMutation({
    mutationFn: async ({ address }: { address: string }) => {
      if (client === null) throw new Error('Sign in is not ready yet')
      const { error } = await client.resend({ type: 'signup', email: address })
      if (error) throw error
    },
  })
  const isFailed = signIn.isError
  const failure = failureOf(signIn.error)
  const attempted = signIn.variables?.email ?? ''

  const submit = (event: FormEvent) => {
    event.preventDefault()
    resend.reset()
    signIn.mutate({ email: email.trim(), password })
  }

  return (
    <form className={styles.form} onSubmit={submit}>
      <Brand />
      <header className={styles.welcome}>
        <h1 className={styles.title}>Welcome back</h1>
        <p className={styles.lead}>Sign in to watch on {window.location.hostname}</p>
      </header>
      <div className={styles.fields}>
        <div className={styles.field}>
          <label htmlFor={ids.email} className={styles.label}>
            Email
          </label>
          <input
            id={ids.email}
            className={styles.input}
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
        <div className={styles.field}>
          <label htmlFor={ids.password} className={styles.label}>
            Password
          </label>
          <div
            className={
              isFailed
                ? `${styles.box} ${styles.secret} ${styles.invalid}`
                : `${styles.box} ${styles.secret}`
            }
          >
            <input
              id={ids.password}
              className={styles.boxed}
              type={isShown ? 'text' : 'password'}
              name="password"
              autoComplete="current-password"
              autoCapitalize="none"
              spellCheck={false}
              required
              aria-invalid={isFailed}
              aria-describedby={isFailed ? ids.error : undefined}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            <Button
              tone="ghost"
              className={styles.reveal}
              aria-controls={ids.password}
              onClick={() => setShown((now) => !now)}
            >
              {isShown ? 'Hide' : 'Show'}
              <span className="visually-hidden"> password</span>
            </Button>
          </div>
          {isFailed && (
            <p id={ids.error} role="alert" className={styles.alert}>
              <span className={styles.alertIcon}>
                <Icon name="alert" size={18} />
              </span>
              <span className={styles.alertText}>{FAILURE_COPY[failure]}</span>
            </p>
          )}
          {isFailed && failure === SIGN_IN_FAILURES.emailNotConfirmed && (
            <div className={styles.unconfirmed}>
              <Button
                disabled={resend.isPending}
                onClick={() => resend.mutate({ address: attempted })}
              >
                Resend confirmation email
              </Button>
              <Link to={checkEmailPath({ email: attempted })}>Check your email</Link>
              {resend.isSuccess && <output>Confirmation email sent.</output>}
              {resend.isError && <output>{resendFailureCopy(resend.error)}</output>}
            </div>
          )}
        </div>
        <Link className={styles.forgot} to={AUTH_ROUTES.forgot}>
          Forgot password?
        </Link>
      </div>
      <Button
        type="submit"
        tone="primary"
        className={styles.submit}
        disabled={signIn.isPending || client === null}
      >
        {signIn.isPending ? 'Signing in…' : 'Sign in'}
      </Button>
      <p className={styles.switch}>
        New to raven? <Link to={AUTH_ROUTES.signUp}>Create an account</Link>
      </p>
    </form>
  )
}

/**
 * `/sign-in`, the whole screen: a tilted wall of posters with raven's
 * promise over it, put away on a phone, beside the form. Email and password
 * sign the viewer in with Supabase; Show reads the password back. A wrong
 * email or password, an email not yet confirmed (which can be sent again)
 * and any other failure each say so under the password, marked as the field
 * to fix. Once in, the viewer goes to the path they came from, `return_to`,
 * or home. While accounts are off the page is not there; while they cannot
 * be reached it says so instead of showing a form that cannot work.
 */
export const SignInPage = () => {
  const access = useAccessState()
  const [params] = useSearchParams()
  const returnPath = safeReturnPath(params.get(AUTH_QUERY.returnTo))

  switch (access.kind) {
    case ACCESS_KINDS.disabled:
      return <Navigate replace to={HOME} />
    case ACCESS_KINDS.approved:
      return <Navigate replace to={returnPath} />
    case ACCESS_KINDS.pending:
    case ACCESS_KINDS.revoked:
      return <Navigate replace to={AUTH_ROUTES.pending} />
    case ACCESS_KINDS.loading:
      return (
        <Frame>
          <Waiting />
        </Frame>
      )
    case ACCESS_KINDS.unavailable:
    case ACCESS_KINDS.failed:
      return (
        <Frame>
          <Unavailable />
        </Frame>
      )
    case ACCESS_KINDS.signedOut:
      return (
        <Frame>
          <SignInForm returnPath={returnPath} />
        </Frame>
      )
    default: {
      const unreachable: never = access
      return unreachable
    }
  }
}
