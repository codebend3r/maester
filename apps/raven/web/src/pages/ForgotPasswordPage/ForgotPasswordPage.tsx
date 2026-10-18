import { useMutation, useQuery } from '@tanstack/react-query'
import { type FormEvent, useId, useState } from 'react'
import { Link } from 'react-router-dom'
import { AUTH_CONFIG_STATES } from '@raven/core'
import { Button } from '@raven/ui'
import { type AuthClient } from '@/lib/authClient'
import { RATE_LIMITED_COPY, isRateLimited } from '@/lib/authErrors'
import { AUTH_ROUTES, confirmUrl } from '@/lib/authRoutes'
import { authConfigQuery } from '@/lib/queries'
import { useCooldown } from '@/lib/useCooldown'
import { AuthScreen, Brand } from '@/pages/SignInPage/AuthScreen'
import { useAuthSession } from '@/stores/authSession'
import signInStyles from '@/pages/SignInPage/SignInPage.module.scss'
import styles from '@/pages/ForgotPasswordPage/ForgotPasswordPage.module.scss'

const OUTCOMES = { sent: 'sent', rateLimited: 'rateLimited' } as const
type Outcome = (typeof OUTCOMES)[keyof typeof OUTCOMES]

const MESSAGES = {
  [OUTCOMES.sent]: 'If that address has an account, a link is on its way.',
  [OUTCOMES.rateLimited]: RATE_LIMITED_COPY,
} as const satisfies Record<Outcome, string>

// Only a rate limit changes what the page says. Success, an unknown address
// and every other failure read the same, so the page gives nothing away about
// who has an account.
const requestLink = async ({
  client,
  email,
  redirectTo,
}: {
  client: AuthClient
  email: string
  redirectTo: string
}): Promise<Outcome> => {
  try {
    const { error } = await client.resetPasswordForEmail(email, { redirectTo })
    return isRateLimited(error) ? OUTCOMES.rateLimited : OUTCOMES.sent
  } catch {
    return OUTCOMES.sent
  }
}

const ForgotPasswordForm = () => {
  const emailId = useId()
  const client = useAuthSession((state) => state.client)
  const config = useQuery(authConfigQuery).data
  const webUrl = config?.state === AUTH_CONFIG_STATES.ready ? config.webUrl : window.location.origin
  const [email, setEmail] = useState('')
  const cooldown = useCooldown()
  const request = useMutation({
    mutationFn: requestLink,
    onSuccess: (outcome) => outcome === OUTCOMES.sent && cooldown.start(),
  })
  const isCoolingDown = cooldown.secondsLeft > 0

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (client === null) return
    request.mutate({ client, email: email.trim(), redirectTo: confirmUrl({ webUrl }) })
  }

  const label = () => {
    if (request.isPending) return 'Sending…'
    return isCoolingDown ? `Send again in ${cooldown.secondsLeft}s` : 'Send reset link'
  }

  return (
    <form className={signInStyles.form} onSubmit={submit}>
      <Brand />
      <header className={signInStyles.welcome}>
        <h1 className={signInStyles.title}>Reset your password</h1>
        <p className={signInStyles.lead}>
          Enter the email you signed up with and we will send you a link to choose a new password.
        </p>
      </header>
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
      </div>
      {request.isSuccess && <output className={styles.message}>{MESSAGES[request.data]}</output>}
      <Button
        type="submit"
        tone="primary"
        className={signInStyles.submit}
        disabled={request.isPending || isCoolingDown || client === null}
      >
        {label()}
      </Button>
      <p className={signInStyles.switch}>
        <Link to={AUTH_ROUTES.signIn}>Back to sign in</Link>
      </p>
    </form>
  )
}

/**
 * `/forgot-password`: an email address, and an email with a link to choose a
 * new password. The answer is the same for every address.
 */
export const ForgotPasswordPage = () => (
  <AuthScreen>
    <ForgotPasswordForm />
  </AuthScreen>
)
