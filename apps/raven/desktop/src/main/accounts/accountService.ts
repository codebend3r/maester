import { AUTH_ROUTES, isAccount, MEMBER_STATUSES, type Account } from '@raven/core'
import {
  SIGN_IN_OUTCOMES,
  TOKEN_READS,
  type AccountSessions,
  type SignInOutcomeKind,
} from '@/main/accounts/accountSessions'
import { AUTH_STATES, type AuthConfigs, type AuthState } from '@/main/accounts/authConfigs'
import { signInHostOf } from '@/main/accounts/authEndpoints'
import type { ServerSignal } from '@/main/accounts/serverSignal'
import type { ConfigStore } from '@/main/desktopConfig'
import { quietly } from '@/main/log/quietly'
import { parseJson } from '@/main/parseJson'
import { CALL_NAMES } from '@/main/servers/allowlist'
import { loggable, type ServerCalls } from '@/main/servers/serverCalls'
import { serverById } from '@/main/servers/serverList'
import { HTTP_STATUSES } from '@/shared/httpStatuses'
import { messageOf } from '@/shared/messageOf'
import {
  ACCOUNT_PAGES,
  ACCOUNT_STATES,
  SERVER_GONE,
  type AccountPage,
  type AccountView,
} from '@/shared/protocol'

export const ACCOUNT_MESSAGES = {
  wrongPassword: 'Email or password is wrong.',
  unconfirmed: 'Confirm your email first. The link is in your inbox.',
  rateLimited: 'Wait a moment before trying again.',
  notOpen: 'That server is not taking sign ins right now.',
  noPage: 'That server has no page for this yet. Try again in a moment.',
  noBrowser: 'raven player could not open your browser.',
} as const

/** Said when the sign-in could not be reached or answered, naming the server the person chose. */
export const signInUnavailable = ({ name }: { name: string }): string =>
  `${name} could not sign you in right now. Try again.`

type SignInResult = { ok: true; account: AccountView } | { ok: false; message: string }

type OpenPageResult = { ok: true } | { ok: false; message: string }

export type AccountService = {
  read: (serverId: string) => Promise<AccountView>
  /** Reads the server's accounts config again first, then the account. */
  refresh: (serverId: string) => Promise<AccountView>
  signIn: (input: { serverId: string; email: string; password: string }) => Promise<SignInResult>
  signOut: (serverId: string) => Promise<AccountView>
  openPage: (input: { serverId: string; page: AccountPage }) => Promise<OpenPageResult>
  /** The server is no longer kept: its sign-in goes and its access ends. */
  removed: (serverId: string) => Promise<void>
  /** Reads the account again and emits it when it differs from what the page last had. */
  changed: (serverId: string) => Promise<void>
  /** A call to the server came back refused for good; see `Bearer.onRefusal`. */
  refused: (input: { serverId: string; isSessionRejected: boolean }) => Promise<void>
}

export type AccountServiceDeps = {
  authConfigs: Pick<AuthConfigs, 'stateOf' | 'reread' | 'recheck'>
  sessions: Pick<AccountSessions, 'signIn' | 'accessToken' | 'signOut' | 'forget' | 'accountIdOf'>
  /** Calls that carry the Bearer: `/api/me` is read through them. */
  calls: Pick<ServerCalls, 'call'>
  config: ConfigStore
  isRemembered: () => boolean
  openExternal: (url: string) => Promise<void>
  /** Told when a sign-in ends: whoever holds access on its behalf (the relay, the downloads) listens. */
  accessEnds: Pick<ServerSignal, 'notify'>
  /** Sends the page the new view of an account. */
  emit: (account: AccountView) => void
  info: (message: string) => void
  warn: (message: string) => void
  /**
   * The account signed in to a server changed: a sign out, a session the server rejected, or a
   * sign in as an account other than the one signed in. Called once the session has changed.
   */
  switched: ServerSignal['notify']
}

const stateOfAccount = (account: Account): AccountView['state'] => {
  switch (account.status) {
    case MEMBER_STATUSES.pending:
      return ACCOUNT_STATES.pending
    case MEMBER_STATUSES.revoked:
      return ACCOUNT_STATES.revoked
    case MEMBER_STATUSES.approved:
      return ACCOUNT_STATES.approved
    default: {
      const unreachable: never = account.status
      return unreachable
    }
  }
}

/** The path on the server's web origin that each account page lives at. */
const routeFor = (page: AccountPage): string => {
  switch (page) {
    case ACCOUNT_PAGES.signUp:
      return AUTH_ROUTES.signUp
    case ACCOUNT_PAGES.forgot:
      return AUTH_ROUTES.forgot
    default: {
      const unreachable: never = page
      return unreachable
    }
  }
}

const messageForOutcome = ({ kind, name }: { kind: SignInOutcomeKind; name: string }): string => {
  switch (kind) {
    case SIGN_IN_OUTCOMES.wrongPassword:
      return ACCOUNT_MESSAGES.wrongPassword
    case SIGN_IN_OUTCOMES.unconfirmed:
      return ACCOUNT_MESSAGES.unconfirmed
    case SIGN_IN_OUTCOMES.rateLimited:
      return ACCOUNT_MESSAGES.rateLimited
    case SIGN_IN_OUTCOMES.unavailable:
    case SIGN_IN_OUTCOMES.signedIn:
      return signInUnavailable({ name })
    default: {
      const unreachable: never = kind
      return unreachable
    }
  }
}

/**
 * The Bearer for a call: the access token of a server already kept as ready. It never reads the
 * server, so a call to a server without accounts, or one not read yet, goes out exactly as it
 * always did. The reads happen on sign in, on a refusal, on `readAccount` and `refreshAccount`.
 */
export const authorizeWith =
  ({
    authConfigs,
    sessions,
  }: {
    authConfigs: Pick<AuthConfigs, 'readyOf'>
    sessions: Pick<AccountSessions, 'accessToken'>
  }) =>
  async ({ serverId }: { serverId: string }): Promise<string | null> => {
    if (authConfigs.readyOf(serverId) === null) return null
    const read = await sessions.accessToken({ serverId })
    // An Auth out of reach leaves no token still valid to send, so the call goes without one.
    return read.kind === TOKEN_READS.token ? read.token : null
  }

/**
 * What the page may know of a server's account: a state, the email of the person signed in, and
 * the host the sign-in goes to. Never a token, a ticket, a key or the address behind the host.
 */
export const createAccountService = (deps: AccountServiceDeps): AccountService => {
  let seen: ReadonlyMap<string, string> = new Map()
  let handling: ReadonlySet<string> = new Set()

  const info = quietly(deps.info)
  const warn = quietly(deps.warn)

  const nameOf = (serverId: string): string =>
    loggable(serverById({ config: deps.config.read(), serverId })?.name ?? 'a server')

  /** A server still kept that has never been seen with accounts ready. */
  const isUnpinned = (serverId: string): boolean => {
    const server = serverById({ config: deps.config.read(), serverId })
    return server !== null && server.signIn === null
  }

  /** The signed in person's account as the server answers `/api/me` for it. */
  const readMe = async ({
    serverId,
    ready,
  }: {
    serverId: string
    ready: AccountView
  }): Promise<AccountView> => {
    const me = await deps.calls.call({ serverId, call: { name: CALL_NAMES.getMe } })
    if (!me.ok) return { ...ready, state: ACCOUNT_STATES.failed }
    if (me.status === HTTP_STATUSES.unauthorized) {
      return { ...ready, state: ACCOUNT_STATES.signedOut }
    }
    if (me.status !== HTTP_STATUSES.ok) return { ...ready, state: ACCOUNT_STATES.failed }
    const account = parseJson(me.body)
    if (!isAccount(account)) return { ...ready, state: ACCOUNT_STATES.failed }
    return {
      ...ready,
      state: stateOfAccount(account),
      email: account.email,
    }
  }

  /** The account as the page sees it, from `known` when the server was just read for it. */
  const compute = async ({
    serverId,
    known,
  }: {
    serverId: string
    known?: AuthState
  }): Promise<AccountView> => {
    const base: AccountView = {
      serverId,
      state: ACCOUNT_STATES.off,
      email: null,
      isRemembered: deps.isRemembered(),
      signInHost: null,
    }
    const state = known ?? (await deps.authConfigs.stateOf(serverId))
    switch (state.kind) {
      case AUTH_STATES.off:
      case AUTH_STATES.legacy:
        return base
      case AUTH_STATES.down:
      case AUTH_STATES.unavailable:
        return { ...base, state: ACCOUNT_STATES.unavailable }
      case AUTH_STATES.unreachable:
        // A server never pinned with accounts keeps today's path while it cannot be read (D1),
        // as main's own calls and loads do; only one whose pin says it has accounts failed.
        return isUnpinned(serverId) ? base : { ...base, state: ACCOUNT_STATES.failed }
      case AUTH_STATES.ready: {
        const ready = { ...base, signInHost: signInHostOf(state.signIn) }
        const token = await deps.sessions.accessToken({ serverId })
        switch (token.kind) {
          case TOKEN_READS.none:
            return { ...ready, state: ACCOUNT_STATES.signedOut }
          // Auth could not renew a token that ran out: an outage, not a sign out.
          case TOKEN_READS.unreachable:
            return { ...ready, state: ACCOUNT_STATES.failed }
          case TOKEN_READS.token:
            return readMe({ serverId, ready })
          default: {
            const unreachable: never = token
            return unreachable
          }
        }
      }
      default: {
        const unreachable: never = state
        return unreachable
      }
    }
  }

  /** Notes what the page now has; true when that is not what it had before. */
  const remember = (view: AccountView): boolean => {
    const key = JSON.stringify(view)
    const isChanged = seen.get(view.serverId) !== key
    seen = new Map([...seen, [view.serverId, key]])
    return isChanged
  }

  const show = async (input: { serverId: string; known?: AuthState }): Promise<AccountView> => {
    const view = await compute(input)
    remember(view)
    return view
  }

  const announce = async (input: { serverId: string; known?: AuthState }): Promise<void> => {
    const view = await compute(input)
    if (!remember(view)) return
    try {
      deps.emit(view)
    } catch (error) {
      warn(`raven player could not tell its window about an account: ${loggable(messageOf(error))}`)
    }
  }

  const changed: AccountService['changed'] = (serverId) => announce({ serverId })

  const refresh: AccountService['refresh'] = async (serverId) =>
    show({ serverId, known: await deps.authConfigs.reread(serverId) })

  const signIn: AccountService['signIn'] = async ({ serverId, email, password }) => {
    // Never a password to anything the server's own config has not just vouched for.
    const state = await deps.authConfigs.reread(serverId)
    // Read after the config: a yes to a moved sign-in host has just dropped the session it kept.
    const before = deps.sessions.accountIdOf({ serverId })
    if (state.kind === AUTH_STATES.unreachable) {
      return { ok: false, message: signInUnavailable({ name: nameOf(serverId) }) }
    }
    if (state.kind !== AUTH_STATES.ready) return { ok: false, message: ACCOUNT_MESSAGES.notOpen }
    const outcome = await deps.sessions.signIn({
      serverId,
      email,
      password,
      config: state.signIn,
    })
    if (outcome.kind !== SIGN_IN_OUTCOMES.signedIn) {
      info(`could not sign in to ${nameOf(serverId)}: ${outcome.kind}`)
      return {
        ok: false,
        message: messageForOutcome({ kind: outcome.kind, name: nameOf(serverId) }),
      }
    }
    info(`signed in to ${nameOf(serverId)}`)
    if (deps.sessions.accountIdOf({ serverId }) !== before) deps.switched({ serverId })
    return { ok: true, account: await show({ serverId, known: state }) }
  }

  const end = async (serverId: string): Promise<void> => {
    await deps.sessions.signOut(serverId)
    deps.accessEnds.notify({ serverId })
    deps.switched({ serverId })
    info(`signed out of ${nameOf(serverId)}`)
  }

  const signOut: AccountService['signOut'] = async (serverId) => {
    await end(serverId)
    return show({ serverId })
  }

  const removed: AccountService['removed'] = async (serverId) => {
    seen = new Map([...seen].filter(([id]) => id !== serverId))
    deps.accessEnds.notify({ serverId })
    await deps.sessions.forget(serverId)
  }

  const openPage: AccountService['openPage'] = async ({ serverId, page }) => {
    const server = serverById({ config: deps.config.read(), serverId })
    if (server === null) return { ok: false, message: SERVER_GONE }
    if (server.signIn === null) return { ok: false, message: ACCOUNT_MESSAGES.noPage }
    try {
      await deps.openExternal(`${server.signIn.webUrl}${routeFor(page)}`)
    } catch (error) {
      warn(
        `raven player could not open a page for ${nameOf(serverId)}: ${loggable(messageOf(error))}`,
      )
      return { ok: false, message: ACCOUNT_MESSAGES.noBrowser }
    }
    return { ok: true }
  }

  const refused: AccountService['refused'] = async ({ serverId, isSessionRejected }) => {
    // The reads below make calls of their own, which this refusal would answer with another.
    if (handling.has(serverId)) return
    handling = new Set([...handling, serverId])
    try {
      if (isSessionRejected) await end(serverId)
      await announce({ serverId, known: await deps.authConfigs.recheck(serverId) })
    } finally {
      handling = new Set([...handling].filter((id) => id !== serverId))
    }
  }

  return {
    read: (serverId) => show({ serverId }),
    refresh,
    signIn,
    signOut,
    openPage,
    removed,
    changed,
    refused,
  }
}
