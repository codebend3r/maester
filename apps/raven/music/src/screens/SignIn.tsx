import { apiFor } from '@raven/native'
import { RAVEN_SERVER, SIGN_IN_STEPS, type SignInStep, signInFlowFor } from '@raven/native/headless'
import { useRouter } from 'expo-router'
import type { ComponentType } from 'react'

import { BUTTON_TONES, Field, Form, FormButton, FormLine } from '@/components/Form'
import { WREN_ROUTES } from '@/routes'
import { SIGN_IN_COPY } from '@/screens/copy'
import { useWrenAccount } from '@/session'
import { useActiveServer } from '@/stores/activeServer'

const useSignInFlow = signInFlowFor({
  account: useWrenAccount,
  servers: useActiveServer,
  apiOf: (server) => apiFor({ server, session: useWrenAccount }),
  server: RAVEN_SERVER,
})

/** What each step's form is handed: the step, the flow that runs it, and where a finished one goes. */
type StepFormProps = {
  step: SignInStep
  flow: ReturnType<typeof useSignInFlow>
  onDone: () => void
}

type ErrorLineProps = { error: string | null }

/** What went wrong with the last submit, read out as it changes. */
function ErrorLine({ error }: ErrorLineProps) {
  return error !== null && <FormLine isError text={error} />
}

type AccountFormProps = StepFormProps

/** The raven account's email and password. */
function AccountForm({ flow }: AccountFormProps) {
  const { email, setEmail, password, setPassword, isBusy, error, submitAccount } = flow
  return (
    <Form note={SIGN_IN_COPY.note} title={SIGN_IN_COPY.title}>
      <Field
        isEmail
        label={SIGN_IN_COPY.email}
        onChangeText={setEmail}
        onSubmit={() => submitAccount()}
        value={email}
      />
      <Field
        isSecret
        label={SIGN_IN_COPY.password}
        onChangeText={setPassword}
        onSubmit={() => submitAccount()}
        value={password}
      />
      <ErrorLine error={error} />
      <FormButton
        isDisabled={isBusy}
        label={SIGN_IN_COPY.signIn}
        onPress={() => submitAccount()}
        tone={BUTTON_TONES.primary}
      />
    </Form>
  )
}

type TicketsOffFormProps = StepFormProps

/** A server without media tickets, said before the tabs. */
function TicketsOffForm({ onDone }: TicketsOffFormProps) {
  return (
    <Form title={SIGN_IN_COPY.title}>
      <FormLine text={SIGN_IN_COPY.ticketsOff} />
      <FormButton label={SIGN_IN_COPY.continue} onPress={onDone} tone={BUTTON_TONES.primary} />
    </Form>
  )
}

/** The form each step of sign-in draws. */
const SIGN_IN_VIEWS = {
  [SIGN_IN_STEPS.account]: AccountForm,
  [SIGN_IN_STEPS.ticketsOff]: TicketsOffForm,
} as const satisfies Record<SignInStep['kind'], ComponentType<StepFormProps>>

/**
 * The first launch: the raven account's email and password, over `@raven/native`'s
 * `signInFlowFor`. It never asks for a PIN.
 */
export function SignIn() {
  const router = useRouter()
  const openTabs = () => router.replace(WREN_ROUTES.home)
  const flow = useSignInFlow({
    copy: SIGN_IN_COPY,
    initial: { email: '', password: '' },
    onDone: openTabs,
  })
  const StepForm = SIGN_IN_VIEWS[flow.step.kind]
  return <StepForm flow={flow} onDone={openTabs} step={flow.step} />
}
