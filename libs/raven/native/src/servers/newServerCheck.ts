import {
  CHECK_OUTCOMES,
  type FetchLike,
  ROUTES,
  SERVER_CHECK_PROBLEMS,
  type ServerCheck,
  type ServerId,
  checkServerAt,
  isServerHealth,
  serverOriginOf,
} from '@raven/core'
import { CONTENT_TYPES, HEADERS } from '@shared/http'

import { type AppServer, pinServerIdOf } from '@/servers/serverList'

type OpenReadProps = { url: string; fetch: FetchLike }

/** An open GET's JSON answer, or null when the server does not answer or sends no JSON. */
export const openRead = async ({ url, fetch }: OpenReadProps): Promise<unknown> => {
  try {
    const response = await fetch(url, { headers: { [HEADERS.accept]: CONTENT_TYPES.json } })
    return response.ok ? await response.json() : null
  } catch {
    return null
  }
}

type CheckNewServerProps = {
  address: string
  /** Every server on the list, home among them. */
  servers: readonly AppServer[]
  home: AppServer
  homeServerId: ServerId | null
  fetch: FetchLike
}

/**
 * Reads a typed address the way every client reads one (`serverOriginOf`), then checks it as
 * every client's list does (core's `checkServerAt`): against the list, each server by its own id
 * (`pinServerIdOf`, so a typed address of home is refused by home's id), and the server's open
 * `/api/health`.
 */
export const checkNewServer = async ({
  address,
  servers,
  home,
  homeServerId,
  fetch,
}: CheckNewServerProps): Promise<ServerCheck> => {
  const origin = serverOriginOf(address)
  if (origin === null) {
    return { kind: CHECK_OUTCOMES.refused, problem: SERVER_CHECK_PROBLEMS.address }
  }
  return checkServerAt({
    origin,
    servers: servers.map((server) => ({
      origin: server.origin,
      serverId: pinServerIdOf({ server, home, homeServerId }),
    })),
    healthIdAt: async (at) => {
      const health = await openRead({ url: `${at}${ROUTES.getServerHealth.path}`, fetch })
      return isServerHealth(health) ? { serverId: health.serverId ?? null } : null
    },
  })
}
