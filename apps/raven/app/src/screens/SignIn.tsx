import {
  ADMIN_LOCK_STATES,
  type ApiClient,
  type SignInConfig,
  serverNameFor,
  serverOriginOf,
} from '@raven/core'
import { useRouter } from 'expo-router'
import { useState } from 'react'
import { Text } from 'react-native'

import { BUTTON_TONES, Confirm, Field, Form, FormButton, useFormStyles } from '@/layouts'
import { APP_ROUTES } from '@/routes'
import { useSubmit } from '@/screens/useSubmit'
import { AUTH_READS, answerOf, readAuthConfig } from '@/servers/authConfigs'
import { MEDIA_ACCESS_MESSAGES } from '@/servers/mediaAccess'
import { apiFor, cookieJar, newServerId } from '@/servers/serverClient'
import { ADD_OUTCOMES, type AppServer } from '@/servers/serverList'
import { TICKET_SUPPORT, ticketSupportOf } from '@/servers/tickets'
import { useAccountAnswers } from '@/stores/accountAnswers'
import { useActiveServer } from '@/stores/activeServer'

/** The spec's words for a server without `RAVEN_MEDIA_SECRET`, which the app then plays from with its cookie. */
export const TICKETS_OFF =
  "This server can't hand out media tickets. Set RAVEN_MEDIA_SECRET on it to play in the app"

export const SIGN_IN_COPY = {
  title: 'Sign in to raven',
  address: 'Server address',
  example: 'http://192.168.1.20:8484',
  badAddress: "Enter the server's address on its own, like http://192.168.1.20:8484",
  unreachable: "Couldn't reach a raven server there. Check the address and that raven is running.",
  pin: 'PIN',
  pinPrompt: 'This server keeps some libraries behind a PIN.',
  adminPassword: 'Admin password',
  adminPrompt:
    "Locked libraries stay hidden on this device until the server's admin password is entered.",
  notAdded: "This server couldn't be added. Try its address again.",
  full: 'This device already keeps as many servers as it can.',
  continue: 'Continue',
  unlock: 'Unlock',
  notNow: 'Not now',
  otherAddress: 'Use another address',
  cancel: 'Cancel',
  badSignIn: "That server's sign-in settings are not ones raven can use.",
  moved: ({ name, host }: { name: string; host: string }) =>
    `${name} now signs in through ${host}. Use it?`,
  movedDetail: 'Your password goes to that address when you sign in. Use it only if you trust it.',
  follow: 'Use it',
  kept: ({ name, host }: { name: string; host: string }) =>
    `${name} keeps signing in through ${host} on this device.`,
} as const

const STEPS = {
  address: 'address',
  pin: 'pin',
  admin: 'admin',
  ticketsOff: 'ticketsOff',
  moved: 'moved',
} as const

/** A step that asks for a secret the server unlocks with. */
type SecretStep = { kind: typeof STEPS.pin | typeof STEPS.admin; server: AppServer }

/** The question for a pinned server whose sign-in now names other endpoints, at `host`. */
type MovedStep = {
  kind: typeof STEPS.moved
  server: AppServer
  account: SignInConfig
  host: string
  pinnedHost: string
}

type Step =
  | { kind: typeof STEPS.address }
  | SecretStep
  | { kind: typeof STEPS.ticketsOff }
  | MovedStep

/** What the PIN step and the admin step each ask for, and the call that sends it. */
const SECRET_STEPS = {
  [STEPS.pin]: {
    prompt: SIGN_IN_COPY.pinPrompt,
    label: SIGN_IN_COPY.pin,
    isNumeric: true,
    unlock: ({ api, secret }: { api: ApiClient; secret: string }) => api.unlock(secret),
  },
  [STEPS.admin]: {
    prompt: SIGN_IN_COPY.adminPrompt,
    label: SIGN_IN_COPY.adminPassword,
    isNumeric: false,
    unlock: ({ api, secret }: { api: ApiClient; secret: string }) => api.unlockAdmin(secret),
  },
} as const satisfies Record<SecretStep['kind'], unknown>

/** While the admin lock holds, the PIN opens nothing: locked libraries stay hidden. */
const isAdminLockHeld = async (api: ApiClient): Promise<boolean> => {
  const adminLock = await api.getAdminLock()
  return adminLock.state === ADMIN_LOCK_STATES.on && adminLock.available
}

/**
 * The first launch: the server's address, then, once its auth config says it has no accounts,
 * its PIN when it has locked libraries, then the admin password when the admin lock would
 * still hide them, as the desktop asks. The server joins the list and becomes the active one
 * only once it has answered as raven. A server with accounts has its sign-in pinned (asking
 * first when a listed one's names other endpoints) and is told apart in plain words, since the
 * app cannot sign in to an account yet; it adds nothing, and no PIN or password is asked for.
 */
export const SignIn = () => {
  const router = useRouter()
  const formStyles = useFormStyles()
  const [step, setStep] = useState<Step>({ kind: STEPS.address })
  const [address, setAddress] = useState('')
  const [secret, setSecret] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
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

  const openLock = async ({ server, api }: { server: AppServer; api: ApiClient }) => {
    const lock = await api.getLock()
    if (lock.available && !lock.unlocked) {
      askFor({ kind: STEPS.pin, server })
      return
    }
    await finish(server)
  }

  /** Keeps a listed server's sign-in pinned at `account`; a server not listed is never added. */
  const keepAccount = ({ server, account }: { server: AppServer; account: SignInConfig }) => {
    const { servers, pin } = useActiveServer.getState()
    if (servers.some((known) => known.id === server.id)) pin({ id: server.id, account })
    setNotice(MEDIA_ACCESS_MESSAGES.account(server.name))
  }

  const submitAddress = ({ text }: { text: string }) => {
    setNotice(null)
    const origin = serverOriginOf(text)
    if (origin === null) {
      setError(SIGN_IN_COPY.badAddress)
      return
    }
    run(async () => {
      const known = useActiveServer.getState().servers.find((server) => server.origin === origin)
      const server = known ?? {
        id: newServerId(),
        name: serverNameFor(origin),
        origin,
        addedAt: Date.now(),
        account: null,
      }
      const api = apiFor(server)
      const read = await readAuthConfig({ api, server })
      useAccountAnswers.getState().hear({ serverId: server.id, answer: answerOf(read) })
      switch (read.kind) {
        case AUTH_READS.accountless:
          await openLock({ server, api })
          return
        case AUTH_READS.pinned:
          keepAccount({ server, account: read.account })
          return
        case AUTH_READS.moved: {
          const { account, host, pinnedHost } = read
          askFor({ kind: STEPS.moved, server, account, host, pinnedHost })
          return
        }
        case AUTH_READS.unusable:
          setError(SIGN_IN_COPY.badSignIn)
          return
        default: {
          const unreachable: never = read
          return unreachable
        }
      }
    })
  }

  /** Only a yes pins the endpoints the server names now; a no keeps the old pin. */
  const answerMoved = ({
    step: { server, account, pinnedHost },
    isYes,
  }: {
    step: MovedStep
    isYes: boolean
  }) => {
    askFor({ kind: STEPS.address })
    if (!isYes) {
      setNotice(SIGN_IN_COPY.kept({ name: server.name, host: pinnedHost }))
      return
    }
    keepAccount({ server, account })
  }

  const submitSecret = ({ step: { kind, server }, text }: { step: SecretStep; text: string }) =>
    run(async () => {
      const api = apiFor(server)
      await SECRET_STEPS[kind].unlock({ api, secret: text })
      if (kind === STEPS.pin && (await isAdminLockHeld(api))) {
        askFor({ kind: STEPS.admin, server })
        return
      }
      await finish(server)
    })

  const startOver = (server: AppServer) => {
    askFor({ kind: STEPS.address })
    setError(null)
    // A server never added would otherwise keep its cookies with nothing left to forget them.
    const isListed = useActiveServer.getState().servers.some((known) => known.id === server.id)
    if (!isListed) cookieJar.forget(server.id).catch(() => undefined)
  }

  const errorLine = error !== null && (
    <Text accessibilityLiveRegion="polite" style={formStyles.error}>
      {error}
    </Text>
  )

  switch (step.kind) {
    case STEPS.address:
      return (
        <Form title={SIGN_IN_COPY.title}>
          <Field
            isFirst
            label={SIGN_IN_COPY.address}
            onChangeText={setAddress}
            onSubmit={submitAddress}
            placeholder={SIGN_IN_COPY.example}
            value={address}
          />
          {notice !== null && (
            <Text accessibilityLiveRegion="polite" style={formStyles.notice}>
              {notice}
            </Text>
          )}
          {errorLine}
          <FormButton
            isDisabled={isBusy}
            label={SIGN_IN_COPY.continue}
            onPress={() => submitAddress({ text: address })}
            tone={BUTTON_TONES.primary}
          />
          {router.canGoBack() && (
            <FormButton
              label={SIGN_IN_COPY.cancel}
              onPress={() => router.back()}
              tone={BUTTON_TONES.ghost}
            />
          )}
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
            label={SIGN_IN_COPY.unlock}
            onPress={() => submitSecret({ step, text: secret })}
            tone={BUTTON_TONES.primary}
          />
          <FormButton
            isDisabled={isBusy}
            label={SIGN_IN_COPY.notNow}
            onPress={() => run(() => finish(step.server))}
            tone={BUTTON_TONES.quiet}
          />
          <FormButton
            isDisabled={isBusy}
            label={SIGN_IN_COPY.otherAddress}
            onPress={() => startOver(step.server)}
            tone={BUTTON_TONES.ghost}
          />
        </Form>
      )
    }
    case STEPS.moved:
      return (
        <Confirm
          detail={SIGN_IN_COPY.movedDetail}
          noLabel={SIGN_IN_COPY.cancel}
          onAnswer={({ isYes }) => answerMoved({ step, isYes })}
          question={SIGN_IN_COPY.moved({ name: step.server.name, host: step.host })}
          title={step.server.name}
          yesLabel={SIGN_IN_COPY.follow}
        />
      )
    case STEPS.ticketsOff:
      return (
        <Form title={SIGN_IN_COPY.title}>
          <Text accessibilityLiveRegion="polite" style={formStyles.notice}>
            {TICKETS_OFF}
          </Text>
          <FormButton label={SIGN_IN_COPY.continue} onPress={goHome} tone={BUTTON_TONES.primary} />
        </Form>
      )
    default: {
      const unreachable: never = step
      return unreachable
    }
  }
}
