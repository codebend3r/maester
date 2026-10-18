import { type ApiClient, createApiClient, type FetchLike, type FetchResponse } from '@raven/core'
import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import type { DesktopClient } from '@/renderer/desktop/client'
import { useDesktop } from '@/renderer/stores/desktop'
import {
  DESKTOP_REPLIES,
  DESKTOP_REQUESTS,
  isServerMethod,
  type ServerView,
} from '@/shared/protocol'

/** A server call that never reached the server: main could not, or would not, make it. */
export class ServerUnreachable extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ServerUnreachable'
  }
}

const NOT_MADE = 'raven player does not make that call.'
const UNREADABLE = 'raven player could not read its own reply.'
const NO_SERVERS = 'raven player could not read its servers.'

const responseOf = ({ status, body }: { status: number; body: string }): FetchResponse => ({
  ok: status >= 200 && status <= 299,
  status,
  statusText: '',
  json: async () => {
    const parsed: unknown = JSON.parse(body)
    return parsed
  },
  text: async () => body,
})

/**
 * `fetch` for core's client, over main: the page has no network of its own, so each call
 * goes to main by server id, method and path, and main makes it only when it is one of the
 * calls it allows. The URL is the bare path, since the client's base URL is ''.
 */
export const bridgedFetch =
  ({ client, serverId }: { client: DesktopClient; serverId: string }): FetchLike =>
  async (url, init) => {
    const method = init?.method ?? 'GET'
    if (!isServerMethod(method)) throw new ServerUnreachable(NOT_MADE)
    // Every call is a path on the server itself, never another origin or a relative one.
    if (!url.startsWith('/') || url.startsWith('//')) throw new ServerUnreachable(NOT_MADE)
    const reply = await client.request({
      type: DESKTOP_REQUESTS.serverCall,
      serverId,
      method,
      path: url,
      body: init?.body ?? null,
    })
    if (reply.type === DESKTOP_REPLIES.serverReply) return responseOf(reply)
    if (
      reply.type === DESKTOP_REPLIES.serverUnreachable ||
      reply.type === DESKTOP_REPLIES.refused
    ) {
      throw new ServerUnreachable(reply.message)
    }
    throw new ServerUnreachable(UNREADABLE)
  }

/** The same typed calls the web makes, to one stored server. */
export const serverApiFor = ({
  client,
  serverId,
}: {
  client: DesktopClient
  serverId: string
}): ApiClient => createApiClient({ fetch: bridgedFetch({ client, serverId }) })

export const SERVERS_KEY = ['desktop', 'servers'] as const

/** The servers raven player keeps, as Settings shows them. */
export const useServers = (): UseQueryResult<ServerView[]> => {
  const { client } = useDesktop()
  return useQuery({
    queryKey: SERVERS_KEY,
    queryFn: async () => {
      const reply = await client.request({ type: DESKTOP_REQUESTS.listServers })
      if (reply.type === DESKTOP_REPLIES.servers) return reply.servers
      throw new Error(reply.type === DESKTOP_REPLIES.refused ? reply.message : NO_SERVERS)
    },
    retry: false,
  })
}
