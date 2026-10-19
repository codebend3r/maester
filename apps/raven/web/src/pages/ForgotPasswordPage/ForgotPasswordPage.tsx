import { useMutation } from '@tanstack/react-query'
import { type FormEvent, useState } from 'react'
import { Link } from 'react-router-dom'
import { EmailField } from '@/components/AuthScreen/AuthFields'
import { AuthForm, Fields, Lead, Note, SubmitButton } from '@/components/AuthScreen/AuthCard'
import { AUDIENCES, AuthScreen } from '@/components/AuthScreen/AuthScreen'
import { RATE_LIMITED_COPY, isRateLimited } from '@/lib/authErrors'
import { AUTH_ROUTES } from '@/lib/authRoutes'
import { callAuth } from '@/lib/session'
import { useConfirmUrl } from '@/lib/useConfirmUrl'
import { useCooldown } from '@/lib/useCooldown'
import { useAuthSession } from '@/stores/authSession'
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
  email,
  redirectTo,
}: {
  email: string
  redirectTo: string
}): Promise<Outcome> => {
  try {
    await callAuth((client) => client.resetPasswordForEmail(email, { redirectTo }))
    return OUTCOMES.sent
  } catch (error) {
    return isRateLimited(error) ? OUTCOMES.rateLimited : OUTCOMES.sent
  }
}

const ForgotPasswordForm = () => {
  const isReady = useAuthSession((state) => state.client !== null)
  const redirectTo = useConfirmUrl()
  const [email, setEmail] = useState('')
  const cooldown = useCooldown()
  const request = useMutation({
    mutationFn: requestLink,
    onSuccess: (outcome) => outcome === OUTCOMES.sent && cooldown.start(),
  })

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!isReady) return
    request.mutate({ email: email.trim(), redirectTo })
  }

  const label = () => {
    if (request.isPending) return 'Sending…'
    return cooldown.isCounting ? `Send again in ${cooldown.secondsLeft}s` : 'Send reset link'
  }

  return (
    <AuthForm
      title="Reset your password"
      lead={
        <Lead>
          Enter the email you signed up with and we will send you a link to choose a new password.
        </Lead>
      }
      onSubmit={submit}
    >
      <Fields>
        <EmailField value={email} onChange={setEmail} />
      </Fields>
      {request.isSuccess && <output className={styles.message}>{MESSAGES[request.data]}</output>}
      <SubmitButton isDisabled={request.isPending || cooldown.isCounting || !isReady}>
        {label()}
      </SubmitButton>
      <Note>
        <Link to={AUTH_ROUTES.signIn}>Back to sign in</Link>
      </Note>
    </AuthForm>
  )
}

/**
 * `/forgot-password`: an email address, and an email with a link to choose a
 * new password. The answer is the same for every address.
 */
export const ForgotPasswordPage = () => (
  <AuthScreen audience={AUDIENCES.signedOut}>
    <ForgotPasswordForm />
  </AuthScreen>
)
