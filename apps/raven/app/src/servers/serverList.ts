import {
  type Infer,
  SERVERS_CAP,
  type SignInConfig,
  isNumber,
  isRecord,
  isServerOrigin,
  isSignInConfig,
  isString,
  isSameSignIn,
  nullable,
  object,
  usableSignIn,
} from '@raven/core'

// What expo-crypto's `randomUUID` returns. The id names the server's cookie in the secure
// store, whose keys take only letters, digits, `.`, `-` and `_`.
const SERVER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

export const isServerId = (value: unknown): value is string =>
  isString(value) && SERVER_ID.test(value)

/** A server as it was kept before accounts: a name and an origin with a session of its own. */
const isServerEntry = object({
  id: isServerId,
  name: isString,
  origin: isServerOrigin,
  addedAt: isNumber,
})

/**
 * The sign-in a server with accounts was trusted with, kept as it was pinned: exactly the three
 * endpoints `usableSignIn` would write.
 */
const isAccountPin = (value: unknown): value is SignInConfig => {
  if (!isSignInConfig(value)) return false
  const usable = usableSignIn(value)
  return usable !== null && isSameSignIn({ a: usable, b: value })
}

/**
 * A server the app signs in to: the desktop's model, a name and an origin with a session of its
 * own, and `account`, the sign-in pinned the first time the server said its accounts were ready,
 * or null for a server never seen with accounts.
 */
const isAppServer = object({ ...isServerEntry.shape, account: nullable(isAccountPin) })

export type AppServer = Infer<typeof isAppServer>

export const ADD_OUTCOMES = {
  added: 'added',
  invalid: 'invalid',
  taken: 'taken',
  full: 'full',
} as const

export type AddOutcome =
  | { kind: typeof ADD_OUTCOMES.added; servers: AppServer[] }
  | { kind: typeof ADD_OUTCOMES.invalid }
  | { kind: typeof ADD_OUTCOMES.taken }
  | { kind: typeof ADD_OUTCOMES.full }

/**
 * The list with the server added: refused when it is malformed (an origin `serverOriginOf`
 * would not write so, an id `randomUUID` would not make), when its origin or id is already
 * listed, or when the list holds `SERVERS_CAP` already.
 */
export const addServer = ({
  servers,
  server,
}: {
  servers: readonly AppServer[]
  server: AppServer
}): AddOutcome => {
  if (!isAppServer(server)) return { kind: ADD_OUTCOMES.invalid }
  if (servers.some(({ id, origin }) => origin === server.origin || id === server.id)) {
    return { kind: ADD_OUTCOMES.taken }
  }
  if (servers.length >= SERVERS_CAP) return { kind: ADD_OUTCOMES.full }
  return { kind: ADD_OUTCOMES.added, servers: [...servers, server] }
}

export const removeServer = ({
  servers,
  id,
}: {
  servers: readonly AppServer[]
  id: string
}): AppServer[] => servers.filter((server) => server.id !== id)

/**
 * The list with the server's sign-in pinned as `account`, in place of any pin it had; null when
 * no server on the list has the id or the endpoints are not ones the app could sign in through.
 */
export const pinServer = ({
  servers,
  id,
  account,
}: {
  servers: readonly AppServer[]
  id: string
  account: SignInConfig
}): AppServer[] | null => {
  if (!isAccountPin(account) || !servers.some((server) => server.id === id)) return null
  return servers.map((server) => (server.id === id ? { ...server, account } : server))
}

type StoredServers = { servers: AppServer[]; activeId: string | null }

/** A stored pin read as untrusted: one the app could not sign in through, or none at all, is no pin. */
const storedPinOf = (entry: unknown): SignInConfig | null => {
  if (!isRecord(entry) || !isSignInConfig(entry.account)) return null
  const { supabaseUrl, publishableKey, webUrl } = entry.account
  const pin = { supabaseUrl, publishableKey, webUrl }
  return isAccountPin(pin) ? pin : null
}

/**
 * What the app's storage held, read as untrusted: each well-formed server once (the first of
 * a repeated id or origin), no more than `SERVERS_CAP`, each with its pin when the app could
 * still sign in through it, and the active id only when it names one of them.
 */
export const storedServersOf = (stored: unknown): StoredServers => {
  const entries = isRecord(stored) && Array.isArray(stored.servers) ? stored.servers : []
  const servers = entries
    .filter(isServerEntry)
    .filter(
      (entry, index, all) =>
        all.findIndex((known) => known.id === entry.id || known.origin === entry.origin) === index,
    )
    .map((entry) => {
      const { id, name, origin, addedAt } = entry
      return { id, name, origin, addedAt, account: storedPinOf(entry) }
    })
    .slice(0, SERVERS_CAP)
  const activeId = isRecord(stored) ? stored.activeId : null
  const isKnown = servers.some((server) => server.id === activeId)
  return { servers, activeId: isKnown && isString(activeId) ? activeId : null }
}
