import { apiFor } from '@raven/native'
import {
  AUTH_OUTCOMES,
  type AppServer,
  FINISH_OUTCOMES,
  IS_SIGN_IN_BYPASSED,
  RAVEN_SERVER,
  SIGN_IN_STEPS,
  type SecretStep,
  type SignInStep,
  finishSignIn,
  stepAfterAccount,
  stepAfterSecret,
  useSubmit,
} from '@raven/native/headless'
import { KeyedView, type ViewOf, type ViewsOf } from '@raven/ui/headless'
import { useRouter } from 'expo-router'
import { type Dispatch, type SetStateAction, useState } from 'react'

import { Text } from '@/layouts/Text'
import { BUTTON_TONES, Field, Form, FormButton, useFormStyles } from '@/layouts'
import { useAccountSession } from '@/account/session'
import { TEST_ACCOUNT } from '@/account/testAccount'
import { APP_ROUTES } from '@/routes'
import { SIGN_IN_COPY } from '@/screens/copy'
import { useActiveServer } from '@/stores/activeServer'

/** What the PIN step and the admin step each ask for. */
const SECRET_STEPS = {
  [SIGN_IN_STEPS.pin]: { prompt: SIGN_IN_COPY.pinPrompt, label: SIGN_IN_COPY.pin, isNumeric: true },
  [SIGN_IN_STEPS.admin]: {
    prompt: SIGN_IN_COPY.adminPrompt,
    label: SIGN_IN_COPY.adminPassword,
    isNumeric: false,
  },
} as const satisfies Record<SecretStep['kind'], unknown>

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
  onSubmit: (submitted: SubmitSecretProps) => void
  onNotNow: (server: AppServer) => void
  onSignOut: () => void
}

/** The PIN or the admin password, each its own form so the field starts empty. */
const SecretForm = ({
  step,
  secret,
  setSecret,
  error,
  isBusy,
  onSubmit,
  onNotNow,
  onSignOut,
}: SecretFormProps) => {
  const formStyles = useFormStyles()
  const { prompt, label, isNumeric } = SECRET_STEPS[step.kind]
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
        onPress={() => onNotNow(step.server)}
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
  secret: Omit<SecretFormProps, 'step'>
  ticketsOff: TicketsOffFormProps
}

const signInViewOf = ({
  step,
  account,
  secret,
  ticketsOff,
}: SignInViewOfProps): ViewOf<SignInViewProps> => {
  switch (step.kind) {
    case SIGN_IN_STEPS.account:
      return { key: SIGN_IN_STEPS.account, props: account }
    case SIGN_IN_STEPS.pin:
    case SIGN_IN_STEPS.admin:
      return { key: step.kind, props: { ...secret, step } }
    case SIGN_IN_STEPS.ticketsOff:
      return { key: SIGN_IN_STEPS.ticketsOff, props: ticketsOff }
    default: {
      const unreachable: never = step
      return unreachable
    }
  }
}

/**
 * The first launch: the account's email and password (the web's Supabase sign-in, against the
 * one server the app talks to), then the PIN when the account may see locked libraries, then
 * the admin password when the admin lock would still hide them. An end to end build names an
 * accountless fixture in its bundle, so it begins at the PIN.
 */
export const SignIn = () => {
  const router = useRouter()
  const [step, setStep] = useState<SignInStep>(
    IS_SIGN_IN_BYPASSED ? { kind: SIGN_IN_STEPS.pin, server: RAVEN_SERVER } : { kind: SIGN_IN_STEPS.account },
  )
  const [email, setEmail] = useState(TEST_ACCOUNT?.email ?? '')
  const [password, setPassword] = useState(TEST_ACCOUNT?.password ?? '')
  const [secret, setSecret] = useState('')
  const { isBusy, error, setError, run } = useSubmit({ unreachable: SIGN_IN_COPY.unreachable })

  // From Settings, Home is under it in the stack: go back down to it rather than stack another.
  const goHome = () => router.dismissTo(APP_ROUTES.home)

  const askFor = (next: SignInStep) => {
    setSecret('')
    setStep(next)
  }

  const finish = async (server: AppServer) => {
    const outcome = await finishSignIn({
      servers: useActiveServer,
      server,
      api: apiFor({ server, session: useAccountSession }),
    })
    switch (outcome) {
      case FINISH_OUTCOMES.done:
        goHome()
        return
      case FINISH_OUTCOMES.ticketsOff:
        askFor({ kind: SIGN_IN_STEPS.ticketsOff })
        return
      case FINISH_OUTCOMES.full:
        setError(SIGN_IN_COPY.full)
        return
      case FINISH_OUTCOMES.notAdded:
        setError(SIGN_IN_COPY.notAdded)
        return
      default: {
        const unknown: never = outcome
        return unknown
      }
    }
  }

  type SubmitAccountProps = { typedPassword?: string }

  const submitAccount = ({ typedPassword = password }: SubmitAccountProps = {}) => {
    const trimmed = email.trim()
    if (trimmed === '' || typedPassword === '') {
      setError(SIGN_IN_COPY.badAccount)
      return
    }
    run(async () => {
      const outcome = await useAccountSession.getState().signIn({
        email: trimmed,
        password: typedPassword,
      })
      if (outcome.kind === AUTH_OUTCOMES.unreachable) {
        setError(SIGN_IN_COPY.unreachable)
        return
      }
      if (outcome.kind === AUTH_OUTCOMES.refused) {
        setError(outcome.message)
        return
      }
      setPassword('')
      const next = await stepAfterAccount({
        api: apiFor({ server: RAVEN_SERVER, session: useAccountSession }),
        server: RAVEN_SERVER,
      })
      if (next !== null) {
        askFor(next)
        return
      }
      await finish(RAVEN_SERVER)
    })
  }

  const submitSecret = ({ step: secretStep, text }: SubmitSecretProps) =>
    run(async () => {
      const { server } = secretStep
      const api = apiFor({ server, session: useAccountSession })
      const next = await stepAfterSecret({ api, step: secretStep, secret: text })
      if (next !== null) {
        askFor(next)
        return
      }
      await finish(server)
    })

  const signOut = () => {
    useAccountSession.getState().signOut()
    askFor({ kind: SIGN_IN_STEPS.account })
    setError(null)
  }

  const view = signInViewOf({
    step,
    account: {
      email,
      setEmail,
      password,
      setPassword,
      error,
      isBusy,
      onSubmit: (typedPassword) => submitAccount({ typedPassword }),
    },
    secret: {
      secret,
      setSecret,
      error,
      isBusy,
      onSubmit: submitSecret,
      onNotNow: (server) => run(() => finish(server)),
      onSignOut: signOut,
    },
    ticketsOff: { onContinue: goHome },
  })
  return <KeyedView<SignInViewProps> view={view} views={SIGN_IN_VIEWS} />
}
