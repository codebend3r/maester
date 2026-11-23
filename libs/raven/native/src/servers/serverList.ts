import {
  type AccountServer,
  type Infer,
  SERVERS_CAP,
  type ServerId,
  isNumber,
  isRecord,
  isServerId,
  isServerOrigin,
  isString,
  object,
} from '@raven/core'

/*
 * A server the app talks to: a name and an origin with a session of its own. The id is a uuid
 * (the server's own, or `RAVEN_SERVER`'s fixed one for home), which names its cookies in the
 * secure store, whose keys take only letters, digits, `.`, `-` and `_`, and its downloads.
 */
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

type AddServerProps = {
  servers: readonly AppServer[]
  server: AppServer
}

/**
 * The list with the server added: refused when it is malformed (an origin `serverOriginOf`
 * would not write so, an id that is no uuid), when its origin or id is already
 * listed, or when the list holds `SERVERS_CAP` already.
 */
export const addServer = ({ servers, server }: AddServerProps): AddOutcome => {
  if (!isAppServer(server)) return { kind: ADD_OUTCOMES.invalid }
  if (servers.some(({ id, origin }) => origin === server.origin || id === server.id)) {
    return { kind: ADD_OUTCOMES.taken }
  }
  if (servers.length >= SERVERS_CAP) return { kind: ADD_OUTCOMES.full }
  return { kind: ADD_OUTCOMES.added, servers: [...servers, server] }
}

/** One of the account's servers as the app lists it: under the server's own id, which its cookies and downloads are kept by. */
export const appServerOf = ({ serverId, name, origin, addedAt }: AccountServer): AppServer => ({
  id: serverId,
  name,
  origin,
  addedAt: Date.parse(addedAt) || 0,
})

/** Each server once: the first of a repeated id or origin. */
const eachOnce = <T extends Pick<AppServer, 'id' | 'origin'>>(servers: readonly T[]): T[] =>
  servers.filter(
    (entry, index, all) =>
      all.findIndex((known) => known.id === entry.id || known.origin === entry.origin) === index,
  )

type StoredServers = { servers: AppServer[]; activeId: string | null }

type WithHomeProps = { home: AppServer; servers: readonly AppServer[] }

/**
 * Home first, at the origin and name this build gives it, then the others in their order, each
 * once: one under home's id or at its origin is left out, and so is the second of a repeated id
 * or origin. Home takes no place of the account's `SERVERS_CAP`.
 */
export const withHome = ({ home, servers }: WithHomeProps): AppServer[] => [
  home,
  ...eachOnce(servers.filter(({ id, origin }) => id !== home.id && origin !== home.origin)).slice(
    0,
    SERVERS_CAP,
  ),
]

type ListedWithProps = WithHomeProps & {
  /** The server last in use, when one is known. */
  activeId: string | null
}

type Listed = { servers: AppServer[]; activeId: string }

/** The list with home first (`withHome`) and the server in use on it: the one last used while it is still listed, home otherwise. */
export const listedWith = ({ home, servers, activeId }: ListedWithProps): Listed => {
  const listed = withHome({ home, servers })
  return {
    servers: listed,
    activeId: listed.find(({ id }) => id === activeId)?.id ?? home.id,
  }
}

type PinServerIdOfProps = { server: AppServer; home: AppServer; homeServerId: ServerId | null }

/**
 * The id a pin on `server` keys on: the server's own, which is its list id for every server but
 * home, whose list id is the build's fixed one and whose own comes from its auth config. Null
 * while home's is not known, or for a home too old to say it, which no pin can name.
 */
export const pinServerIdOf = ({
  server,
  home,
  homeServerId,
}: PinServerIdOfProps): ServerId | null => (server.id === home.id ? homeServerId : server.id)

/**
 * What the app's storage held, read as untrusted: each well-formed server once (the first of
 * a repeated id or origin), no more than home and `SERVERS_CAP` others, and the active id only when it names
 * one of them.
 */
export const storedServersOf = (stored: unknown): StoredServers => {
  const entries = isRecord(stored) && Array.isArray(stored.servers) ? stored.servers : []
  const servers = eachOnce(entries.filter(isAppServer))
    .map(({ id, name, origin, addedAt }) => ({ id, name, origin, addedAt }))
    // Home and the account's `SERVERS_CAP` others.
    .slice(0, SERVERS_CAP + 1)
  const activeId = isRecord(stored) ? stored.activeId : null
  const isKnown = servers.some((server) => server.id === activeId)
  return { servers, activeId: isKnown && isString(activeId) ? activeId : null }
}
