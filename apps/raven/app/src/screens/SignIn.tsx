import { ADMIN_LOCK_STATES, type ApiClient } from '@raven/core'
import { useRouter } from 'expo-router'
import { type Dispatch, type SetStateAction, useState } from 'react'
import { KeyedView, type ViewOf, type ViewsOf } from '@raven/ui/headless'

import { Text } from '@/layouts/Text'
import { BUTTON_TONES, Field, Form, FormButton, useFormStyles } from '@/layouts'
import { useAccountSession } from '@/account/accountSession'
import { TEST_ACCOUNT } from '@/account/testAccount'
import { AUTH_OUTCOMES } from '@/account/supabaseAuth'
import { APP_ROUTES } from '@/routes'
import { SIGN_IN_COPY } from '@/screens/copy'
import { useSubmit } from '@/screens/useSubmit'
import { IS_SIGN_IN_BYPASSED, RAVEN_SERVER } from '@/servers/ravenServer'
import { apiFor } from '@/servers/serverClient'
import { ADD_OUTCOMES, type AppServer } from '@/servers/serverList'
import { TICKET_SUPPORT, ticketSupportOf } from '@/servers/tickets'
import { useActiveServer } from '@/stores/activeServer'

const STEPS = { account: 'account', pin: 'pin', admin: 'admin', ticketsOff: 'ticketsOff' } as const

/** A step that asks for a secret the server unlocks with. */
type SecretStep = { kind: typeof STEPS.pin | typeof STEPS.admin; server: AppServer }

type Step = { kind: typeof STEPS.account } | SecretStep | { kind: typeof STEPS.ticketsOff }

type UnlockProps = { api: ApiClient; secret: string }

/** What the PIN step and the admin step each ask for, and the call that sends it. */
const SECRET_STEPS = {
  [STEPS.pin]: {
    prompt: SIGN_IN_COPY.pinPrompt,
    label: SIGN_IN_COPY.pin,
    isNumeric: true,
    unlock: ({ api, secret }: UnlockProps) => api.unlock(secret),
  },
  [STEPS.admin]: {
    prompt: SIGN_IN_COPY.adminPrompt,
    label: SIGN_IN_COPY.adminPassword,
    isNumeric: false,
    unlock: ({ api, secret }: UnlockProps) => api.unlockAdmin(secret),
  },
} as const satisfies Record<SecretStep['kind'], unknown>

/** While the admin lock holds, the PIN opens nothing: locked libraries stay hidden. */
const isAdminLockHeld = async (api: ApiClient): Promise<boolean> => {
  const adminLock = await api.getAdminLock()
  return adminLock.state === ADMIN_LOCK_STATES.on && adminLock.available
}

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
  [STEPS.account]: AccountFormProps
  [STEPS.pin]: SecretFormProps
  [STEPS.admin]: SecretFormProps
  [STEPS.ticketsOff]: TicketsOffFormProps
}

const SIGN_IN_VIEWS = {
  [STEPS.account]: AccountForm,
  [STEPS.pin]: SecretForm,
  [STEPS.admin]: SecretForm,
  [STEPS.ticketsOff]: TicketsOffForm,
} as const satisfies ViewsOf<SignInViewProps>

type SignInViewOfProps = {
  step: Step
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
    case STEPS.account:
      return { key: STEPS.account, props: account }
    case STEPS.pin:
    case STEPS.admin:
      return { key: step.kind, props: { ...secret, step } }
    case STEPS.ticketsOff:
      return { key: STEPS.ticketsOff, props: ticketsOff }
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
  const [step, setStep] = useState<Step>(
    IS_SIGN_IN_BYPASSED ? { kind: STEPS.pin, server: RAVEN_SERVER } : { kind: STEPS.account },
  )
  const [email, setEmail] = useState(TEST_ACCOUNT?.email ?? '')
  const [password, setPassword] = useState(TEST_ACCOUNT?.password ?? '')
  const [secret, setSecret] = useState('')
  const { isBusy, error, setError, run } = useSubmit({ unreachable: SIGN_IN_COPY.unreachable })

  // From Settings, Home is under it in the stack: go back down to it rather than stack another.
  const goHome = () => router.dismissTo(APP_ROUTES.home)

  const askFor = (next: Step) => {
    setSecret('')
    setStep(next)
  }

  const finish = async (server: AppServer) => {
    const { servers, add, activate } = useActiveServer.getState()
    const isKnown = servers.some((known) => known.id === server.id)
    const added = isKnown ? ADD_OUTCOMES.added : add(server).kind
    if (added !== ADD_OUTCOMES.added) {
      setError(added === ADD_OUTCOMES.full ? SIGN_IN_COPY.full : SIGN_IN_COPY.notAdded)
      return
    }
    activate(server.id)
    const support = await ticketSupportOf({ api: apiFor(server) })
    if (support === TICKET_SUPPORT.off) {
      askFor({ kind: STEPS.ticketsOff })
      return
    }
    goHome()
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
      const lock = await apiFor(RAVEN_SERVER).getLock()
      if (lock.available && !lock.unlocked) {
        askFor({ kind: STEPS.pin, server: RAVEN_SERVER })
        return
      }
      await finish(RAVEN_SERVER)
    })
  }

  const submitSecret = ({ step: { kind, server }, text }: SubmitSecretProps) =>
    run(async () => {
      const api = apiFor(server)
      await SECRET_STEPS[kind].unlock({ api, secret: text })
      if (kind === STEPS.pin && (await isAdminLockHeld(api))) {
        askFor({ kind: STEPS.admin, server })
        return
      }
      await finish(server)
    })

  const signOut = () => {
    useAccountSession.getState().signOut()
    askFor({ kind: STEPS.account })
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
