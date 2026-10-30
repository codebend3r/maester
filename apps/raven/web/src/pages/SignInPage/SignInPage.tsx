import { useMutation } from '@tanstack/react-query'
import { type FormEvent, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Button } from '@raven/ui'
import { AUTH_ROUTES } from '@raven/core'
import { EmailField, PasswordField } from '@/components/AuthScreen/AuthFields'
import { AuthForm, Fields, Lead, Note, SubmitButton } from '@/components/AuthScreen/AuthCard'
import { AUDIENCES, AuthScreen } from '@/components/AuthScreen/AuthScreen'
import { AUTH_ERRORS, errorCodeOf, resendFailureCopy } from '@/lib/authErrors'
import { AUTH_QUERY, checkEmailPath, safeReturnPath } from '@/lib/authRoutes'
import { callAuth, resendConfirmation } from '@/lib/session'
import { useAuthSession } from '@/stores/authSession'
import { SIGN_IN_COPY } from '@/pages/SignInPage/copy'
import styles from '@/pages/SignInPage/SignInPage.module.scss'
import { COMMON_COPY } from '@/lib/copy'

const failureCopy = (error: unknown): string => {
  switch (errorCodeOf(error)) {
    case AUTH_ERRORS.invalidCredentials:
      return SIGN_IN_COPY.wrongCredentials
    case AUTH_ERRORS.emailNotConfirmed:
      return SIGN_IN_COPY.unconfirmed
    default:
      return SIGN_IN_COPY.failed
  }
}

type SignInFormProps = { returnPath: string }

const SignInForm = ({ returnPath }: SignInFormProps) => {
  const navigate = useNavigate()
  const isReady = useAuthSession((state) => state.client !== null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isShown, setShown] = useState(false)
  type SignInMutationFnProps = { email: string; password: string }

  const signIn = useMutation({
    mutationFn: (credentials: SignInMutationFnProps) =>
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
      title={SIGN_IN_COPY.title}
      lead={<Lead>{SIGN_IN_COPY.lead(window.location.hostname)}</Lead>}
      onSubmit={submit}
    >
      <Fields>
        <EmailField value={email} onChange={setEmail} />
        <PasswordField
          label={SIGN_IN_COPY.password}
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
                {SIGN_IN_COPY.resendConfirmation}
              </Button>
              <Link to={checkEmailPath({ email: attempted })}>{SIGN_IN_COPY.checkEmail}</Link>
              {resend.isSuccess && <output>{SIGN_IN_COPY.confirmationSent}</output>}
              {resend.isError && <output>{resendFailureCopy(resend.error)}</output>}
            </div>
          )}
        </PasswordField>
        <Link className={styles.forgot} to={AUTH_ROUTES.forgot}>
          {SIGN_IN_COPY.forgot}
        </Link>
      </Fields>
      <SubmitButton isDisabled={signIn.isPending || !isReady}>
        {signIn.isPending ? SIGN_IN_COPY.signingIn : COMMON_COPY.signIn}
      </SubmitButton>
      <Note>
        {SIGN_IN_COPY.newToRaven} <Link to={AUTH_ROUTES.signUp}>{SIGN_IN_COPY.createAccount}</Link>
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
