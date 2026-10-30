import { useMutation } from '@tanstack/react-query'
import { type ComponentType, type FormEvent, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { AUTH_ROUTES } from '@raven/core'
import { PasswordFields } from '@/components/AuthScreen/AuthFields'
import { AuthForm, Fields, Lead, SubmitButton } from '@/components/AuthScreen/AuthCard'
import { AUDIENCES, AuthScreen } from '@/components/AuthScreen/AuthScreen'
import { weakPasswordMessage } from '@/lib/authErrors'
import { HOME_PATH } from '@/lib/authRoutes'
import { callAuth } from '@/lib/session'
import { useAuthSession } from '@/stores/authSession'
import { RESET_PASSWORD_COPY } from '@/pages/ResetPasswordPage/copy'

const useUpdatePassword = () =>
  useMutation({
    mutationFn: (next: string) => callAuth((client) => client.updateUser({ password: next })),
  })

type ResetViewProps = { update: ReturnType<typeof useUpdatePassword> }

type ResetPasswordFormProps = ResetViewProps

const ResetPasswordForm = ({ update }: ResetPasswordFormProps) => {
  const isReady = useAuthSession((state) => state.client !== null)
  const endRecovery = useAuthSession((state) => state.endRecovery)
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [hasTried, setTried] = useState(false)
  const isMismatched = hasTried && password !== confirmation

  const submit = (event: FormEvent) => {
    event.preventDefault()
    setTried(true)
    if (password !== confirmation) return
    // Ended once the update reads as done, so the page goes home rather than to ask for a link.
    update.mutate(password, { onSuccess: endRecovery })
  }

  return (
    <AuthForm
      title={RESET_PASSWORD_COPY.title}
      lead={<Lead>{RESET_PASSWORD_COPY.lead}</Lead>}
      onSubmit={submit}
    >
      <Fields>
        <PasswordFields
          label={RESET_PASSWORD_COPY.newPassword}
          password={password}
          confirmation={confirmation}
          refusal={
            update.isError
              ? {
                  password: update.variables,
                  message: weakPasswordMessage(update.error) ?? RESET_PASSWORD_COPY.failed,
                }
              : null
          }
          isMismatched={isMismatched}
          onPasswordChange={setPassword}
          onConfirmationChange={setConfirmation}
        />
      </Fields>
      <SubmitButton isDisabled={update.isPending || !isReady}>
        {update.isPending ? RESET_PASSWORD_COPY.updating : RESET_PASSWORD_COPY.update}
      </SubmitButton>
    </AuthForm>
  )
}

const GoHome = () => <Navigate replace to={HOME_PATH} />

const AskForLink = () => <Navigate replace to={AUTH_ROUTES.forgot} />

const RESET_VIEW_KEYS = {
  updated: 'updated',
  unrecovered: 'unrecovered',
  editing: 'editing',
} as const
type ResetViewKey = (typeof RESET_VIEW_KEYS)[keyof typeof RESET_VIEW_KEYS]

const RESET_VIEWS = {
  [RESET_VIEW_KEYS.updated]: GoHome,
  [RESET_VIEW_KEYS.unrecovered]: AskForLink,
  [RESET_VIEW_KEYS.editing]: ResetPasswordForm,
} as const satisfies Record<ResetViewKey, ComponentType<ResetViewProps>>

type ResetViewKeyOfProps = { isUpdated: boolean; isRecovery: boolean }

/** Home once the password is updated; a visit that no recovery link made goes to ask for one. */
const resetViewKeyOf = ({ isUpdated, isRecovery }: ResetViewKeyOfProps): ResetViewKey => {
  if (isUpdated) return RESET_VIEW_KEYS.updated
  if (!isRecovery) return RESET_VIEW_KEYS.unrecovered
  return RESET_VIEW_KEYS.editing
}

const ResetPasswordBody = () => {
  const isRecovery = useAuthSession((state) => state.isRecovery)
  const update = useUpdatePassword()
  const View: ComponentType<ResetViewProps> =
    RESET_VIEWS[resetViewKeyOf({ isUpdated: update.isSuccess, isRecovery })]
  return <View update={update} />
}

/**
 * `/reset-password`: where a recovery link leaves the visitor. Only the
 * session that link made may choose a new password here; any other visit goes
 * to ask for a link. The screen keeps the visitor even though the link signed
 * them in, so the access state does not send them away first.
 */
export const ResetPasswordPage = () => (
  <AuthScreen audience={AUDIENCES.anyone}>
    <ResetPasswordBody />
  </AuthScreen>
)
