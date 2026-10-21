import {
  type Infer,
  SERVERS_CAP,
  isNumber,
  isRecord,
  isServerOrigin,
  isString,
  object,
} from '@raven/core'

// What expo-crypto's `randomUUID` returns. The id names the server's cookie in the secure
// store, whose keys take only letters, digits, `.`, `-` and `_`.
const SERVER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

const isServerId = (value: unknown): value is string => isString(value) && SERVER_ID.test(value)

/** A server the app signs in to: the desktop's model, a name and an origin with a session of its own. */
const isAppServer = object({
  id: isServerId,
  name: isString,
  origin: isServerOrigin,
  addedAt: isNumber,
})

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

type StoredServers = { servers: AppServer[]; activeId: string | null }

/**
 * What the app's storage held, read as untrusted: each well-formed server once (the first of
 * a repeated id or origin), no more than `SERVERS_CAP`, and the active id only when it names
 * one of them.
 */
export const storedServersOf = (stored: unknown): StoredServers => {
  const entries = isRecord(stored) && Array.isArray(stored.servers) ? stored.servers : []
  const servers = entries
    .filter(isAppServer)
    .filter(
      (entry, index, all) =>
        all.findIndex((known) => known.id === entry.id || known.origin === entry.origin) === index,
    )
    .map(({ id, name, origin, addedAt }) => ({ id, name, origin, addedAt }))
    .slice(0, SERVERS_CAP)
  const activeId = isRecord(stored) ? stored.activeId : null
  const isKnown = servers.some((server) => server.id === activeId)
  return { servers, activeId: isKnown && isString(activeId) ? activeId : null }
}
