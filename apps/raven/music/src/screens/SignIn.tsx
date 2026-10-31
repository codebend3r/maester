import { apiFor } from '@raven/native'
import {
  IS_SIGN_IN_BYPASSED,
  RAVEN_SERVER,
  SIGN_IN_STEPS,
  signInFlowFor,
} from '@raven/native/headless'
import { useRouter } from 'expo-router'

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

const useSignInFlow = signInFlowFor({
  account: useWrenAccount,
  servers: useActiveServer,
  apiOf: (server) => apiFor({ server, session: useWrenAccount }),
  server: RAVEN_SERVER,
  isBypassed: IS_SIGN_IN_BYPASSED,
})

/**
 * The first launch: the raven account's email and password, then the PIN when the account may
 * see locked libraries, then the admin password while the admin lock would still hide them, over
 * `@raven/native`'s `signInFlowFor`.
 */
export function SignIn() {
  const router = useRouter()
  const openTabs = () => router.replace(WREN_ROUTES.home)
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
    copy: COPY,
    initial: { email: '', password: '' },
    onDone: openTabs,
  })

  const errorLine = error !== null && <FormLine isError text={error} />

  switch (step.kind) {
    case SIGN_IN_STEPS.account:
      return (
        <Form note={COPY.note} title={COPY.title}>
          <Field
            isEmail
            label={COPY.email}
            onChangeText={setEmail}
            onSubmit={() => submitAccount()}
            value={email}
          />
          <Field
            isSecret
            label={COPY.password}
            onChangeText={setPassword}
            onSubmit={() => submitAccount()}
            value={password}
          />
          {errorLine}
          <FormButton
            isDisabled={isBusy}
            label={COPY.signIn}
            onPress={() => submitAccount()}
            tone={BUTTON_TONES.primary}
          />
        </Form>
      )
    case SIGN_IN_STEPS.pin:
    case SIGN_IN_STEPS.admin: {
      const { prompt, label, isNumeric } = secretSteps[step.kind]
      return (
        <Form key={step.kind} note={prompt} title={step.server.name}>
          <Field
            isNumeric={isNumeric}
            isSecret
            label={label}
            onChangeText={setSecret}
            onSubmit={() => submitSecret({ step, text: secret })}
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
            onPress={() => notNow(step)}
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
