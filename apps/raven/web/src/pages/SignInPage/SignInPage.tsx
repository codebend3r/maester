import { useMutation } from '@tanstack/react-query'
import { type FormEvent, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Button } from '@raven/ui'
import { EmailField, PasswordField } from '@/components/AuthScreen/AuthFields'
import { AuthForm, Fields, Lead, Note, SubmitButton } from '@/components/AuthScreen/AuthCard'
import { AUDIENCES, AuthScreen } from '@/components/AuthScreen/AuthScreen'
import { AUTH_ERRORS, errorCodeOf, resendFailureCopy } from '@/lib/authErrors'
import { AUTH_QUERY, AUTH_ROUTES, checkEmailPath, safeReturnPath } from '@/lib/authRoutes'
import { callAuth, resendConfirmation } from '@/lib/session'
import { useAuthSession } from '@/stores/authSession'
import styles from '@/pages/SignInPage/SignInPage.module.scss'

const failureCopy = (error: unknown): string => {
  switch (errorCodeOf(error)) {
    case AUTH_ERRORS.invalidCredentials:
      return 'Email or password is wrong.'
    case AUTH_ERRORS.emailNotConfirmed:
      return 'Confirm your email to sign in.'
    default:
      return 'Sign in failed. Try again.'
  }
}

const SignInForm = ({ returnPath }: { returnPath: string }) => {
  const navigate = useNavigate()
  const isReady = useAuthSession((state) => state.client !== null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isShown, setShown] = useState(false)
  const signIn = useMutation({
    mutationFn: (credentials: { email: string; password: string }) =>
      callAuth((client) => client.signInWithPassword(credentials)),
    onSuccess: () => navigate(returnPath, { replace: true }),
  })
  const resend = useMutation({ mutationFn: resendConfirmation })
  const isUnconfirmed = errorCodeOf(signIn.error) === AUTH_ERRORS.emailNotConfirmed
  const attempted = signIn.variables?.email ?? ''

  const submit = (event: FormEvent) => {
    event.preventDefault()
    resend.reset()
    signIn.mutate({ email: email.trim(), password })
  }

  return (
    <AuthForm
      title="Welcome back"
      lead={<Lead>Sign in to watch on {window.location.hostname}</Lead>}
      onSubmit={submit}
    >
      <Fields>
        <EmailField value={email} onChange={setEmail} />
        <PasswordField
          label="Password"
          autoComplete="current-password"
          value={password}
          onChange={setPassword}
          error={signIn.isError ? failureCopy(signIn.error) : null}
          isShown={isShown}
          onToggleShown={() => setShown((now) => !now)}
        >
          {isUnconfirmed && (
            <div className={styles.unconfirmed}>
              <Button
                disabled={resend.isPending}
                onClick={() => resend.mutate({ email: attempted })}
              >
                Resend confirmation email
              </Button>
              <Link to={checkEmailPath({ email: attempted })}>Check your email</Link>
              {resend.isSuccess && <output>Confirmation email sent.</output>}
              {resend.isError && <output>{resendFailureCopy(resend.error)}</output>}
            </div>
          )}
        </PasswordField>
        <Link className={styles.forgot} to={AUTH_ROUTES.forgot}>
          Forgot password?
        </Link>
      </Fields>
      <SubmitButton isDisabled={signIn.isPending || !isReady}>
        {signIn.isPending ? 'Signing in…' : 'Sign in'}
      </SubmitButton>
      <Note>
        New to raven? <Link to={AUTH_ROUTES.signUp}>Create an account</Link>
      </Note>
    </AuthForm>
  )
}

/**
 * `/sign-in`, the whole screen: a tilted wall of posters with raven's
 * promise over it, put away on a phone, beside the form. Email and password
 * sign the viewer in with Supabase; Show reads the password back. A wrong
 * email or password, an email not yet confirmed (which can be sent again)
 * and any other failure each say so under the password, marked as the field
 * to fix. Once in, the viewer goes to the path they came from, `return_to`,
 * or home.
 */
export const SignInPage = () => {
  const [params] = useSearchParams()
  const returnPath = safeReturnPath(params.get(AUTH_QUERY.returnTo))

  return (
    <AuthScreen audience={AUDIENCES.signedOut} approvedTo={returnPath}>
      <SignInForm returnPath={returnPath} />
    </AuthScreen>
  )
}
