import { useMutation } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'
import { Button } from '@raven/ui'
import { resendFailureCopy } from '@/lib/authErrors'
import { AUTH_QUERY, AUTH_ROUTES } from '@/lib/authRoutes'
import { useCooldown } from '@/lib/useCooldown'
import { AuthScreen, Brand } from '@/pages/SignInPage/AuthScreen'
import { useAuthSession } from '@/stores/authSession'
import signInStyles from '@/pages/SignInPage/SignInPage.module.scss'
import styles from '@/pages/CheckEmailPage/CheckEmailPage.module.scss'

const Resend = ({ address }: { address: string }) => {
  const client = useAuthSession((state) => state.client)
  const cooldown = useCooldown()
  const resend = useMutation({
    mutationFn: async () => {
      if (client === null) throw new Error('Resend is not ready yet')
      const { error } = await client.resend({ type: 'signup', email: address })
      if (error) throw error
    },
    onSuccess: cooldown.start,
  })
  const isCoolingDown = cooldown.secondsLeft > 0

  return (
    <div className={styles.resend}>
      <Button
        disabled={resend.isPending || isCoolingDown || client === null}
        onClick={() => resend.mutate()}
      >
        {isCoolingDown ? `Resend in ${cooldown.secondsLeft}s` : 'Resend'}
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
    <section className={signInStyles.form}>
      <Brand />
      <header className={signInStyles.welcome}>
        <h1 className={signInStyles.title}>Check your email</h1>
        {hasAddress ? (
          <p className={signInStyles.lead}>
            We sent a link to confirm your address to{' '}
            <span className={styles.address}>{address}</span>.
          </p>
        ) : (
          <p className={signInStyles.lead}>
            Look in your inbox for the link to confirm your address.
          </p>
        )}
      </header>
      <p className={styles.note}>
        If it has not come, look in spam. Once you confirm, the owner of this raven approves each
        new account by hand, so you can start watching once they have.
      </p>
      {hasAddress && <Resend address={address} />}
      <p className={signInStyles.switch}>
        {hasAddress ? (
          <Link to={AUTH_ROUTES.signIn}>Back to sign in</Link>
        ) : (
          <>
            <Link to={AUTH_ROUTES.signIn}>Sign in</Link> or{' '}
            <Link to={AUTH_ROUTES.signUp}>Create an account</Link>
          </>
        )}
      </p>
    </section>
  )
}

/**
 * `/check-email?email=`: where sign up leaves the visitor. It names the address
 * the link went to and can send it again, once a minute.
 */
export const CheckEmailPage = () => (
  <AuthScreen>
    <CheckEmailBody />
  </AuthScreen>
)
