import type { AddressInfo } from 'node:net'
import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  AUTH_REFUSALS,
  type AuthRefusal,
  HTTP_METHODS,
  isMediaId,
  isSidecarTrackId,
  LOCKED_STATUS,
  MEDIA_TICKET_PARAM,
  toQueryString,
} from '@raven/core'
import type { ServerEntry } from '@/main/desktopConfig'
import { quietly } from '@/main/log/quietly'
import {
  type AccountTickets,
  TICKET_OUTCOMES,
  type TicketOutcome,
} from '@/main/servers/accountTickets'
import { API_PATHS, MEDIA_FILE_PATH, subtitlePathOf } from '@/main/servers/allowlist'
import { accountRefusalOf, readShort } from '@/main/servers/authRefusals'
import { loggable } from '@/main/servers/serverCalls'
import { HTTP_HEADERS } from '@/shared/httpHeaders'
import { HTTP_STATUSES } from '@/shared/httpStatuses'

/** The relay listens here alone, so nothing off this Mac can reach it. */
export const RELAY_HOST = '127.0.0.1'
/** Each load's secret: 32 random bytes, the capability its paths carry. */
export const RELAY_SECRET_BYTES = 32

const RELAY_METHODS = { get: HTTP_METHODS.get, head: HTTP_METHODS.head } as const
type RelayMethod = (typeof RELAY_METHODS)[keyof typeof RELAY_METHODS]

const isRelayMethod = (method: string | undefined): method is RelayMethod =>
  method === RELAY_METHODS.get || method === RELAY_METHODS.head

// 32 bytes in base64url without padding.
const SECRET_PATTERN = /^[A-Za-z0-9_-]{43}$/u

/** The `node:http` events the relay listens for. */
const STREAM_EVENTS = { close: 'close', drain: 'drain', error: 'error' } as const

/** The upstream headers mpv hears back; nothing else the server sends crosses the relay. */
const PASSED_HEADERS = [
  HTTP_HEADERS.contentType,
  HTTP_HEADERS.contentLength,
  HTTP_HEADERS.contentRange,
  HTTP_HEADERS.acceptRanges,
] as const

type RelayHandler = (request: IncomingMessage, response: ServerResponse) => void

/** The part of a `node:http` server the relay listens with. */
type LoopbackServer = {
  once: (event: typeof STREAM_EVENTS.error, listener: (error: Error) => void) => unknown
  on: (event: typeof STREAM_EVENTS.error, listener: (error: Error) => void) => unknown
  listen: (port: number, host: string, onListening: () => void) => unknown
  address: () => AddressInfo | string | null
}

/** Starts a server for the handler and answers the port it listens on. */
type RelayListen = (handler: RelayHandler) => Promise<{ port: number }>

/**
 * A listen on `RELAY_HOST`, on a port the system picks, over main's `node:http`. Once it listens,
 * a later error on the server is warned rather than thrown in main.
 */
export const listenOnLoopback =
  ({
    createServer,
    warn,
  }: {
    createServer: (handler: RelayHandler) => LoopbackServer
    warn: (message: string) => void
  }): RelayListen =>
  (handler) =>
    new Promise((resolve, reject) => {
      const server = createServer(handler)
      server.once(STREAM_EVENTS.error, reject)
      server.listen(0, RELAY_HOST, () => {
        const address = server.address()
        if (address === null || typeof address === 'string') {
          reject(new Error('The media relay is not listening on a port.'))
          return
        }
        server.on(STREAM_EVENTS.error, () =>
          quietly(warn)('the media relay hit an error on its socket'),
        )
        resolve({ port: address.port })
      })
    })

/**
 * Main's `net.fetch` for a relayed request: no cookie, no redirect followed, nothing cached.
 * The signal aborts the fetch and its body as mpv lets go of the request.
 */
export type UpstreamFetch = (input: {
  url: string
  method: RelayMethod
  headers: Record<string, string>
  signal: AbortSignal
}) => Promise<{
  status: number
  headers: { get: (name: string) => string | null }
  body: ReadableStream<Uint8Array> | null
}>

type RelayedLoad = {
  loadId: string
  /** `http://127.0.0.1:<port>/<secret>`, which the player blanks in mpv's warnings. */
  base: string
  fileUrl: string
  /** In the order of the track ids given; an id that is not `external-N` is left out. */
  sidecarUrls: readonly string[]
}

export type MediaRelay = {
  /** Retires every earlier secret: the relay serves the newest load alone. */
  open: (input: {
    server: Pick<ServerEntry, 'id' | 'origin' | 'name'>
    mediaId: number
    sidecarTrackIds: readonly string[]
  }) => Promise<RelayedLoad>
  close: (loadId: string) => void
  closeServer: (serverId: string) => void
  closeAll: () => void
  /**
   * Why the load's account was refused: the server's last `403` or `401` after a fresh ticket for
   * the file, unless the file has been served since, or signed out when its access ended in main
   * (`closeServer`).
   */
  refusalOf: (loadId: string) => AuthRefusal['reason'] | null
}

type Load = {
  loadId: string
  serverId: string
  origin: string
  name: string
  mediaId: number
  /** Each path mpv may ask for, to the path under `/api/media/<id>/` it stands for. */
  routes: ReadonlyMap<string, string>
}

type Request = { loadId: string; controller: AbortController }

type Upstream = Awaited<ReturnType<UpstreamFetch>>

const isSuccess = (status: number): boolean => status >= 200 && status < 300

const discard = async (upstream: Upstream): Promise<void> => {
  if (upstream.body === null) return
  await upstream.body.cancel().catch(() => undefined)
}

const statusForRefusal = (reason: AuthRefusal['reason']): number =>
  reason === AUTH_REFUSALS.signedOut ? HTTP_STATUSES.unauthorized : HTTP_STATUSES.forbidden

/** The status mpv hears for a ticket main could not mint. */
const statusForOutcome = (
  outcome: Exclude<TicketOutcome, { kind: typeof TICKET_OUTCOMES.ticket }>,
): number => {
  switch (outcome.kind) {
    case TICKET_OUTCOMES.refused:
      return statusForRefusal(outcome.reason)
    case TICKET_OUTCOMES.locked:
      return LOCKED_STATUS
    case TICKET_OUTCOMES.gone:
      return HTTP_STATUSES.notFound
    case TICKET_OUTCOMES.unreachable:
      return HTTP_STATUSES.badGateway
    default: {
      const unreachable: never = outcome
      return unreachable
    }
  }
}

const answer = ({ response, status }: { response: ServerResponse; status: number }): void => {
  if (response.headersSent || response.destroyed) {
    response.destroy()
    return
  }
  response.writeHead(status, { [HTTP_HEADERS.contentLength]: '0' })
  response.end()
}

/** Writes a chunk, waiting while the socket drains; a response that closes stops the wait. */
const writeChunk = ({
  response,
  chunk,
}: {
  response: ServerResponse
  chunk: Uint8Array
}): Promise<void> =>
  new Promise((resolve, reject) => {
    if (response.destroyed) {
      reject(new Error('The player let go of the request.'))
      return
    }
    if (response.write(chunk)) {
      resolve()
      return
    }
    const settle = () => {
      response.off(STREAM_EVENTS.drain, settle)
      response.off(STREAM_EVENTS.close, settle)
      resolve()
    }
    response.once(STREAM_EVENTS.drain, settle)
    response.once(STREAM_EVENTS.close, settle)
  })

const passedHeaders = (upstream: Upstream): Record<string, string> =>
  Object.fromEntries(
    PASSED_HEADERS.flatMap((name) => {
      const value = upstream.headers.get(name)
      return value === null ? [] : [[name, value]]
    }),
  )

/**
 * The loopback media relay: mpv opens `http://127.0.0.1:<port>/<secret>/file` (and its sidecars),
 * and each request it makes, every seek and reconnect, goes to the server with an account ticket
 * main holds and renews. No ticket, token or server address ever enters an mpv URL, header or log.
 * Only the newest load's paths are served, only to `GET` and `HEAD`; anything else is a 404 that
 * sends nothing upstream.
 */
export const createMediaRelay = ({
  listen,
  fetchUpstream,
  tickets,
  newSecret,
  warn,
}: {
  listen: RelayListen
  fetchUpstream: UpstreamFetch
  tickets: Pick<AccountTickets, 'ticketFor'>
  /** `RELAY_SECRET_BYTES` random bytes in base64url. */
  newSecret: (bytes: number) => string
  warn: (message: string) => void
}): MediaRelay => {
  let current: Load | null = null
  let refusal: { loadId: string; reason: AuthRefusal['reason'] } | null = null
  let requests: readonly Request[] = []
  let listening: Promise<{ port: number }> | null = null
  let opened = 0

  const safeWarn = quietly(warn)

  const retire = (isRetired: (load: Load) => boolean): void => {
    if (current === null || !isRetired(current)) return
    const { loadId } = current
    current = null
    const ending = requests.filter((request) => request.loadId === loadId)
    requests = requests.filter((request) => request.loadId !== loadId)
    ending.forEach((request) => request.controller.abort())
  }

  const isCurrent = (load: Load): boolean => (current?.loadId ?? null) === load.loadId

  /**
   * Every refusal is logged, but only the file's own is why the title ends: mpv plays on past a
   * sidecar it could not read, so a refused sidecar must not turn the end into an error.
   */
  const record = ({
    load,
    path,
    reason,
  }: {
    load: Load
    path: string
    reason: AuthRefusal['reason']
  }): void => {
    // A request of a load already retired answers late; the newer load's record stands.
    if (!isCurrent(load)) return
    if (path === MEDIA_FILE_PATH) refusal = { loadId: load.loadId, reason }
    safeWarn(`${loggable(load.name)} refused a relayed request: ${reason}`)
  }

  const ticketed = async ({
    load,
    path,
    method,
    headers,
    signal,
    isFresh,
  }: {
    load: Load
    path: string
    method: RelayMethod
    headers: Record<string, string>
    signal: AbortSignal
    isFresh: boolean
  }): Promise<
    | { kind: typeof TICKET_OUTCOMES.ticket; upstream: Upstream }
    | Exclude<TicketOutcome, { kind: typeof TICKET_OUTCOMES.ticket }>
  > => {
    const outcome = await tickets.ticketFor({
      serverId: load.serverId,
      mediaId: load.mediaId,
      isFresh,
    })
    if (outcome.kind !== TICKET_OUTCOMES.ticket) return outcome
    const query = toQueryString({ [MEDIA_TICKET_PARAM]: outcome.ticket })
    const upstream = await fetchUpstream({
      url: `${load.origin}${API_PATHS.media}/${load.mediaId}/${path}?${query}`,
      method,
      headers,
      signal,
    })
    return { kind: TICKET_OUTCOMES.ticket, upstream }
  }

  const relay = async ({
    load,
    path,
    method,
    range,
    response,
    signal,
  }: {
    load: Load
    path: string
    method: RelayMethod
    range: string | null
    response: ServerResponse
    signal: AbortSignal
  }): Promise<void> => {
    const headers: Record<string, string> = range === null ? {} : { [HTTP_HEADERS.range]: range }
    const request = { load, path, method, headers, signal }
    const first = await ticketed({ ...request, isFresh: false })
    // A ticket the server no longer takes (it restarted, or the clocks disagree) is minted once more.
    const outcome =
      first.kind === TICKET_OUTCOMES.ticket && first.upstream.status === HTTP_STATUSES.unauthorized
        ? await discard(first.upstream).then(() => ticketed({ ...request, isFresh: true }))
        : first
    if (outcome.kind !== TICKET_OUTCOMES.ticket) {
      if (outcome.kind === TICKET_OUTCOMES.refused) record({ load, path, reason: outcome.reason })
      answer({ response, status: statusForOutcome(outcome) })
      return
    }
    const { upstream } = outcome
    if (
      upstream.status === HTTP_STATUSES.unauthorized ||
      upstream.status === HTTP_STATUSES.forbidden
    ) {
      const body = await readShort(upstream.body)
      record({ load, path, reason: accountRefusalOf({ status: upstream.status, body }) })
      answer({ response, status: upstream.status })
      return
    }
    // The file served again after a refusal (the owner let the account back in): it plays on,
    // so its end is a plain one.
    if (path === MEDIA_FILE_PATH && isSuccess(upstream.status) && isCurrent(load)) {
      refusal = null
    }
    response.writeHead(upstream.status, passedHeaders(upstream))
    if (method === RELAY_METHODS.head || upstream.body === null) {
      await discard(upstream)
      response.end()
      return
    }
    await upstream.body.pipeTo(
      new WritableStream<Uint8Array>({ write: (chunk) => writeChunk({ response, chunk }) }),
      { signal },
    )
    response.end()
  }

  const serve = async ({
    request,
    response,
  }: {
    request: IncomingMessage
    response: ServerResponse
  }): Promise<void> => {
    const load = current
    const path = load?.routes.get(request.url ?? '') ?? null
    if (!isRelayMethod(request.method) || load === null || path === null) {
      answer({ response, status: HTTP_STATUSES.notFound })
      return
    }
    const entry: Request = { loadId: load.loadId, controller: new AbortController() }
    requests = [...requests, entry]
    response.once(STREAM_EVENTS.close, () => {
      entry.controller.abort()
      requests = requests.filter((known) => known !== entry)
    })
    try {
      await relay({
        load,
        path,
        method: request.method,
        range: request.headers.range ?? null,
        response,
        signal: entry.controller.signal,
      })
    } catch {
      if (!entry.controller.signal.aborted) {
        safeWarn(`the media relay could not reach ${loggable(load.name)}`)
      }
      answer({ response, status: HTTP_STATUSES.badGateway })
    }
  }

  const handler: RelayHandler = (request, response) => {
    serve({ request, response }).catch(() => {
      response.destroy()
    })
  }

  const portOf = (): Promise<{ port: number }> => {
    if (listening !== null) return listening
    const started = listen(handler).catch((error: unknown) => {
      listening = null
      throw error
    })
    listening = started
    return started
  }

  return {
    open: async ({ server, mediaId, sidecarTrackIds }) => {
      if (!isMediaId(mediaId)) throw new RangeError('The relay needs a media id.')
      const { port } = await portOf()
      const secret = newSecret(RELAY_SECRET_BYTES)
      if (!SECRET_PATTERN.test(secret)) throw new Error('The relay needs a random secret.')
      retire(() => true)
      opened += 1
      const loadId = String(opened)
      const sidecars = sidecarTrackIds.filter(isSidecarTrackId)
      const routes = new Map([
        [`/${secret}/${MEDIA_FILE_PATH}`, MEDIA_FILE_PATH],
        ...sidecars.map((id): [string, string] => [
          `/${secret}/${subtitlePathOf(id)}`,
          subtitlePathOf(id),
        ]),
      ])
      current = {
        loadId,
        serverId: server.id,
        origin: server.origin,
        name: server.name,
        mediaId,
        routes,
      }
      refusal = null
      const base = `http://${RELAY_HOST}:${port}/${secret}`
      return {
        loadId,
        base,
        fileUrl: `${base}/${MEDIA_FILE_PATH}`,
        sidecarUrls: sidecars.map((id) => `${base}/${subtitlePathOf(id)}`),
      }
    },
    close: (loadId) => retire((load) => load.loadId === loadId),
    // Access ends on a sign out, a removed server or a moved sign-in host: the title playing
    // stops at the end of what mpv holds, and that is read as an account to sign in to again.
    closeServer: (serverId) => {
      const ended = current
      if (ended === null || ended.serverId !== serverId) return
      retire((load) => load.loadId === ended.loadId)
      if ((refusal?.loadId ?? null) === ended.loadId) return
      refusal = { loadId: ended.loadId, reason: AUTH_REFUSALS.signedOut }
    },
    closeAll: () => retire(() => true),
    refusalOf: (loadId) => (refusal !== null && refusal.loadId === loadId ? refusal.reason : null),
  }
}
