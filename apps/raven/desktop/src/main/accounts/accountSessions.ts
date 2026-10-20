import { AUTH_HEADERS } from '@raven/core'
import {
  type AuthError,
  AuthClient,
  isAuthApiError,
  isAuthRefreshDiscardedError,
  isAuthSessionMissingError,
  type Session,
} from '@supabase/auth-js'
import { isSameSignIn, type SignInConfig } from '@/main/accounts/authEndpoints'
import type { SessionStorage } from '@/main/accounts/sessionStore'
import { BOUNDED_OUTCOMES, within } from '@/main/bounded'
import type { Timers } from '@/main/stateStore'
import { HTTP_STATUSES } from '@/shared/httpStatuses'

/** Main's fetch for Auth: no cookie rides along and a redirect fails. */
export type AuthFetch = (input: { url: string; init: RequestInit }) => Promise<Response>

/** Where auth-js keeps a server's session in that server's storage. */
export const SESSION_STORAGE_KEY = 'raven-player-session'

/** A ticket is minted with a token that outlives it: five minutes and a margin. */
export const TICKET_MIN_VALIDITY_MS = 360_000

/**
 * How long a token read or a sign out waits on Auth. auth-js retries an unreachable refresh
 * for up to 30 s; past this, a still valid session is used as it is and the retry goes on alone.
 */
const AUTH_DEADLINE_MS = 5000

export const SIGN_IN_OUTCOMES = {
  signedIn: 'signedIn',
  wrongPassword: 'wrongPassword',
  unconfirmed: 'unconfirmed',
  rateLimited: 'rateLimited',
  unavailable: 'unavailable',
} as const

export type SignInOutcomeKind = (typeof SIGN_IN_OUTCOMES)[keyof typeof SIGN_IN_OUTCOMES]

type SignInOutcome = { kind: SignInOutcomeKind }

export const TOKEN_READS = {
  token: 'token',
  none: 'none',
  unreachable: 'unreachable',
} as const

/**
 * A server's access token, or why there is none: no session to take one from, or an Auth that
 * could not be reached to renew one that is no longer valid, which is an outage, not a sign out.
 */
export type TokenRead =
  | { kind: typeof TOKEN_READS.token; token: string }
  | { kind: typeof TOKEN_READS.none }
  | { kind: typeof TOKEN_READS.unreachable }

export type AccountSessions = {
  /** Signs in at exactly the endpoints given, the ones the caller has just read and vouched for. */
  signIn: (input: {
    serverId: string
    email: string
    password: string
    config: SignInConfig
  }) => Promise<SignInOutcome>
  accessToken: (input: { serverId: string; minValidityMs?: number }) => Promise<TokenRead>
  refresh: (serverId: string) => Promise<string | null>
  signOut: (serverId: string) => Promise<void>
  forget: (serverId: string) => Promise<void>
}

export const AUTH_ERROR_CODES = {
  invalidCredentials: 'invalid_credentials',
  refreshTokenNotFound: 'refresh_token_not_found',
  validationFailed: 'validation_failed',
  emailNotConfirmed: 'email_not_confirmed',
  overRequestRateLimit: 'over_request_rate_limit',
} as const

const SESSION_READS = {
  session: 'session',
  none: 'none',
  ended: 'ended',
  unreachable: 'unreachable',
} as const

/** `ended` is a session Auth refused to renew, which auth-js has already dropped. */
type SessionRead =
  | { kind: typeof SESSION_READS.session; session: Session }
  | { kind: typeof SESSION_READS.none }
  | { kind: typeof SESSION_READS.ended }
  | { kind: typeof SESSION_READS.unreachable }

const NO_TOKEN: TokenRead = { kind: TOKEN_READS.none }
const AUTH_UNREACHABLE: TokenRead = { kind: TOKEN_READS.unreachable }

const AUTH_PATH = '/auth/v1'
export const SIGN_OUT_SCOPES = { local: 'local' } as const
const MS_PER_SECOND = 1000
// auth-js keeps the session, the user and a PKCE verifier under these keys.
const STORAGE_KEYS = [
  SESSION_STORAGE_KEY,
  `${SESSION_STORAGE_KEY}-user`,
  `${SESSION_STORAGE_KEY}-code-verifier`,
] as const

type FetchInput = Parameters<typeof fetch>[0]

type Client = InstanceType<typeof AuthClient>

/** A client and the storage it writes through, which closes once main lets go of the client. */
type Held = { config: SignInConfig; client: Client; close: () => void }

const urlOf = (input: FetchInput): string => {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  return input.url
}

const outcomeOf = (error: AuthError | null): SignInOutcome['kind'] => {
  if (error === null || !isAuthApiError(error)) return SIGN_IN_OUTCOMES.unavailable
  switch (error.code) {
    case AUTH_ERROR_CODES.invalidCredentials:
    case AUTH_ERROR_CODES.validationFailed:
      return SIGN_IN_OUTCOMES.wrongPassword
    case AUTH_ERROR_CODES.emailNotConfirmed:
      return SIGN_IN_OUTCOMES.unconfirmed
    case AUTH_ERROR_CODES.overRequestRateLimit:
      return SIGN_IN_OUTCOMES.rateLimited
    default:
      return error.status === HTTP_STATUSES.tooManyRequests
        ? SIGN_IN_OUTCOMES.rateLimited
        : SIGN_IN_OUTCOMES.unavailable
  }
}

/** Auth refused the refresh token itself, as opposed to being out of reach. */
const isRefused = (error: unknown): boolean =>
  isAuthApiError(error) || isAuthSessionMissingError(error)

/**
 * The server's storage, until `close`: auth-js may still be refreshing when main signs out or
 * forgets the server, and that refresh must not write back the session main has just removed.
 */
const closable = (storage: SessionStorage): { storage: SessionStorage; close: () => void } => {
  const gate = { isOpen: true }
  return {
    storage: {
      getItem: (key) => (gate.isOpen ? storage.getItem(key) : Promise.resolve(null)),
      setItem: (key, value) => (gate.isOpen ? storage.setItem(key, value) : Promise.resolve()),
      removeItem: (key) => (gate.isOpen ? storage.removeItem(key) : Promise.resolve()),
    },
    close: () => {
      gate.isOpen = false
    },
  }
}

/**
 * One auth-js client per server, over that server's pinned endpoints and its own storage.
 * Tokens refresh lazily, when asked for, so a server nobody uses costs nothing. No token,
 * password or email ever reaches a warning.
 */
export const createAccountSessions = ({
  storageFor,
  configOf,
  fetch,
  now,
  timers,
  onEnded,
  warn,
}: {
  storageFor: (serverId: string) => SessionStorage
  configOf: (serverId: string) => SignInConfig | null
  fetch: AuthFetch
  now: () => number
  timers: Timers
  /** Auth refused a server's session, so it ended without a sign out and its access ends with it. */
  onEnded: (serverId: string) => void
  warn: (message: string) => void
}): AccountSessions => {
  let clients: ReadonlyMap<string, Held> = new Map()

  const ended = (serverId: string): void => {
    try {
      onEnded(serverId)
    } catch {
      warn(`raven player could not end the access held for server ${serverId}`)
    }
  }

  // auth-js types the option as the global fetch, whose Bun type has a `preconnect` it never calls.
  const authFetch = Object.assign(
    (input: FetchInput, init?: RequestInit) => fetch({ url: urlOf(input), init: init ?? {} }),
    { preconnect: () => undefined },
  )

  const drop = (serverId: string): void => {
    const known = clients.get(serverId)
    if (known !== undefined) known.close()
    clients = new Map([...clients].filter(([id]) => id !== serverId))
  }

  const clientFor = ({ serverId, config }: { serverId: string; config: SignInConfig }): Client => {
    const known = clients.get(serverId)
    if (known !== undefined && isSameSignIn({ a: known.config, b: config })) return known.client
    // The endpoints moved: the old client's late writes would land under the same key.
    drop(serverId)
    const { storage, close } = closable(storageFor(serverId))
    const client = new AuthClient({
      url: `${config.supabaseUrl}${AUTH_PATH}`,
      headers: { [AUTH_HEADERS.apiKey]: config.publishableKey },
      storage,
      storageKey: SESSION_STORAGE_KEY,
      persistSession: true,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      fetch: authFetch,
    })
    clients = new Map([...clients, [serverId, { config, client, close }]])
    return client
  }

  const clientOf = (serverId: string): Client | null => {
    const config = configOf(serverId)
    return config === null ? null : clientFor({ serverId, config })
  }

  const clearStorage = async (serverId: string): Promise<void> => {
    const storage = storageFor(serverId)
    await Promise.all(STORAGE_KEYS.map((key) => storage.removeItem(key)))
  }

  const withDeadline = <T>(task: Promise<T>) => within({ task, ms: AUTH_DEADLINE_MS, timers })

  const validForMs = (session: Session): number => (session.expires_at ?? 0) * MS_PER_SECOND - now()

  // auth-js refreshes here first when the token expires within its 90 s margin, and answers no
  // session with the error when that refresh fails and the stored token has run out.
  const currentSession = async (client: Client): Promise<SessionRead> => {
    const read = await withDeadline(client.getSession())
    if (read.outcome !== BOUNDED_OUTCOMES.answered) return { kind: SESSION_READS.unreachable }
    const { session } = read.result.data
    if (session !== null) return { kind: SESSION_READS.session, session }
    const { error } = read.result
    if (error === null) return { kind: SESSION_READS.none }
    return isRefused(error) ? { kind: SESSION_READS.ended } : { kind: SESSION_READS.unreachable }
  }

  const tokenOf = (session: Session): TokenRead => ({
    kind: TOKEN_READS.token,
    token: session.access_token,
  })

  const refreshed = async (
    client: Client,
  ): Promise<{ session: Session | null; error: unknown }> => {
    const read = await withDeadline(client.refreshSession())
    switch (read.outcome) {
      case BOUNDED_OUTCOMES.answered:
        return { session: read.result.data.session, error: read.result.error }
      case BOUNDED_OUTCOMES.late:
        return { session: null, error: null }
      case BOUNDED_OUTCOMES.failed:
        return { session: null, error: read.error }
      default: {
        const unreachable: never = read
        return unreachable
      }
    }
  }

  const signIn: AccountSessions['signIn'] = async ({ serverId, email, password, config }) => {
    try {
      const client = clientFor({ serverId, config })
      const { data, error } = await client.signInWithPassword({ email, password })
      if (error === null && data.session !== null) return { kind: SIGN_IN_OUTCOMES.signedIn }
      const kind = outcomeOf(error)
      if (kind === SIGN_IN_OUTCOMES.unavailable) {
        warn(`raven player could not reach the sign-in for server ${serverId}`)
      }
      return { kind }
    } catch {
      warn(`raven player could not reach the sign-in for server ${serverId}`)
      return { kind: SIGN_IN_OUTCOMES.unavailable }
    }
  }

  /** The session's token when it lives long enough, or a refreshed one when Auth answers. */
  const tokenLasting = async ({
    serverId,
    client,
    session,
    minValidityMs,
  }: {
    serverId: string
    client: Client
    session: Session
    minValidityMs: number | undefined
  }): Promise<TokenRead> => {
    if (minValidityMs === undefined || validForMs(session) >= minValidityMs) return tokenOf(session)
    const next = await refreshed(client)
    if (next.session !== null) return tokenOf(next.session)
    if (validForMs(session) > 0) return tokenOf(session)
    if (!isRefused(next.error)) return AUTH_UNREACHABLE
    ended(serverId)
    return NO_TOKEN
  }

  const accessToken: AccountSessions['accessToken'] = async ({ serverId, minValidityMs }) => {
    const client = clientOf(serverId)
    if (client === null) return NO_TOKEN
    const read = await currentSession(client)
    switch (read.kind) {
      case SESSION_READS.none:
        return NO_TOKEN
      case SESSION_READS.ended:
        ended(serverId)
        return NO_TOKEN
      case SESSION_READS.unreachable:
        return AUTH_UNREACHABLE
      case SESSION_READS.session:
        return tokenLasting({ serverId, client, session: read.session, minValidityMs })
      default: {
        const unreachable: never = read
        return unreachable
      }
    }
  }

  const refresh: AccountSessions['refresh'] = async (serverId) => {
    const client = clientOf(serverId)
    if (client === null) return null
    const next = await refreshed(client)
    if (next.session !== null) return next.session.access_token
    // Another refresh rotated the token while this one was out; its session stands.
    if (isAuthRefreshDiscardedError(next.error)) {
      const read = await currentSession(client)
      if (read.kind === SESSION_READS.ended) ended(serverId)
      return read.kind === SESSION_READS.session ? read.session.access_token : null
    }
    if (!isRefused(next.error)) return null
    await clearStorage(serverId)
    if (isAuthApiError(next.error)) {
      warn(`raven player's sign-in to server ${serverId} ended, so it is signed out`)
    }
    ended(serverId)
    return null
  }

  const signOut: AccountSessions['signOut'] = async (serverId) => {
    const client = clientOf(serverId)
    try {
      if (client !== null) {
        const read = await withDeadline(client.signOut({ scope: SIGN_OUT_SCOPES.local }))
        if (read.outcome !== BOUNDED_OUTCOMES.answered || read.result.error !== null) {
          warn(`raven player could not end its sign-in at server ${serverId}'s sign-in host`)
        }
      }
    } catch {
      warn(`raven player could not end its sign-in at server ${serverId}'s sign-in host`)
    } finally {
      drop(serverId)
      await clearStorage(serverId)
    }
  }

  const forget: AccountSessions['forget'] = async (serverId) => {
    drop(serverId)
    await clearStorage(serverId)
  }

  return { signIn, accessToken, refresh, signOut, forget }
}
