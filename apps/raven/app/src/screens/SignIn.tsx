import { ADMIN_LOCK_STATES, type ApiClient, serverNameFor, serverOriginOf } from '@raven/core'
import { useRouter } from 'expo-router'
import { useState } from 'react'
import { StyleSheet, Text } from 'react-native'

import { BUTTON_TONES, Field, Form, FormButton } from '@/layouts'
import { APP_ROUTES } from '@/routes'
import { useSubmit } from '@/screens/useSubmit'
import { apiFor, cookieJar, newServerId } from '@/servers/serverClient'
import { ADD_OUTCOMES, type AppServer } from '@/servers/serverList'
import { TICKET_SUPPORT, ticketSupportOf } from '@/servers/tickets'
import { useActiveServer } from '@/stores/activeServer'
import { COLOURS, SIZES } from '@/theme/appTheme'

/** The spec's words for a server without `RAVEN_MEDIA_SECRET`, which the app then plays from with its cookie. */
export const TICKETS_OFF =
  "This server can't hand out media tickets. Set RAVEN_MEDIA_SECRET on it to play in the app"

const COPY = {
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
} as const

const STEPS = { address: 'address', pin: 'pin', admin: 'admin', ticketsOff: 'ticketsOff' } as const

/** A step that asks for a secret the server unlocks with. */
type SecretStep = { kind: typeof STEPS.pin | typeof STEPS.admin; server: AppServer }

type Step = { kind: typeof STEPS.address } | SecretStep | { kind: typeof STEPS.ticketsOff }

/** What the PIN step and the admin step each ask for, and the call that sends it. */
const SECRET_STEPS = {
  [STEPS.pin]: {
    prompt: COPY.pinPrompt,
    label: COPY.pin,
    isNumeric: true,
    unlock: ({ api, secret }: { api: ApiClient; secret: string }) => api.unlock(secret),
  },
  [STEPS.admin]: {
    prompt: COPY.adminPrompt,
    label: COPY.adminPassword,
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
 * The first launch: the server's address, then its PIN when it has locked libraries, then
 * the admin password when the admin lock would still hide them, as the desktop asks. The
 * server joins the list and becomes the active one only once it has answered as raven.
 */
export const SignIn = () => {
  const router = useRouter()
  const [step, setStep] = useState<Step>({ kind: STEPS.address })
  const [address, setAddress] = useState('')
  const [secret, setSecret] = useState('')
  const { isBusy, error, setError, run } = useSubmit({ unreachable: COPY.unreachable })

  const goHome = () => router.replace(APP_ROUTES.home)

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

  const submitAddress = async () => {
    const origin = serverOriginOf(address)
    if (origin === null) {
      setError(COPY.badAddress)
      return
    }
    await run(async () => {
      const known = useActiveServer.getState().servers.find((server) => server.origin === origin)
      const server = known ?? {
        id: newServerId(),
        name: serverNameFor(origin),
        origin,
        addedAt: Date.now(),
      }
      const lock = await apiFor(server).getLock()
      if (lock.available && !lock.unlocked) {
        askFor({ kind: STEPS.pin, server })
        return
      }
      await finish(server)
    })
  }

  const submitSecret = async ({ kind, server }: SecretStep) =>
    run(async () => {
      const api = apiFor(server)
      await SECRET_STEPS[kind].unlock({ api, secret })
      if (kind === STEPS.pin && (await isAdminLockHeld(api))) {
        askFor({ kind: STEPS.admin, server })
        return
      }
      await finish(server)
    })

  const startOver = async (server: AppServer) => {
    askFor({ kind: STEPS.address })
    setError(null)
    // A server never added would otherwise keep its cookies with nothing left to forget them.
    const isListed = useActiveServer.getState().servers.some((known) => known.id === server.id)
    if (!isListed) await cookieJar.forget(server.id)
  }

  const errorLine = error !== null && (
    <Text accessibilityLiveRegion="polite" style={styles.error}>
      {error}
    </Text>
  )

  switch (step.kind) {
    case STEPS.address:
      return (
        <Form title={COPY.title}>
          <Field
            isFirst
            label={COPY.address}
            onChangeText={setAddress}
            onSubmit={() => void submitAddress()}
            placeholder={COPY.example}
            value={address}
          />
          {errorLine}
          <FormButton
            isDisabled={isBusy}
            label={COPY.continue}
            onPress={() => void submitAddress()}
            tone={BUTTON_TONES.primary}
          />
        </Form>
      )
    case STEPS.pin:
    case STEPS.admin: {
      const { prompt, label, isNumeric } = SECRET_STEPS[step.kind]
      return (
        <Form key={step.kind} title={step.server.name}>
          <Text style={styles.note}>{prompt}</Text>
          <Field
            isFirst
            isNumeric={isNumeric}
            isSecret
            label={label}
            onChangeText={setSecret}
            onSubmit={() => void submitSecret(step)}
            value={secret}
          />
          {errorLine}
          <FormButton
            isDisabled={isBusy}
            label={COPY.unlock}
            onPress={() => void submitSecret(step)}
            tone={BUTTON_TONES.primary}
          />
          <FormButton
            isDisabled={isBusy}
            label={COPY.notNow}
            onPress={() => void run(() => finish(step.server))}
            tone={BUTTON_TONES.quiet}
          />
          <FormButton
            isDisabled={isBusy}
            label={COPY.otherAddress}
            onPress={() => void startOver(step.server)}
            tone={BUTTON_TONES.ghost}
          />
        </Form>
      )
    }
    case STEPS.ticketsOff:
      return (
        <Form title={COPY.title}>
          <Text accessibilityLiveRegion="polite" style={styles.notice}>
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

const styles = StyleSheet.create({
  note: { color: COLOURS.muted, fontSize: SIZES.text },
  notice: { color: COLOURS.notice, fontSize: SIZES.textLg },
  error: { color: COLOURS.error, fontSize: SIZES.text },
})
