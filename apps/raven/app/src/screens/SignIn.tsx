import { ADMIN_LOCK_STATES, type ApiClient } from '@raven/core'
import { useRouter } from 'expo-router'
import { useState } from 'react'

import { Text } from '@/layouts/Text'
import { BUTTON_TONES, Field, Form, FormButton, useFormStyles } from '@/layouts'
import { useAccountSession } from '@/account/accountSession'
import { TEST_ACCOUNT } from '@/account/testAccount'
import { AUTH_OUTCOMES } from '@/account/supabaseAuth'
import { APP_ROUTES } from '@/routes'
import { useSubmit } from '@/screens/useSubmit'
import { IS_SIGN_IN_BYPASSED, RAVEN_SERVER } from '@/servers/ravenServer'
import { apiFor } from '@/servers/serverClient'
import { ADD_OUTCOMES, type AppServer } from '@/servers/serverList'
import { TICKET_SUPPORT, ticketSupportOf } from '@/servers/tickets'
import { useActiveServer } from '@/stores/activeServer'

/** The spec's words for a server without `RAVEN_MEDIA_SECRET`, which the app then plays from with its cookie. */
export const TICKETS_OFF =
  "This server can't hand out media tickets. Set RAVEN_MEDIA_SECRET on it to play in the app"

const COPY = {
  title: 'Sign in to raven',
  email: 'Email',
  password: 'Password',
  badAccount: 'Enter your email and password.',
  unreachable: "Couldn't reach raven. Check your connection and try again.",
  pin: 'PIN',
  pinPrompt: 'This server keeps some libraries behind a PIN.',
  adminPassword: 'Admin password',
  adminPrompt:
    "Locked libraries stay hidden on this device until the server's admin password is entered.",
  notAdded: "This server couldn't be added. Try its address again.",
  full: 'This device already keeps as many servers as it can.',
  signIn: 'Sign in',
  continue: 'Continue',
  unlock: 'Unlock',
  notNow: 'Not now',
  signOut: 'Sign out',
} as const

const STEPS = { account: 'account', pin: 'pin', admin: 'admin', ticketsOff: 'ticketsOff' } as const

/** A step that asks for a secret the server unlocks with. */
type SecretStep = { kind: typeof STEPS.pin | typeof STEPS.admin; server: AppServer }

type Step = { kind: typeof STEPS.account } | SecretStep | { kind: typeof STEPS.ticketsOff }

type UnlockProps = { api: ApiClient; secret: string }

/** What the PIN step and the admin step each ask for, and the call that sends it. */
const SECRET_STEPS = {
  [STEPS.pin]: {
    prompt: COPY.pinPrompt,
    label: COPY.pin,
    isNumeric: true,
    unlock: ({ api, secret }: UnlockProps) => api.unlock(secret),
  },
  [STEPS.admin]: {
    prompt: COPY.adminPrompt,
    label: COPY.adminPassword,
    isNumeric: false,
    unlock: ({ api, secret }: UnlockProps) => api.unlockAdmin(secret),
  },
} as const satisfies Record<SecretStep['kind'], unknown>

/** While the admin lock holds, the PIN opens nothing: locked libraries stay hidden. */
const isAdminLockHeld = async (api: ApiClient): Promise<boolean> => {
  const adminLock = await api.getAdminLock()
  return adminLock.state === ADMIN_LOCK_STATES.on && adminLock.available
}

/**
 * The first launch: the account's email and password (the web's Supabase sign-in, against the
 * one server the app talks to), then the PIN when the account may see locked libraries, then
 * the admin password when the admin lock would still hide them. An end to end build names an
 * accountless fixture in its bundle, so it begins at the PIN.
 */
export const SignIn = () => {
  const router = useRouter()
  const formStyles = useFormStyles()
  const [step, setStep] = useState<Step>(
    IS_SIGN_IN_BYPASSED ? { kind: STEPS.pin, server: RAVEN_SERVER } : { kind: STEPS.account },
  )
  const [email, setEmail] = useState(TEST_ACCOUNT?.email ?? '')
  const [password, setPassword] = useState(TEST_ACCOUNT?.password ?? '')
  const [secret, setSecret] = useState('')
  const { isBusy, error, setError, run } = useSubmit({ unreachable: COPY.unreachable })

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
      setError(added === ADD_OUTCOMES.full ? COPY.full : COPY.notAdded)
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
      setError(COPY.badAccount)
      return
    }
    run(async () => {
      const outcome = await useAccountSession.getState().signIn({
        email: trimmed,
        password: typedPassword,
      })
      if (outcome.kind === AUTH_OUTCOMES.unreachable) {
        setError(COPY.unreachable)
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

  type SubmitSecretProps = { step: SecretStep; text: string }

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

  const errorLine = error !== null && (
    <Text accessibilityLiveRegion="polite" style={formStyles.error}>
      {error}
    </Text>
  )

  switch (step.kind) {
    case STEPS.account:
      return (
        <Form title={COPY.title}>
          <Field
            isEmail
            isFirst={TEST_ACCOUNT === null}
            label={COPY.email}
            onChangeText={setEmail}
            onSubmit={({ text }) => setEmail(text)}
            value={email}
          />
          <Field
            isSecret
            label={COPY.password}
            onChangeText={setPassword}
            onSubmit={({ text }) => {
              setPassword(text)
              submitAccount({ typedPassword: text })
            }}
            value={password}
          />
          {errorLine}
          <FormButton
            isDisabled={isBusy}
            isFirst={TEST_ACCOUNT !== null}
            label={COPY.signIn}
            onPress={() => submitAccount()}
            tone={BUTTON_TONES.primary}
          />
        </Form>
      )
    case STEPS.pin:
    case STEPS.admin: {
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
            onSubmit={({ text }) => submitSecret({ step, text })}
            value={secret}
          />
          {errorLine}
          <FormButton
            isDisabled={isBusy}
            label={COPY.unlock}
            onPress={() => submitSecret({ step, text: secret })}
            tone={BUTTON_TONES.primary}
          />
          <FormButton
            isDisabled={isBusy}
            label={COPY.notNow}
            onPress={() => run(() => finish(step.server))}
            tone={BUTTON_TONES.quiet}
          />
          <FormButton
            isDisabled={isBusy}
            label={COPY.signOut}
            onPress={signOut}
            tone={BUTTON_TONES.ghost}
          />
        </Form>
      )
    }
    case STEPS.ticketsOff:
      return (
        <Form title={COPY.title}>
          <Text accessibilityLiveRegion="polite" style={formStyles.notice}>
            {TICKETS_OFF}
          </Text>
          <FormButton label={COPY.continue} onPress={goHome} tone={BUTTON_TONES.primary} />
        </Form>
      )
    default: {
      const unreachable: never = step
      return unreachable
    }
  }
}
