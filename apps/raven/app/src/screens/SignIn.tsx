import { apiFor } from '@raven/native'
import {
  IS_SIGN_IN_BYPASSED,
  RAVEN_SERVER,
  SIGN_IN_STEPS,
  type SecretPrompt,
  type SecretStep,
  type SignInStep,
  signInFlowFor,
} from '@raven/native/headless'
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

type SubmitSecretProps = { step: SecretStep; text: string }

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

type SecretFormProps = {
  step: SecretStep
  secret: string
  setSecret: Dispatch<SetStateAction<string>>
  error: string | null
  isBusy: boolean
  prompt: SecretPrompt
  onSubmit: (submitted: SubmitSecretProps) => void
  onNotNow: (step: SecretStep) => void
  onSignOut: () => void
}

/** The PIN or the admin password, each its own form so the field starts empty. */
const SecretForm = ({
  step,
  secret,
  setSecret,
  error,
  isBusy,
  prompt: { prompt, label, isNumeric },
  onSubmit,
  onNotNow,
  onSignOut,
}: SecretFormProps) => {
  const formStyles = useFormStyles()
  return (
    <Form key={step.kind} title={step.server.name}>
      <Text style={formStyles.note}>{prompt}</Text>
      <Field
        isFirst
        isNumeric={isNumeric}
        isSecret
        label={label}
        onChangeText={setSecret}
        onSubmit={({ text }) => onSubmit({ step, text })}
        value={secret}
      />
      <ErrorLine error={error} />
      <FormButton
        isDisabled={isBusy}
        label={SIGN_IN_COPY.unlock}
        onPress={() => onSubmit({ step, text: secret })}
        tone={BUTTON_TONES.primary}
      />
      <FormButton
        isDisabled={isBusy}
        label={SIGN_IN_COPY.notNow}
        onPress={() => onNotNow(step)}
        tone={BUTTON_TONES.quiet}
      />
      <FormButton
        isDisabled={isBusy}
        label={SIGN_IN_COPY.signOut}
        onPress={onSignOut}
        tone={BUTTON_TONES.ghost}
      />
    </Form>
  )
}

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
  [SIGN_IN_STEPS.pin]: SecretFormProps
  [SIGN_IN_STEPS.admin]: SecretFormProps
  [SIGN_IN_STEPS.ticketsOff]: TicketsOffFormProps
}

const SIGN_IN_VIEWS = {
  [SIGN_IN_STEPS.account]: AccountForm,
  [SIGN_IN_STEPS.pin]: SecretForm,
  [SIGN_IN_STEPS.admin]: SecretForm,
  [SIGN_IN_STEPS.ticketsOff]: TicketsOffForm,
} as const satisfies ViewsOf<SignInViewProps>

type SignInViewOfProps = {
  step: SignInStep
  account: AccountFormProps
  secret: Omit<SecretFormProps, 'step' | 'prompt'>
  secretSteps: Record<SecretStep['kind'], SecretPrompt>
  ticketsOff: TicketsOffFormProps
}

const signInViewOf = ({
  step,
  account,
  secret,
  secretSteps,
  ticketsOff,
}: SignInViewOfProps): ViewOf<SignInViewProps> => {
  switch (step.kind) {
    case SIGN_IN_STEPS.account:
      return { key: SIGN_IN_STEPS.account, props: account }
    case SIGN_IN_STEPS.pin:
    case SIGN_IN_STEPS.admin:
      return { key: step.kind, props: { ...secret, step, prompt: secretSteps[step.kind] } }
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
  isBypassed: IS_SIGN_IN_BYPASSED,
})

/**
 * The first launch: the account's email and password (the web's Supabase sign-in, against the
 * one server the app talks to), then the PIN when the account may see locked libraries, then
 * the admin password when the admin lock would still hide them, over `@raven/native`'s
 * `signInFlowFor`.
 */
export const SignIn = () => {
  const router = useRouter()
  // From Settings, Home is under it in the stack: go back down to it rather than stack another.
  const goHome = () => router.dismissTo(APP_ROUTES.home)
  const {
    step,
    email,
    setEmail,
    password,
    setPassword,
    secret,
    setSecret,
    isBusy,
    error,
    secretSteps,
    submitAccount,
    submitSecret,
    notNow,
    signOut,
  } = useSignInFlow({
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
    secret: {
      secret,
      setSecret,
      error,
      isBusy,
      onSubmit: submitSecret,
      onNotNow: notNow,
      onSignOut: signOut,
    },
    secretSteps,
    ticketsOff: { onContinue: goHome },
  })
  return <KeyedView<SignInViewProps> view={view} views={SIGN_IN_VIEWS} />
}
