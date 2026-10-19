import { useMutation } from '@tanstack/react-query'
import { type FormEvent, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { EmailField, PasswordFields } from '@/components/AuthScreen/AuthFields'
import { AuthForm, Fields, Lead, Note, SubmitButton } from '@/components/AuthScreen/AuthCard'
import { AUDIENCES, AuthScreen } from '@/components/AuthScreen/AuthScreen'
import {
  AUTH_ERRORS,
  RATE_LIMITED_COPY,
  errorCodeOf,
  isRateLimited,
  weakPasswordMessage,
} from '@/lib/authErrors'
import { AUTH_ROUTES, checkEmailPath } from '@/lib/authRoutes'
import { callAuth } from '@/lib/session'
import { useConfirmUrl } from '@/lib/useConfirmUrl'
import { useAuthSession } from '@/stores/authSession'

const FAILED_COPY = 'Sign up failed. Try again.'

/** The server's own words for a weak password; the rest of what it says stays out of the page. */
const failureCopy = (error: unknown): string => {
  if (isRateLimited(error)) return RATE_LIMITED_COPY
  return weakPasswordMessage(error) ?? FAILED_COPY
}

const SignUpForm = () => {
  const navigate = useNavigate()
  const isReady = useAuthSession((state) => state.client !== null)
  const emailRedirectTo = useConfirmUrl()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [hasTried, setTried] = useState(false)
  const signUp = useMutation({
    mutationFn: (credentials: { email: string; password: string }) =>
      callAuth(async (client) => {
        const answer = await client.signUp({ ...credentials, options: { emailRedirectTo } })
        // The same answer for a new address and for one that already has an
        // account, so the page gives nothing away about who is registered.
        return errorCodeOf(answer.error) === AUTH_ERRORS.userAlreadyExists
          ? { error: null }
          : answer
      }),
    onSuccess: (_result, { email: address }) =>
      navigate(checkEmailPath({ email: address }), { replace: true }),
  })
  const isMismatched = hasTried && password !== confirmation

  const submit = (event: FormEvent) => {
    event.preventDefault()
    setTried(true)
    if (password !== confirmation) return
    signUp.mutate({ email: email.trim(), password })
  }

  return (
    <AuthForm
      title="Create your account"
      lead={<Lead>Sign up to watch on {window.location.hostname}</Lead>}
      onSubmit={submit}
    >
      <Note>
        We will email you a link to confirm your address. The owner of this raven approves each new
        account by hand, so you can start watching once they have.
      </Note>
      <Fields>
        <EmailField value={email} onChange={setEmail} />
        <PasswordFields
          label="Password"
          password={password}
          confirmation={confirmation}
          refusal={signUp.isError ? failureCopy(signUp.error) : null}
          isMismatched={isMismatched}
          onPasswordChange={setPassword}
          onConfirmationChange={setConfirmation}
        />
      </Fields>
      <SubmitButton isDisabled={signUp.isPending || !isReady}>
        {signUp.isPending ? 'Creating account…' : 'Create account'}
      </SubmitButton>
      <Note>
        Already have an account? <Link to={AUTH_ROUTES.signIn}>Sign in</Link>
      </Note>
    </AuthForm>
  )
}

/**
 * `/sign-up`: an email and a password, typed twice. The two must match before
 * anything is sent. Whatever Supabase answers about the address, a new one or
 * one already registered, the visitor goes on to ask them to check their email.
 */
export const SignUpPage = () => (
  <AuthScreen audience={AUDIENCES.signedOut}>
    <SignUpForm />
  </AuthScreen>
)
