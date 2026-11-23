import type { ServerId } from '@/contract'
import { SERVERS_CAP } from '@/serverList'

/** Why a new server's address will not do, whichever client asks. */
export const SERVER_CHECK_PROBLEMS = {
  address: 'address',
  listed: 'listed',
  full: 'full',
  unreachable: 'unreachable',
  tooOld: 'tooOld',
} as const

export type ServerCheckProblem = (typeof SERVER_CHECK_PROBLEMS)[keyof typeof SERVER_CHECK_PROBLEMS]

export const CHECK_OUTCOMES = { ready: 'ready', refused: 'refused' } as const

/** A new server's address read and its id confirmed, or why it will not do. */
export type ServerCheck =
  | { kind: typeof CHECK_OUTCOMES.ready; serverId: ServerId; origin: string }
  | { kind: typeof CHECK_OUTCOMES.refused; problem: ServerCheckProblem }

/** A server already on a client's list, by its address and its own id (null for one too old to say). */
type ListedServer = { origin: string; serverId: ServerId | null }

/** What a server's open `/api/health` said of its id, or null when it did not answer. */
type HealthId = { serverId: ServerId | null } | null

type CheckServerAtProps = {
  /** The new server's origin, as `serverOriginOf` read it. */
  origin: string
  /** Every server on the list, home among them. */
  servers: readonly ListedServer[]
  healthIdAt: (origin: string) => Promise<HealthId>
}

/**
 * Checks a new server's origin against the list and its own health answer: one already listed
 * (by its address or, once it answers, by its id), a full list (home takes no row, so the cap is
 * on the others), a server that does not answer and one too old to have an id are each refused
 * with why. Every client's list adds by it, after reading the address its own way.
 */
export const checkServerAt = async ({
  origin,
  servers,
  healthIdAt,
}: CheckServerAtProps): Promise<ServerCheck> => {
  const refused = (problem: ServerCheckProblem): ServerCheck => ({
    kind: CHECK_OUTCOMES.refused,
    problem,
  })
  if (servers.some((server) => server.origin === origin)) {
    return refused(SERVER_CHECK_PROBLEMS.listed)
  }
  if (servers.length > SERVERS_CAP) return refused(SERVER_CHECK_PROBLEMS.full)
  const health = await healthIdAt(origin)
  if (health === null) return refused(SERVER_CHECK_PROBLEMS.unreachable)
  const { serverId } = health
  if (serverId === null) return refused(SERVER_CHECK_PROBLEMS.tooOld)
  if (servers.some((server) => server.serverId === serverId)) {
    return refused(SERVER_CHECK_PROBLEMS.listed)
  }
  return { kind: CHECK_OUTCOMES.ready, serverId, origin }
}
