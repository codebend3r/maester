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
import { useRouter } from 'expo-router'
import { useState } from 'react'

import { BUTTON_TONES, Field, Form, FormButton, FormLine } from '@/components/Form'
import { WREN_ROUTES } from '@/routes'
import { useWrenAccount } from '@/session'
import { useActiveServer } from '@/stores/activeServer'

const COPY = {
  title: 'Wren',
  note: 'Sign in with your raven account to play your music.',
  email: 'Email',
  password: 'Password',
  badAccount: 'Enter your email and password.',
  unreachable: "Couldn't reach raven. Check your connection and try again.",
  pin: 'PIN',
  pinPrompt: 'This server keeps some libraries behind a PIN.',
  adminPassword: 'Admin password',
  adminPrompt:
    "Locked libraries stay hidden on this device until the server's admin password is entered.",
  ticketsOff:
    "This server can't hand out media tickets. Set RAVEN_MEDIA_SECRET on it to play in Wren.",
  notAdded: "raven couldn't be added. Try again.",
  full: 'This device already keeps as many servers as it can.',
  signIn: 'Sign in',
  continue: 'Continue',
  unlock: 'Unlock',
  notNow: 'Not now',
  signOut: 'Sign out',
} as const

/** What the PIN step and the admin step each ask for. */
const SECRET_STEPS = {
  [SIGN_IN_STEPS.pin]: { prompt: COPY.pinPrompt, label: COPY.pin, isNumeric: true },
  [SIGN_IN_STEPS.admin]: { prompt: COPY.adminPrompt, label: COPY.adminPassword, isNumeric: false },
} as const satisfies Record<SecretStep['kind'], unknown>

/**
 * The first launch: the raven account's email and password, then the PIN when the account may
 * see locked libraries, then the admin password while the admin lock would still hide them. An
 * end to end build names an accountless fixture in its bundle, so it begins at the PIN.
 */
export function SignIn() {
  const router = useRouter()
  const [step, setStep] = useState<SignInStep>(
    IS_SIGN_IN_BYPASSED
      ? { kind: SIGN_IN_STEPS.pin, server: RAVEN_SERVER }
      : { kind: SIGN_IN_STEPS.account },
  )
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [secret, setSecret] = useState('')
  const { isBusy, error, setError, run } = useSubmit({ unreachable: COPY.unreachable })

  const openTabs = () => router.replace(WREN_ROUTES.home)

  const askFor = (next: SignInStep) => {
    setSecret('')
    setStep(next)
  }

  const finish = async (server: AppServer) => {
    const outcome = await finishSignIn({
      servers: useActiveServer,
      server,
      api: apiFor({ server, session: useWrenAccount }),
    })
    switch (outcome) {
      case FINISH_OUTCOMES.done:
        openTabs()
        return
      case FINISH_OUTCOMES.ticketsOff:
        askFor({ kind: SIGN_IN_STEPS.ticketsOff })
        return
      case FINISH_OUTCOMES.full:
        setError(COPY.full)
        return
      case FINISH_OUTCOMES.notAdded:
        setError(COPY.notAdded)
        return
      default: {
        const unknown: never = outcome
        return unknown
      }
    }
  }

  const submitAccount = () => {
    const trimmed = email.trim()
    if (trimmed === '' || password === '') {
      setError(COPY.badAccount)
      return
    }
    run(async () => {
      const outcome = await useWrenAccount.getState().signIn({ email: trimmed, password })
      if (outcome.kind === AUTH_OUTCOMES.unreachable) {
        setError(COPY.unreachable)
        return
      }
      if (outcome.kind === AUTH_OUTCOMES.refused) {
        setError(outcome.message)
        return
      }
      setPassword('')
      const next = await stepAfterAccount({
        api: apiFor({ server: RAVEN_SERVER, session: useWrenAccount }),
        server: RAVEN_SERVER,
      })
      if (next !== null) {
        askFor(next)
        return
      }
      await finish(RAVEN_SERVER)
    })
  }

  const submitSecret = (secretStep: SecretStep) =>
    run(async () => {
      const { server } = secretStep
      const api = apiFor({ server, session: useWrenAccount })
      const next = await stepAfterSecret({ api, step: secretStep, secret })
      if (next !== null) {
        askFor(next)
        return
      }
      await finish(server)
    })

  const signOut = () => {
    useWrenAccount.getState().signOut()
    askFor({ kind: SIGN_IN_STEPS.account })
    setError(null)
  }

  const errorLine = error !== null && <FormLine isError text={error} />

  switch (step.kind) {
    case SIGN_IN_STEPS.account:
      return (
        <Form note={COPY.note} title={COPY.title}>
          <Field
            isEmail
            label={COPY.email}
            onChangeText={setEmail}
            onSubmit={submitAccount}
            value={email}
          />
          <Field
            isSecret
            label={COPY.password}
            onChangeText={setPassword}
            onSubmit={submitAccount}
            value={password}
          />
          {errorLine}
          <FormButton
            isDisabled={isBusy}
            label={COPY.signIn}
            onPress={submitAccount}
            tone={BUTTON_TONES.primary}
          />
        </Form>
      )
    case SIGN_IN_STEPS.pin:
    case SIGN_IN_STEPS.admin: {
      const { prompt, label, isNumeric } = SECRET_STEPS[step.kind]
      return (
        <Form key={step.kind} note={prompt} title={step.server.name}>
          <Field
            isNumeric={isNumeric}
            isSecret
            label={label}
            onChangeText={setSecret}
            onSubmit={() => submitSecret(step)}
            value={secret}
          />
          {errorLine}
          <FormButton
            isDisabled={isBusy}
            label={COPY.unlock}
            onPress={() => submitSecret(step)}
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
    case SIGN_IN_STEPS.ticketsOff:
      return (
        <Form title={COPY.title}>
          <FormLine text={COPY.ticketsOff} />
          <FormButton label={COPY.continue} onPress={openTabs} tone={BUTTON_TONES.primary} />
        </Form>
      )
    default: {
      const unreachable: never = step
      return unreachable
    }
  }
}
