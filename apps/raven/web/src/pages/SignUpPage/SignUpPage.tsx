import { useMutation } from '@tanstack/react-query'
import { type FormEvent, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AUTH_ROUTES } from '@raven/core'
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
import { checkEmailPath } from '@/lib/authRoutes'
import { callAuth } from '@/lib/session'
import { useConfirmUrl } from '@/lib/useConfirmUrl'
import { useAuthSession } from '@/stores/authSession'
import { SIGN_UP_COPY } from '@/pages/SignUpPage/copy'
import { COMMON_COPY } from '@/lib/copy'

/** A weak password in plain words; the rest of what the server says stays out of the page. */
const failureCopy = (error: unknown): string => {
  if (isRateLimited(error)) return RATE_LIMITED_COPY
  return weakPasswordMessage(error) ?? SIGN_UP_COPY.failed
}

const SignUpForm = () => {
  const navigate = useNavigate()
  const isReady = useAuthSession((state) => state.client !== null)
  const emailRedirectTo = useConfirmUrl()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [hasTried, setTried] = useState(false)
  type SignUpMutationFnProps = { email: string; password: string }

  const signUp = useMutation({
    mutationFn: (credentials: SignUpMutationFnProps) =>
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
      title={SIGN_UP_COPY.title}
      lead={<Lead>{SIGN_UP_COPY.lead(window.location.hostname)}</Lead>}
      onSubmit={submit}
    >
      <Note>{SIGN_UP_COPY.approval}</Note>
      <Fields>
        <EmailField value={email} onChange={setEmail} />
        <PasswordFields
          label={SIGN_UP_COPY.password}
          password={password}
          confirmation={confirmation}
          refusal={
            signUp.isError
              ? { password: signUp.variables.password, message: failureCopy(signUp.error) }
              : null
          }
          isMismatched={isMismatched}
          onPasswordChange={setPassword}
          onConfirmationChange={setConfirmation}
        />
      </Fields>
      <SubmitButton isDisabled={signUp.isPending || !isReady}>
        {signUp.isPending ? SIGN_UP_COPY.creating : SIGN_UP_COPY.create}
      </SubmitButton>
      <Note>
        {SIGN_UP_COPY.haveAccount} <Link to={AUTH_ROUTES.signIn}>{COMMON_COPY.signIn}</Link>
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
