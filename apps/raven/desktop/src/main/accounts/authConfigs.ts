import { AUTH_CONFIG_STATES, isAuthConfig } from '@raven/core'
import {
  isSameSignIn,
  signInConfigOf,
  signInHostOf,
  type SignInConfig,
} from '@/main/accounts/authEndpoints'
import type { ConfigStore, ServerEntry } from '@/main/desktopConfig'
import { quietly } from '@/main/log/quietly'
import { parseJson } from '@/main/parseJson'
import { CALL_NAMES } from '@/main/servers/allowlist'
import { loggable, type ServerCalls } from '@/main/servers/serverCalls'
import { serverById } from '@/main/servers/serverList'
import { HTTP_STATUSES } from '@/shared/httpStatuses'
import { messageOf } from '@/shared/messageOf'

export const AUTH_STATES = {
  off: 'off',
  legacy: 'legacy',
  down: 'down',
  unavailable: 'unavailable',
  ready: 'ready',
  unreachable: 'unreachable',
} as const

/**
 * What a server's accounts are. `legacy` is a server older than accounts, `down` one whose
 * accounts are configured but down, and `unavailable` one whose sign-in raven player will not
 * follow: a move the person turned down, or endpoints it cannot use.
 */
export type AuthState =
  | { kind: typeof AUTH_STATES.off }
  | { kind: typeof AUTH_STATES.legacy }
  | { kind: typeof AUTH_STATES.down }
  | { kind: typeof AUTH_STATES.unavailable }
  | { kind: typeof AUTH_STATES.ready; signIn: SignInConfig }
  | { kind: typeof AUTH_STATES.unreachable }

/** How long a kept state answers before `stateOf` reads the server again behind it. */
export const AUTH_CONFIG_STALE_MS = 600_000

/** A refusal reads the server again only when it was not read this recently. */
export const RECHECK_AFTER_MS = 30_000

export type AuthConfigs = {
  /**
   * The kept state, read from the server when there is none or the server said it was down. One
   * kept longer than `AUTH_CONFIG_STALE_MS` is answered as it is and read again behind it.
   */
  stateOf: (serverId: string) => Promise<AuthState>
  /** The endpoints a server kept as ready answers with, synchronously; null for any other state. */
  readyOf: (serverId: string) => SignInConfig | null
  /**
   * Reads the server again because the person asked (a sign in, `refreshAccount`), so a sign-in
   * move they turned down is asked about once more.
   */
  reread: (serverId: string) => Promise<AuthState>
  /**
   * After a `401` or `503` from the server: reads it again unless it was read within
   * `RECHECK_AFTER_MS`, and never asks again about a move the person turned down.
   */
  recheck: (serverId: string) => Promise<AuthState>
  /**
   * Whether a server has accounts, synchronously: as last read when that was ready, off or
   * legacy, else as its pin says, so a server out of reach keeps the accounts it was seen with.
   */
  hasAccounts: (serverId: string) => boolean
}

export type AuthConfigsDeps = {
  /** Main's own calls, not the ones that add a Bearer, which ask this for the state. */
  calls: Pick<ServerCalls, 'call'>
  config: ConfigStore
  /** Whether to follow a server whose sign-in moved to `host`; only `true` is a yes. */
  confirm: (input: { serverName: string; host: string }) => Promise<unknown>
  /** Drops the server's kept sign-in, which belongs to the endpoints it is leaving. */
  forget: (serverId: string) => Promise<void>
  now: () => number
  warn: (message: string) => void
}

const UNREACHABLE: AuthState = { kind: AUTH_STATES.unreachable }
const UNAVAILABLE: AuthState = { kind: AUTH_STATES.unavailable }

/**
 * Each server's public auth config, read through main and kept in memory. The endpoints it
 * names are pinned in the server's entry the first time they are ready, and a later config
 * that differs never replaces the pin unless a person says yes in main's own sheet.
 */
export const createAuthConfigs = (deps: AuthConfigsDeps): AuthConfigs => {
  let kept: ReadonlyMap<string, AuthState> = new Map()
  // When each server's config was last read, unreachable or not.
  let readAt: ReadonlyMap<string, number> = new Map()
  let reading: ReadonlyMap<string, Promise<AuthState>> = new Map()
  // The moved endpoints the person said no to, which only their own ask raises again.
  let declined: ReadonlyMap<string, SignInConfig> = new Map()
  // Servers a person asked to read again, which a read already out honors when it reaches the question.
  let askingAgain: ReadonlySet<string> = new Set()

  const warn = quietly(deps.warn)

  const entryOf = (serverId: string): ServerEntry | null =>
    serverById({ config: deps.config.read(), serverId })

  const pin = ({ serverId, signIn }: { serverId: string; signIn: SignInConfig }): boolean => {
    try {
      deps.config.update((config) => ({
        ...config,
        servers: config.servers.map((server) =>
          server.id === serverId ? { ...server, signIn } : server,
        ),
      }))
      return true
    } catch (error) {
      warn(
        `raven player could not keep server ${serverId}'s sign-in: ${loggable(messageOf(error))}`,
      )
      return false
    }
  }

  const isFollowed = async ({
    server,
    next,
  }: {
    server: ServerEntry
    next: SignInConfig
  }): Promise<boolean> => {
    const host = signInHostOf(next)
    if (host === null) return false
    try {
      const answer = await deps.confirm({ serverName: server.name, host })
      return answer === true
    } catch (error) {
      warn(
        `raven player could not ask about server ${server.id}'s sign-in: ${loggable(messageOf(error))}`,
      )
      return false
    }
  }

  const dropOldSession = async (serverId: string): Promise<boolean> => {
    try {
      await deps.forget(serverId)
      return true
    } catch (error) {
      warn(
        `raven player could not clear server ${serverId}'s sign-in: ${loggable(messageOf(error))}`,
      )
      return false
    }
  }

  const stateForReady = async ({
    serverId,
    next,
  }: {
    serverId: string
    next: SignInConfig
  }): Promise<AuthState> => {
    // The call took a while: the server may have been removed, or pinned by another read.
    const server = entryOf(serverId)
    if (server === null) return UNREACHABLE
    const ready: AuthState = { kind: AUTH_STATES.ready, signIn: next }
    if (server.signIn === null) return pin({ serverId, signIn: next }) ? ready : UNAVAILABLE
    if (isSameSignIn({ a: server.signIn, b: next })) return ready
    const turnedDown = declined.get(serverId)
    const isTurnedDown = turnedDown !== undefined && isSameSignIn({ a: turnedDown, b: next })
    if (isTurnedDown && !askingAgain.has(serverId)) return UNAVAILABLE
    if (!(await isFollowed({ server, next }))) {
      warn(`raven player kept server ${serverId}'s sign-in on its old host`)
      declined = new Map([...declined, [serverId, next]])
      return UNAVAILABLE
    }
    declined = new Map([...declined].filter(([id]) => id !== serverId))
    if (!(await dropOldSession(serverId))) return UNAVAILABLE
    return pin({ serverId, signIn: next }) ? ready : UNAVAILABLE
  }

  const read = async (serverId: string): Promise<AuthState> => {
    if (entryOf(serverId) === null) return UNREACHABLE
    const reply = await deps.calls.call({ serverId, call: { name: CALL_NAMES.getAuthConfig } })
    if (!reply.ok) return UNREACHABLE
    if (reply.status === HTTP_STATUSES.notFound) return { kind: AUTH_STATES.legacy }
    if (reply.status !== HTTP_STATUSES.ok) return UNREACHABLE
    const parsed = parseJson(reply.body)
    if (!isAuthConfig(parsed)) return UNREACHABLE
    switch (parsed.state) {
      case AUTH_CONFIG_STATES.off:
        return { kind: AUTH_STATES.off }
      case AUTH_CONFIG_STATES.unavailable:
        return { kind: AUTH_STATES.down }
      case AUTH_CONFIG_STATES.ready: {
        const next = signInConfigOf(parsed)
        if (next === null) {
          warn(`server ${serverId} named sign-in settings raven player cannot use`)
          return UNAVAILABLE
        }
        return stateForReady({ serverId, next })
      }
      default: {
        const unreachable: never = parsed
        return unreachable
      }
    }
  }

  /** One read per server at a time: an ask made while one is out joins it. Never rejects. */
  const readShared = (serverId: string): Promise<AuthState> => {
    const out = reading.get(serverId)
    if (out !== undefined) return out
    const task = read(serverId)
      .catch((error: unknown) => {
        warn(
          `raven player could not read server ${serverId}'s accounts: ${loggable(messageOf(error))}`,
        )
        return UNREACHABLE
      })
      .then((state) => {
        reading = new Map([...reading].filter(([id]) => id !== serverId))
        askingAgain = new Set([...askingAgain].filter((id) => id !== serverId))
        readAt = new Map([...readAt, [serverId, deps.now()]])
        // A server nobody could reach is read again next time, not remembered as down.
        if (state.kind !== AUTH_STATES.unreachable) kept = new Map([...kept, [serverId, state]])
        return state
      })
    reading = new Map([...reading, [serverId, task]])
    return task
  }

  const ageOf = (serverId: string): number =>
    deps.now() - (readAt.get(serverId) ?? Number.NEGATIVE_INFINITY)

  const reread: AuthConfigs['reread'] = (serverId) => {
    askingAgain = new Set([...askingAgain, serverId])
    return readShared(serverId)
  }

  const recheck: AuthConfigs['recheck'] = async (serverId) => {
    if (entryOf(serverId) === null) return UNREACHABLE
    if (ageOf(serverId) < RECHECK_AFTER_MS) return kept.get(serverId) ?? UNREACHABLE
    return readShared(serverId)
  }

  const stateOf: AuthConfigs['stateOf'] = async (serverId) => {
    if (entryOf(serverId) === null) return UNREACHABLE
    const known = kept.get(serverId)
    // The server's own word that its accounts are down is an outage, so it is read again.
    if (known === undefined || known.kind === AUTH_STATES.down) return readShared(serverId)
    if (ageOf(serverId) >= AUTH_CONFIG_STALE_MS) {
      // readShared never rejects; the catch only keeps the promise from floating.
      readShared(serverId).catch(() => undefined)
    }
    return known
  }

  const readyOf: AuthConfigs['readyOf'] = (serverId) => {
    const known = kept.get(serverId)
    return known !== undefined && known.kind === AUTH_STATES.ready ? known.signIn : null
  }

  const hasAccounts: AuthConfigs['hasAccounts'] = (serverId) => {
    const known = kept.get(serverId)
    const isPinned = (entryOf(serverId)?.signIn ?? null) !== null
    if (known === undefined) return isPinned
    switch (known.kind) {
      case AUTH_STATES.ready:
        return true
      case AUTH_STATES.off:
      case AUTH_STATES.legacy:
        return false
      case AUTH_STATES.down:
      case AUTH_STATES.unavailable:
      case AUTH_STATES.unreachable:
        return isPinned
      default: {
        const unreachable: never = known
        return unreachable
      }
    }
  }

  return { stateOf, reread, recheck, readyOf, hasAccounts }
}
