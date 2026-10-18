import { useMutation } from '@tanstack/react-query'
import { type FormEvent, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { Button } from '@raven/ui'
import { weakPasswordMessage } from '@/lib/authErrors'
import { AUTH_ROUTES, HOME_PATH } from '@/lib/authRoutes'
import { AuthScreen, Brand } from '@/pages/SignInPage/AuthScreen'
import { PasswordFields } from '@/pages/SignUpPage/PasswordFields'
import { useAuthSession } from '@/stores/authSession'
import signInStyles from '@/pages/SignInPage/SignInPage.module.scss'

const FAILED_COPY = 'Could not update your password. Try again.'

const ResetPasswordForm = () => {
  const navigate = useNavigate()
  const client = useAuthSession((state) => state.client)
  const isRecovery = useAuthSession((state) => state.isRecovery)
  const endRecovery = useAuthSession((state) => state.endRecovery)
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [hasTried, setTried] = useState(false)
  // Ending the recovery must not send the visitor to ask for a link while the move home is under way.
  const [isUpdated, setUpdated] = useState(false)
  const update = useMutation({
    mutationFn: async (next: string) => {
      if (client === null) throw new Error('Reset is not ready yet')
      const { error } = await client.updateUser({ password: next })
      if (error) throw error
    },
    onSuccess: () => {
      setUpdated(true)
      endRecovery()
      navigate(HOME_PATH, { replace: true })
    },
  })
  const isMismatched = hasTried && password !== confirmation

  if (!isRecovery && !isUpdated) return <Navigate replace to={AUTH_ROUTES.forgot} />

  const submit = (event: FormEvent) => {
    event.preventDefault()
    setTried(true)
    if (password !== confirmation) return
    update.mutate(password)
  }

  return (
    <form className={signInStyles.form} onSubmit={submit}>
      <Brand />
      <header className={signInStyles.welcome}>
        <h1 className={signInStyles.title}>Choose a new password</h1>
        <p className={signInStyles.lead}>Type it twice, so a typo does not lock you out.</p>
      </header>
      <div className={signInStyles.fields}>
        <PasswordFields
          label="New password"
          password={password}
          confirmation={confirmation}
          refusal={update.isError ? (weakPasswordMessage(update.error) ?? FAILED_COPY) : null}
          isMismatched={isMismatched}
          onPasswordChange={setPassword}
          onConfirmationChange={setConfirmation}
        />
      </div>
      <Button
        type="submit"
        tone="primary"
        className={signInStyles.submit}
        disabled={update.isPending || client === null}
      >
        {update.isPending ? 'Updating password…' : 'Update password'}
      </Button>
    </form>
  )
}

/**
 * `/reset-password`: where a recovery link leaves the visitor. Only the
 * session that link made may choose a new password here; any other visit goes
 * to ask for a link. The screen keeps the visitor even though the link signed
 * them in, so the access state does not send them away first.
 */
export const ResetPasswordPage = () => (
  <AuthScreen shouldKeepVisitor>
    <ResetPasswordForm />
  </AuthScreen>
)
