import { useMutation } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'
import { Button } from '@raven/ui'
import { AUTH_ROUTES } from '@raven/core'
import { Address, AuthCard, Lead, Note } from '@/components/AuthScreen/AuthCard'
import { AUDIENCES, AuthScreen } from '@/components/AuthScreen/AuthScreen'
import { resendFailureCopy } from '@/lib/authErrors'
import { AUTH_QUERY } from '@/lib/authRoutes'
import { resendConfirmation } from '@/lib/session'
import { useCooldown } from '@/lib/useCooldown'
import { useAuthSession } from '@/stores/authSession'
import styles from '@/pages/CheckEmailPage/CheckEmailPage.module.scss'

type ResendProps = { address: string }

const Resend = ({ address }: ResendProps) => {
  const isReady = useAuthSession((state) => state.client !== null)
  const cooldown = useCooldown()
  const resend = useMutation({
    mutationFn: () => resendConfirmation({ email: address }),
    onSuccess: cooldown.start,
  })

  return (
    <div className={styles.resend}>
      <Button
        disabled={resend.isPending || cooldown.isCounting || !isReady}
        onClick={() => resend.mutate()}
      >
        {cooldown.isCounting ? `Resend in ${cooldown.secondsLeft}s` : 'Resend'}
      </Button>
      {resend.isSuccess && <output>Email sent.</output>}
      {resend.isError && <output>{resendFailureCopy(resend.error)}</output>}
    </div>
  )
}

const CheckEmailBody = () => {
  const [params] = useSearchParams()
  const address = params.get(AUTH_QUERY.email)?.trim() ?? ''
  const hasAddress = address !== ''

  return (
    <AuthCard
      title="Check your email"
      lead={
        <Lead>
          {hasAddress ? (
            <>
              We sent a link to confirm your address to <Address>{address}</Address>.
            </>
          ) : (
            'Look in your inbox for the link to confirm your address.'
          )}
        </Lead>
      }
    >
      <Note>
        If it has not come, look in spam. Once you confirm, the owner of this raven approves each
        new account by hand, so you can start watching once they have.
      </Note>
      {hasAddress && <Resend address={address} />}
      <Note>
        {hasAddress ? (
          <Link to={AUTH_ROUTES.signIn}>Back to sign in</Link>
        ) : (
          <>
            <Link to={AUTH_ROUTES.signIn}>Sign in</Link> or{' '}
            <Link to={AUTH_ROUTES.signUp}>Create an account</Link>
          </>
        )}
      </Note>
    </AuthCard>
  )
}

/**
 * `/check-email?email=`: where sign up leaves the visitor. It names the address
 * the link went to and can send it again, once a minute.
 */
export const CheckEmailPage = () => (
  <AuthScreen audience={AUDIENCES.signedOut}>
    <CheckEmailBody />
  </AuthScreen>
)
