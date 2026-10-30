import { useMutation } from '@tanstack/react-query'
import { type FormEvent, useState } from 'react'
import { Link } from 'react-router-dom'
import { AUTH_ROUTES } from '@raven/core'
import { EmailField } from '@/components/AuthScreen/AuthFields'
import { AuthForm, Fields, Lead, Note, SubmitButton } from '@/components/AuthScreen/AuthCard'
import { AUDIENCES, AuthScreen } from '@/components/AuthScreen/AuthScreen'
import { RATE_LIMITED_COPY, isRateLimited } from '@/lib/authErrors'
import { callAuth } from '@/lib/session'
import { useConfirmUrl } from '@/lib/useConfirmUrl'
import { useCooldown } from '@/lib/useCooldown'
import { useAuthSession } from '@/stores/authSession'
import { FORGOT_PASSWORD_COPY } from '@/pages/ForgotPasswordPage/copy'
import styles from '@/pages/ForgotPasswordPage/ForgotPasswordPage.module.scss'
import { COMMON_COPY } from '@/lib/copy'

const OUTCOMES = { sent: 'sent', rateLimited: 'rateLimited' } as const
type Outcome = (typeof OUTCOMES)[keyof typeof OUTCOMES]

const MESSAGES = {
  [OUTCOMES.sent]: FORGOT_PASSWORD_COPY.sent,
  [OUTCOMES.rateLimited]: RATE_LIMITED_COPY,
} as const satisfies Record<Outcome, string>

type RequestLinkProps = {
  email: string
  redirectTo: string
}

// Only a rate limit changes what the page says. Success, an unknown address
// and every other failure read the same, so the page gives nothing away about
// who has an account.
const requestLink = async ({ email, redirectTo }: RequestLinkProps): Promise<Outcome> => {
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
    if (request.isPending) return FORGOT_PASSWORD_COPY.sending
    return cooldown.isCounting
      ? FORGOT_PASSWORD_COPY.sendAgainIn(cooldown.secondsLeft)
      : FORGOT_PASSWORD_COPY.sendLink
  }

  return (
    <AuthForm
      title={FORGOT_PASSWORD_COPY.title}
      lead={<Lead>{FORGOT_PASSWORD_COPY.lead}</Lead>}
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
        <Link to={AUTH_ROUTES.signIn}>{COMMON_COPY.backToSignIn}</Link>
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
