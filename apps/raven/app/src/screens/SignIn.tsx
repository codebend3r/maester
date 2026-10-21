import {
  ACCOUNT_PAGES,
  ADMIN_LOCK_STATES,
  type AccountPage,
  type ApiClient,
  SIGN_IN_OUTCOMES,
  type SignInConfig,
  accountPageUrl,
  serverNameFor,
  serverOriginOf,
  signInHostOf,
  signInMessageOf,
} from '@raven/core'
import { useRouter } from 'expo-router'
import { useState } from 'react'
import { Linking, Text } from 'react-native'

import {
  BUTTON_TONES,
  Confirm,
  Field,
  Form,
  FormButton,
  FormSheet,
  WebPages,
  useFormStyles,
} from '@/layouts'
import { APP_ROUTES } from '@/routes'
import { useSubmit } from '@/screens/useSubmit'
import { AUTH_READS, type AuthRead, answerOf, isLetIn, readAuthConfig } from '@/servers/authConfigs'
import { accountSessions, apiFor, cookieJar, newServerId } from '@/servers/serverClient'
import { ADD_OUTCOMES, type AppServer } from '@/servers/serverList'
import { TICKET_SUPPORT, ticketSupportOf } from '@/servers/tickets'
import { useAccountAnswers } from '@/stores/accountAnswers'
import { useAccountState } from '@/stores/accountState'
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
  accountPrompt: 'This server signs in with raven accounts.',
  email: 'Email',
  password: 'Password',
  signIn: 'Sign in',
  createAccount: 'Create account',
  forgotPassword: 'Forgot password',
  webPages: (webUrl: string) =>
    `To create an account or reset your password, open ${webUrl} on a phone or computer.`,
  signsInWith: (host: string) => `Signs in with ${host}.`,
  noBrowser: "raven couldn't open your browser.",
} as const

const STEPS = {
  address: 'address',
  pin: 'pin',
  admin: 'admin',
  ticketsOff: 'ticketsOff',
  moved: 'moved',
  account: 'account',
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

/** The email and password for a server with accounts, pinned at `account`, which `server` carries. */
type AccountStep = { kind: typeof STEPS.account; server: AppServer; account: SignInConfig }

type Step =
  | { kind: typeof STEPS.address }
  | SecretStep
  | { kind: typeof STEPS.ticketsOff }
  | MovedStep
  | AccountStep

const ADDRESS_STEP: Step = { kind: STEPS.address }

const isListed = (server: AppServer): boolean =>
  useActiveServer.getState().servers.some((known) => known.id === server.id)

const isSignedIn = (server: AppServer): boolean =>
  useAccountState.getState().signedIn[server.id] === true

/**
 * Where sign-in opens: on the active server's account step when that server signs in with
 * accounts and nobody is signed in to it (its session ended, or the keychain could not be
 * read), and at the address otherwise.
 */
const openingStep = (): Step => {
  const { servers, activeId } = useActiveServer.getState()
  const active = servers.find((server) => server.id === activeId) ?? null
  if (active === null || active.account === null) return ADDRESS_STEP
  const answer = useAccountAnswers.getState().answers[active.id] ?? null
  if (isLetIn({ account: active.account, answer, isSignedIn: isSignedIn(active) })) {
    return ADDRESS_STEP
  }
  return { kind: STEPS.account, server: active, account: active.account }
}

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
 * first when a listed one's names other endpoints) and asks for the account's email and
 * password, which go only to the endpoints its config has just named again; it joins the list
 * once the account is signed in. No PIN or admin password is asked for there, as the desktop
 * asks none: the owner's PIN is asked for when a locked library answers 423.
 */
export const SignIn = () => {
  const router = useRouter()
  const formStyles = useFormStyles()
  const [step, setStep] = useState<Step>(openingStep)
  const [address, setAddress] = useState('')
  const [email, setEmail] = useState('')
  const [secret, setSecret] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const { isBusy, error, setError, run } = useSubmit({ unreachable: SIGN_IN_COPY.unreachable })

  // From Settings, Home is under it in the stack: go back down to it rather than stack another.
  const goHome = () => router.dismissTo(APP_ROUTES.home)

  const askFor = (next: Step) => {
    setSecret('')
    setStep(next)
  }

  /** Adds the server when it is new and makes it the active one; false when it could not be added. */
  const finish = async (server: AppServer): Promise<boolean> => {
    const { add, activate } = useActiveServer.getState()
    const added = isListed(server) ? ADD_OUTCOMES.added : add(server).kind
    if (added !== ADD_OUTCOMES.added) {
      setError(added === ADD_OUTCOMES.full ? SIGN_IN_COPY.full : SIGN_IN_COPY.notAdded)
      return false
    }
    activate(server.id)
    const support = await ticketSupportOf({ api: apiFor(server) })
    if (support === TICKET_SUPPORT.off) {
      askFor({ kind: STEPS.ticketsOff })
      return true
    }
    goHome()
    return true
  }

  const openLock = async ({ server, api }: { server: AppServer; api: ApiClient }) => {
    const lock = await api.getLock()
    if (lock.available && !lock.unlocked) {
      askFor({ kind: STEPS.pin, server })
      return
    }
    await finish(server)
  }

  /**
   * Keeps a listed server's sign-in pinned at `account` and asks for the account, or goes on
   * when it is signed in already; a server not listed joins the list only once it signs in.
   */
  const openAccount = async ({ server, account }: { server: AppServer; account: SignInConfig }) => {
    const pinned = { ...server, account }
    if (isListed(server)) useActiveServer.getState().pin({ id: server.id, account })
    if (isListed(server) && isSignedIn(server)) {
      await finish(pinned)
      return
    }
    askFor({ kind: STEPS.account, server: pinned, account })
  }

  /** Goes on as the server's auth config says: the PIN, the account, or a question first. */
  const follow = async ({
    server,
    api,
    read,
  }: {
    server: AppServer
    api: ApiClient
    read: AuthRead
  }) => {
    useAccountAnswers.getState().hear({ serverId: server.id, answer: answerOf(read) })
    switch (read.kind) {
      case AUTH_READS.accountless:
        await openLock({ server, api })
        return
      case AUTH_READS.pinned:
        await openAccount({ server, account: read.account })
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
      await follow({ server, api, read: await readAuthConfig({ api, server }) })
    })
  }

  /**
   * Only a yes pins the endpoints the server names now, and drops the session kept for the old
   * ones, as the desktop does; a no keeps the old pin and its session.
   */
  const answerMoved = ({
    step: { server, account, pinnedHost },
    isYes,
  }: {
    step: MovedStep
    isYes: boolean
  }) => {
    askFor(ADDRESS_STEP)
    if (!isYes) {
      setNotice(SIGN_IN_COPY.kept({ name: server.name, host: pinnedHost }))
      return
    }
    run(async () => {
      await accountSessions.forget({ serverId: server.id })
      await openAccount({ server, account })
    })
  }

  /**
   * Signs in to the account, once the server's config has named the same endpoints again: never
   * a password to anything it has not just vouched for. Anything else it says now goes on as an
   * address would. The password is cleared once Auth has answered, whatever it said.
   */
  const submitAccount = ({ step: { server }, password }: { step: AccountStep; password: string }) =>
    run(async () => {
      const api = apiFor(server)
      const read = await readAuthConfig({ api, server })
      if (read.kind !== AUTH_READS.pinned) {
        await follow({ server, api, read })
        return
      }
      const outcome = await accountSessions.signIn({
        server,
        account: read.account,
        email: email.trim(),
        password,
      })
      setSecret('')
      if (outcome !== SIGN_IN_OUTCOMES.signedIn) {
        setError(signInMessageOf({ kind: outcome, name: server.name }))
        return
      }
      if (!(await finish(server))) await accountSessions.forget({ serverId: server.id })
    })

  const openPage = ({ account, page }: { account: SignInConfig; page: AccountPage }) => {
    setError(null)
    Linking.openURL(accountPageUrl({ webUrl: account.webUrl, page })).catch(() =>
      setError(SIGN_IN_COPY.noBrowser),
    )
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
    askFor(ADDRESS_STEP)
    setError(null)
    // A server never added would otherwise keep its cookies with nothing left to forget them.
    if (!isListed(server)) cookieJar.forget(server.id).catch(() => undefined)
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
            onPress={() =>
              run(async () => {
                await finish(step.server)
              })
            }
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
    case STEPS.account: {
      const host = signInHostOf(step.account)
      return (
        <FormSheet onClose={() => startOver(step.server)}>
          <Form key={step.kind} title={step.server.name}>
            <Text style={formStyles.note}>{SIGN_IN_COPY.accountPrompt}</Text>
            <Field
              isEmail
              isFirst
              label={SIGN_IN_COPY.email}
              onChangeText={setEmail}
              onSubmit={({ text }) => setEmail(text)}
              value={email}
            />
            <Field
              isSecret
              label={SIGN_IN_COPY.password}
              onChangeText={setSecret}
              onSubmit={({ text }) => submitAccount({ step, password: text })}
              value={secret}
            />
            {errorLine}
            <FormButton
              isDisabled={isBusy}
              label={SIGN_IN_COPY.signIn}
              onPress={() => submitAccount({ step, password: secret })}
              tone={BUTTON_TONES.primary}
            />
            <WebPages
              note={SIGN_IN_COPY.webPages(step.account.webUrl)}
              pages={[
                {
                  label: SIGN_IN_COPY.createAccount,
                  onOpen: () => openPage({ account: step.account, page: ACCOUNT_PAGES.signUp }),
                },
                {
                  label: SIGN_IN_COPY.forgotPassword,
                  onOpen: () => openPage({ account: step.account, page: ACCOUNT_PAGES.forgot }),
                },
              ]}
            />
            <FormButton
              isDisabled={isBusy}
              label={SIGN_IN_COPY.otherAddress}
              onPress={() => startOver(step.server)}
              tone={BUTTON_TONES.ghost}
            />
            {host !== null && <Text style={formStyles.note}>{SIGN_IN_COPY.signsInWith(host)}</Text>}
          </Form>
        </FormSheet>
      )
    }
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
