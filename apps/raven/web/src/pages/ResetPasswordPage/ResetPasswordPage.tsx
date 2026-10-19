import { useMutation } from '@tanstack/react-query'
import { type FormEvent, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { PasswordFields } from '@/components/AuthScreen/AuthFields'
import { AuthForm, Fields, Lead, SubmitButton } from '@/components/AuthScreen/AuthCard'
import { AUDIENCES, AuthScreen } from '@/components/AuthScreen/AuthScreen'
import { weakPasswordMessage } from '@/lib/authErrors'
import { AUTH_ROUTES, HOME_PATH } from '@/lib/authRoutes'
import { callAuth } from '@/lib/session'
import { useAuthSession } from '@/stores/authSession'

const FAILED_COPY = 'Could not update your password. Try again.'

const ResetPasswordForm = () => {
  const isReady = useAuthSession((state) => state.client !== null)
  const isRecovery = useAuthSession((state) => state.isRecovery)
  const endRecovery = useAuthSession((state) => state.endRecovery)
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [hasTried, setTried] = useState(false)
  const update = useMutation({
    mutationFn: (next: string) => callAuth((client) => client.updateUser({ password: next })),
  })
  const isMismatched = hasTried && password !== confirmation

  if (update.isSuccess) return <Navigate replace to={HOME_PATH} />
  if (!isRecovery) return <Navigate replace to={AUTH_ROUTES.forgot} />

  const submit = (event: FormEvent) => {
    event.preventDefault()
    setTried(true)
    if (password !== confirmation) return
    // Ended once the update reads as done, so the page goes home rather than to ask for a link.
    update.mutate(password, { onSuccess: endRecovery })
  }

  return (
    <AuthForm
      title="Choose a new password"
      lead={<Lead>Type it twice, so a typo does not lock you out.</Lead>}
      onSubmit={submit}
    >
      <Fields>
        <PasswordFields
          label="New password"
          password={password}
          confirmation={confirmation}
          refusal={update.isError ? (weakPasswordMessage(update.error) ?? FAILED_COPY) : null}
          isMismatched={isMismatched}
          onPasswordChange={setPassword}
          onConfirmationChange={setConfirmation}
        />
      </Fields>
      <SubmitButton isDisabled={update.isPending || !isReady}>
        {update.isPending ? 'Updating password…' : 'Update password'}
      </SubmitButton>
    </AuthForm>
  )
}

/**
 * `/reset-password`: where a recovery link leaves the visitor. Only the
 * session that link made may choose a new password here; any other visit goes
 * to ask for a link. The screen keeps the visitor even though the link signed
 * them in, so the access state does not send them away first.
 */
export const ResetPasswordPage = () => (
  <AuthScreen audience={AUDIENCES.anyone}>
    <ResetPasswordForm />
  </AuthScreen>
)
