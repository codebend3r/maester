import { apiFor } from '@raven/native'
import { RAVEN_SERVER, SIGN_IN_STEPS, type SignInStep, signInFlowFor } from '@raven/native/headless'
import { KeyedView, type ViewOf, type ViewsOf } from '@raven/ui/headless'
import { useRouter } from 'expo-router'
import type { Dispatch, SetStateAction } from 'react'

import { Text } from '@/layouts/Text'
import { BUTTON_TONES, Field, Form, FormButton, useFormStyles } from '@/layouts'
import { useAccountSession } from '@/account/session'
import { TEST_ACCOUNT } from '@/account/testAccount'
import { APP_ROUTES } from '@/routes'
import { SIGN_IN_COPY } from '@/screens/copy'
import { useActiveServer } from '@/stores/activeServer'

type ErrorLineProps = { error: string | null }

/** What went wrong with the last submit, read out as it changes. */
const ErrorLine = ({ error }: ErrorLineProps) => {
  const formStyles = useFormStyles()
  return (
    error !== null && (
      <Text accessibilityLiveRegion="polite" style={formStyles.error}>
        {error}
      </Text>
    )
  )
}

type AccountFormProps = {
  email: string
  setEmail: Dispatch<SetStateAction<string>>
  password: string
  setPassword: Dispatch<SetStateAction<string>>
  error: string | null
  isBusy: boolean
  onSubmit: (typedPassword?: string) => void
}

/** The account's email and password. */
const AccountForm = ({
  email,
  setEmail,
  password,
  setPassword,
  error,
  isBusy,
  onSubmit,
}: AccountFormProps) => (
  <Form title={SIGN_IN_COPY.title}>
    <Field
      isEmail
      isFirst={TEST_ACCOUNT === null}
      label={SIGN_IN_COPY.email}
      onChangeText={setEmail}
      onSubmit={({ text }) => setEmail(text)}
      value={email}
    />
    <Field
      isSecret
      label={SIGN_IN_COPY.password}
      onChangeText={setPassword}
      onSubmit={({ text }) => {
        setPassword(text)
        onSubmit(text)
      }}
      value={password}
    />
    <ErrorLine error={error} />
    <FormButton
      isDisabled={isBusy}
      isFirst={TEST_ACCOUNT !== null}
      label={SIGN_IN_COPY.signIn}
      onPress={() => onSubmit()}
      tone={BUTTON_TONES.primary}
    />
  </Form>
)

type TicketsOffFormProps = { onContinue: () => void }

/** A server without media tickets, said in the spec's words before Home. */
const TicketsOffForm = ({ onContinue }: TicketsOffFormProps) => {
  const formStyles = useFormStyles()
  return (
    <Form title={SIGN_IN_COPY.title}>
      <Text accessibilityLiveRegion="polite" style={formStyles.notice}>
        {SIGN_IN_COPY.ticketsOff}
      </Text>
      <FormButton label={SIGN_IN_COPY.continue} onPress={onContinue} tone={BUTTON_TONES.primary} />
    </Form>
  )
}

type SignInViewProps = {
  [SIGN_IN_STEPS.account]: AccountFormProps
  [SIGN_IN_STEPS.ticketsOff]: TicketsOffFormProps
}

const SIGN_IN_VIEWS = {
  [SIGN_IN_STEPS.account]: AccountForm,
  [SIGN_IN_STEPS.ticketsOff]: TicketsOffForm,
} as const satisfies ViewsOf<SignInViewProps>

type SignInViewOfProps = {
  step: SignInStep
  account: AccountFormProps
  ticketsOff: TicketsOffFormProps
}

const signInViewOf = ({
  step,
  account,
  ticketsOff,
}: SignInViewOfProps): ViewOf<SignInViewProps> => {
  switch (step.kind) {
    case SIGN_IN_STEPS.account:
      return { key: SIGN_IN_STEPS.account, props: account }
    case SIGN_IN_STEPS.ticketsOff:
      return { key: SIGN_IN_STEPS.ticketsOff, props: ticketsOff }
    default: {
      const unreachable: never = step
      return unreachable
    }
  }
}

const useSignInFlow = signInFlowFor({
  account: useAccountSession,
  servers: useActiveServer,
  apiOf: (server) => apiFor({ server, session: useAccountSession }),
  server: RAVEN_SERVER,
})

/**
 * The first launch: the account's email and password (the web's Supabase sign-in, against the
 * one server the app talks to), over `@raven/native`'s `signInFlowFor`. It never asks for a PIN.
 */
export const SignIn = () => {
  const router = useRouter()
  // From Settings, Home is under it in the stack: go back down to it rather than stack another.
  const goHome = () => router.dismissTo(APP_ROUTES.home)
  const { step, email, setEmail, password, setPassword, isBusy, error, submitAccount } =
    useSignInFlow({
      copy: SIGN_IN_COPY,
      initial: { email: TEST_ACCOUNT?.email ?? '', password: TEST_ACCOUNT?.password ?? '' },
      onDone: goHome,
    })

  const view = signInViewOf({
    step,
    account: {
      email,
      setEmail,
      password,
      setPassword,
      error,
      isBusy,
      onSubmit: (typedPassword) => submitAccount({ password: typedPassword }),
    },
    ticketsOff: { onContinue: goHome },
  })
  return <KeyedView<SignInViewProps> view={view} views={SIGN_IN_VIEWS} />
}
