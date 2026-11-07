import type { AddressInfo } from 'node:net'
import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  AUDIO_BITRATE_PARAM,
  type AudioBitrate,
  AUTH_REFUSALS,
  type AuthRefusal,
  isMediaId,
  isSidecarTrackId,
  LOCKED_STATUS,
  MEDIA_TICKET_PARAM,
  type StreamQuality,
  toQueryString,
} from '@raven/core'
import type { ServerEntry } from '@/main/desktopConfig'
import { quietly } from '@/main/log/quietly'
import {
  HLS_MASTER_PATH,
  HLS_PARTS,
  type HlsPart,
  hlsPartOf,
  masterRequestOf,
  type ServerRequest,
} from '@/main/servers/hlsRelay'
import {
  createHlsSessions,
  type HlsSessions,
  PLAYLIST_ANSWERS,
  SESSION_ANSWERS,
  type SessionFetched,
} from '@/main/servers/hlsSessions'
import type { OriginPicks } from '@/main/servers/originPicks'
import { type AccountTickets, TICKET_OUTCOMES } from '@/main/servers/accountTickets'
import {
  API_PATHS,
  MEDIA_FILE_PATH,
  MEDIA_TRANSCODE_PATH,
  subtitlePathOf,
} from '@/main/servers/allowlist'
import { accountRefusalOf, readShort } from '@/main/servers/authRefusals'
import {
  discard,
  type Fetched,
  isRelayMethod,
  RELAY_METHODS,
  type RelayMethod,
  type RelayRequest,
  type TicketFailure,
  type Upstream,
  type UpstreamFetch,
} from '@/main/servers/relayUpstream'
import { loggable } from '@/main/servers/serverCalls'
import type { Timers } from '@/main/stateStore'
import { HTTP_HEADERS } from '@/shared/httpHeaders'
import { HTTP_STATUSES, isSuccessStatus } from '@/shared/httpStatuses'

/** The relay listens here alone, so nothing off this Mac can reach it. */
export const RELAY_HOST = '127.0.0.1'
/** Each load's secret: 32 random bytes, the capability its paths carry. */
export const RELAY_SECRET_BYTES = 32
/**
 * How long a media origin has to answer a relayed request when the server's own address is left
 * to fall back on. A LAN origin off this network may take a minute to refuse a connection, so the
 * relay goes to the server's own address well inside mpv's 15 s read and the stall budget.
 */
export const ORIGIN_ANSWER_MS = 5000

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

type ListenOnLoopbackProps = {
  createServer: (handler: RelayHandler) => LoopbackServer
  warn: (message: string) => void
}

/**
 * A listen on `RELAY_HOST`, on a port the system picks, over main's `node:http`. Once it listens,
 * a later error on the server is warned rather than thrown in main.
 */
export const listenOnLoopback =
  ({ createServer, warn }: ListenOnLoopbackProps): RelayListen =>
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

type RelayedLoad = {
  loadId: string
  /** `http://127.0.0.1:<port>/<secret>`, which the player blanks in mpv's warnings. */
  base: string
  /** What mpv opens: `<base>/file`, or `<base>/hls/master.m3u8` for a transcode. */
  fileUrl: string
  /** In the order of the track ids given; an id that is not `external-N` is left out. */
  sidecarUrls: readonly string[]
}

/** What a load relays of the title. */
export const RELAYED_MEDIA_KINDS = { file: 'file', audio: 'audio', transcode: 'transcode' } as const

export type RelayedMedia =
  /** The file itself. */
  | { kind: typeof RELAYED_MEDIA_KINDS.file }
  /** A track's AAC transcode at this bitrate. */
  | { kind: typeof RELAYED_MEDIA_KINDS.audio; kbps: AudioBitrate }
  /** A video's HLS transcode at this size, as a viewer away from home is held to. */
  | { kind: typeof RELAYED_MEDIA_KINDS.transcode; quality: StreamQuality }

type OpenProps = {
  server: Pick<ServerEntry, 'id' | 'origin' | 'name'>
  /** Where the title's bytes are fetched from: the media origin picked, or the server's own address. */
  origin: string
  mediaId: number
  sidecarTrackIds: readonly string[]
  media: RelayedMedia
}

export type MediaRelay = {
  /** Retires the oldest secrets past its capacity: the relay serves the newest loads alone. */
  open: (input: OpenProps) => Promise<RelayedLoad>
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

const ROUTE_KINDS = { ticketed: 'ticketed', session: 'session' } as const

/**
 * What a path mpv asks for stands for. A ticketed route is a server path and the query it carries
 * beside an account ticket; a session route is a part of the HLS session the load's master opened,
 * asked for through the load's HLS sessions with that session's key. `isMedia` marks the title's
 * own bytes, the file or its transcode, whose refusal ends the title; a sidecar's does not.
 * `playlist` is set for an HLS playlist, which the load's HLS sessions rewrite before mpv reads it.
 */
type Route =
  | (ServerRequest & {
      kind: typeof ROUTE_KINDS.ticketed
      isMedia: boolean
      playlist: HlsSessions | null
    })
  | {
      kind: typeof ROUTE_KINDS.session
      part: HlsPart
      hls: HlsSessions
      isMedia: true
      playlist: HlsSessions | null
    }

type TicketedRoute = Extract<Route, { kind: typeof ROUTE_KINDS.ticketed }>

/** What a load is before its routes: what each of its requests is fetched by. */
type LoadBase = {
  loadId: string
  serverId: string
  /** Where requests go, the first that answers: the origin picked, then the server's own address. */
  origins: readonly string[]
  name: string
  mediaId: number
  /** `/<secret>/`, which every path of the load begins with. */
  prefix: string
  /** Aborted as the load retires, ending what it fetches of its own. */
  retired: AbortController
}

type Load = LoadBase & {
  /** Each path mpv may ask for besides an HLS session's, to what it stands for. */
  routes: ReadonlyMap<string, Route>
  /** A transcode's HLS sessions; null for a file. */
  hls: HlsSessions | null
}

type MediaRouteOfProps = {
  mediaId: number
  media: RelayedMedia
  /** The HLS sessions a transcode's master opens. */
  hlsFor: (master: ServerRequest) => HlsSessions
}

/** The title's own bytes, what mpv opens for them under the secret, and a transcode's HLS sessions. */
type MediaRoute = { path: string; route: TicketedRoute; hls: HlsSessions | null }

/** The title's own bytes: its file, a track's transcode, or a video's HLS master playlist. */
const mediaRouteOf = ({ mediaId, media, hlsFor }: MediaRouteOfProps): MediaRoute => {
  const under = `${API_PATHS.media}/${mediaId}`
  const route = { kind: ROUTE_KINDS.ticketed, isMedia: true } as const
  switch (media.kind) {
    case RELAYED_MEDIA_KINDS.file:
      return {
        path: MEDIA_FILE_PATH,
        route: { ...route, path: `${under}/${MEDIA_FILE_PATH}`, query: {}, playlist: null },
        hls: null,
      }
    case RELAYED_MEDIA_KINDS.audio:
      return {
        path: MEDIA_FILE_PATH,
        route: {
          ...route,
          path: `${under}/${MEDIA_TRANSCODE_PATH}`,
          query: { [AUDIO_BITRATE_PARAM]: String(media.kbps) },
          playlist: null,
        },
        hls: null,
      }
    case RELAYED_MEDIA_KINDS.transcode: {
      const master = masterRequestOf({ mediaId, quality: media.quality })
      const hls = hlsFor(master)
      return { path: HLS_MASTER_PATH, route: { ...route, ...master, playlist: hls }, hls }
    }
    default: {
      const unreachable: never = media
      return unreachable
    }
  }
}

type Request = { loadId: string; controller: AbortController }

const statusForRefusal = (reason: AuthRefusal['reason']): number =>
  reason === AUTH_REFUSALS.signedOut ? HTTP_STATUSES.unauthorized : HTTP_STATUSES.forbidden

/** The status mpv hears for a ticket main could not mint. */
const statusForOutcome = (outcome: TicketFailure): number => {
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

type AnswerProps = { response: ServerResponse; status: number }

const answer = ({ response, status }: AnswerProps): void => {
  if (response.headersSent || response.destroyed) {
    response.destroy()
    return
  }
  response.writeHead(status, { [HTTP_HEADERS.contentLength]: '0' })
  response.end()
}

type WriteChunkProps = {
  response: ServerResponse
  chunk: Uint8Array
}

/** Writes a chunk, waiting while the socket drains; a response that closes stops the wait. */
const writeChunk = ({ response, chunk }: WriteChunkProps): Promise<void> =>
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

type CreateMediaRelayProps = {
  listen: RelayListen
  fetchUpstream: UpstreamFetch
  tickets: Pick<AccountTickets, 'ticketFor'>
  /** `RELAY_SECRET_BYTES` random bytes in base64url. */
  newSecret: (bytes: number) => string
  /**
   * How many loads stay served at once, the oldest retiring as a newer one opens: one for a
   * video, two for music, whose next track mpv opens while the playing one still streams.
   */
  capacity: number
  /** Told when a media origin stops answering, so the next title probes again. */
  picks: Pick<OriginPicks, 'forget'>
  /** Times a media origin's answer (`ORIGIN_ANSWER_MS`). */
  timers: Timers
  warn: (message: string) => void
}

/** How many refusals are remembered: a load's is read after it retires, so they outlive it a while. */
const REFUSALS_KEPT = 8

/**
 * The loopback media relay: mpv opens `http://127.0.0.1:<port>/<secret>/file` (and its sidecars),
 * and each request it makes, every seek and reconnect, goes to the server with an account ticket
 * main holds and renews, on the media origin the load was opened with (the server's own address
 * when that one stops answering). No ticket, token or server address ever enters an mpv URL,
 * header or log.
 * A transcode is HLS instead: mpv opens `<secret>/hls/master.m3u8`, the relay asks the server's
 * master with a ticket, rewrites each playlist to names of its own, and asks the session's video
 * playlist, init and segments with the session's key, which stays in main like the ticket.
 * Only the newest loads' paths are served, only to `GET` and `HEAD`; anything else is a 404 that
 * sends nothing upstream.
 */
export const createMediaRelay = ({
  listen,
  fetchUpstream,
  tickets,
  newSecret,
  capacity,
  picks,
  timers,
  warn,
}: CreateMediaRelayProps): MediaRelay => {
  // Oldest first, never more than `capacity`.
  let loads: readonly Load[] = []
  let refusals: readonly { loadId: string; reason: AuthRefusal['reason'] }[] = []
  let requests: readonly Request[] = []
  let listening: Promise<{ port: number }> | null = null
  let opened = 0

  const safeWarn = quietly(warn)

  const retire = (isRetired: (load: Load) => boolean): void => {
    const retiring = loads.filter(isRetired)
    if (retiring.length === 0) return
    loads = loads.filter((load) => !isRetired(load))
    retiring.forEach((load) => load.retired.abort())
    const gone = new Set(retiring.map((load) => load.loadId))
    const ending = requests.filter((request) => gone.has(request.loadId))
    requests = requests.filter((request) => !gone.has(request.loadId))
    ending.forEach((request) => request.controller.abort())
  }

  const isCurrent = (load: LoadBase): boolean => loads.some((live) => live.loadId === load.loadId)

  type RememberProps = { loadId: string; reason: AuthRefusal['reason'] }

  const remember = ({ loadId, reason }: RememberProps): void => {
    refusals = [...refusals.filter((known) => known.loadId !== loadId), { loadId, reason }].slice(
      -REFUSALS_KEPT,
    )
  }
  const forget = (loadId: string): void => {
    refusals = refusals.filter((known) => known.loadId !== loadId)
  }

  type RecordProps = {
    load: LoadBase
    route: Route
    reason: AuthRefusal['reason']
  }

  /**
   * Every refusal is logged, but only the file's own is why the title ends: mpv plays on past a
   * sidecar it could not read, so a refused sidecar must not turn the end into an error.
   */
  const record = ({ load, route, reason }: RecordProps): void => {
    // A request of a load already retired answers late; the newer load's record stands.
    if (!isCurrent(load)) return
    if (route.isMedia) remember({ loadId: load.loadId, reason })
    safeWarn(`${loggable(load.name)} refused a relayed request: ${reason}`)
  }

  type FallBackProps = { load: LoadBase; origin: string }

  /**
   * The load goes on without an origin that did not answer, and the server's pick is let go of.
   * Requests that met it at once (the file and a sidecar) drop it once between them.
   */
  const fallBack = ({ load, origin }: FallBackProps): void => {
    const isLive = loads.some(
      (live) => live.loadId === load.loadId && live.origins.includes(origin),
    )
    if (!isLive) return
    loads = loads.map((live) =>
      live.loadId === load.loadId
        ? { ...live, origins: live.origins.filter((known) => known !== origin) }
        : live,
    )
    picks.forget(load.serverId)
    safeWarn(
      `${loggable(load.name)}'s media origin did not answer; the relay goes to its own address`,
    )
  }

  type FetchFromProps = Parameters<UpstreamFetch>[0] & { hasFallback: boolean }

  /** One upstream fetch, given `ORIGIN_ANSWER_MS` to answer when another origin is left to try. */
  const fetchFrom = async ({
    url,
    method,
    headers,
    signal,
    hasFallback,
  }: FetchFromProps): Promise<Upstream> => {
    if (!hasFallback) return fetchUpstream({ url, method, headers, signal })
    const late = new AbortController()
    const timer = timers.set({ run: () => late.abort(), ms: ORIGIN_ANSWER_MS })
    try {
      // The same signal ends the body, so only mpv letting go stops it once it has answered.
      return await fetchUpstream({
        url,
        method,
        headers,
        signal: AbortSignal.any([signal, late.signal]),
      })
    } finally {
      timers.clear(timer)
    }
  }

  type FetchFirstProps = RelayRequest & { load: LoadBase; origins: readonly string[] }

  /**
   * Fetches from the load's origins in turn: one that fails to answer, or answers too late, gives
   * way to the next, the server's own address last. A request mpv let go of tries no other.
   */
  const fetchFirst = async ({
    load,
    origins,
    path,
    method,
    headers,
    signal,
  }: FetchFirstProps): Promise<Upstream> => {
    const [origin, ...rest] = origins
    if (origin === undefined) throw new Error('The relay has no origin to fetch from.')
    const hasFallback = rest.length > 0
    try {
      return await fetchFrom({ url: `${origin}${path}`, method, headers, signal, hasFallback })
    } catch (error) {
      if (signal.aborted || !hasFallback) throw error
      fallBack({ load, origin })
      return fetchFirst({ load, origins: rest, path, method, headers, signal })
    }
  }

  /** The load's origins as they stand: an origin dropped since this request began is not tried. */
  const originsOf = (load: LoadBase): readonly string[] =>
    loads.find((live) => live.loadId === load.loadId)?.origins ?? load.origins

  type TicketedProps = Omit<RelayRequest, 'path'> & {
    load: LoadBase
    request: ServerRequest
    isFresh: boolean
  }

  const ticketed = async ({
    load,
    request,
    method,
    headers,
    signal,
    isFresh,
  }: TicketedProps): Promise<Fetched> => {
    const outcome = await tickets.ticketFor({
      serverId: load.serverId,
      mediaId: load.mediaId,
      isFresh,
    })
    if (outcome.kind !== TICKET_OUTCOMES.ticket) return outcome
    const query = toQueryString({ ...request.query, [MEDIA_TICKET_PARAM]: outcome.ticket })
    const upstream = await fetchFirst({
      load,
      origins: originsOf(load),
      path: `${request.path}?${query}`,
      method,
      headers,
      signal,
    })
    return { kind: TICKET_OUTCOMES.ticket, upstream }
  }

  type FetchTicketedProps = Omit<TicketedProps, 'isFresh'>

  /** A ticketed request; a ticket the server no longer takes (it restarted, or the clocks disagree) is minted once more. */
  const fetchTicketed = async (props: FetchTicketedProps): Promise<Fetched> => {
    const first = await ticketed({ ...props, isFresh: false })
    return first.kind === TICKET_OUTCOMES.ticket &&
      first.upstream.status === HTTP_STATUSES.unauthorized
      ? discard(first.upstream).then(() => ticketed({ ...props, isFresh: true }))
      : first
  }

  /**
   * The HLS sessions of a transcode load, asking through the load: its master with a ticket, its
   * parts from its origins as they stand.
   */
  const hlsFor =
    (load: LoadBase) =>
    (master: ServerRequest): HlsSessions =>
      createHlsSessions({
        mediaId: load.mediaId,
        name: load.name,
        fetchMaster: (signal) =>
          fetchTicketed({ load, request: master, method: RELAY_METHODS.get, headers: {}, signal }),
        fetchPath: (request) => fetchFirst({ load, origins: originsOf(load), ...request }),
        retired: load.retired.signal,
        warn: safeWarn,
      })

  type PassAnswerProps = {
    load: Load
    route: Route
    answered: Extract<SessionFetched, { kind: typeof SESSION_ANSWERS.answered }>
    method: RelayMethod
    response: ServerResponse
  }

  /** What the server answered a reopen in place of a session, passed on as it said. */
  const passAnswer = ({ load, route, answered, method, response }: PassAnswerProps): void => {
    const { status, type, text } = answered
    if (status === HTTP_STATUSES.unauthorized || status === HTTP_STATUSES.forbidden) {
      record({ load, route, reason: accountRefusalOf({ status, body: text }) })
      answer({ response, status })
      return
    }
    const typed: Record<string, string> = type === null ? {} : { [HTTP_HEADERS.contentType]: type }
    if (method === RELAY_METHODS.head || text === '') {
      response.writeHead(status, typed)
      response.end()
      return
    }
    const body = new TextEncoder().encode(text)
    response.writeHead(status, { ...typed, [HTTP_HEADERS.contentLength]: String(body.length) })
    response.end(body)
  }

  type RelayProps = {
    load: Load
    route: Route
    method: RelayMethod
    range: string | null
    response: ServerResponse
    signal: AbortSignal
  }

  const relay = async ({
    load,
    route,
    method,
    range,
    response,
    signal,
  }: RelayProps): Promise<void> => {
    // A playlist is read whole to be rewritten, so it is never asked for in part.
    const headers: Record<string, string> =
      range === null || route.playlist !== null ? {} : { [HTTP_HEADERS.range]: range }
    const outcome: SessionFetched =
      route.kind === ROUTE_KINDS.session
        ? await route.hls.fetchPart({ part: route.part, method, headers, signal })
        : await fetchTicketed({ load, request: route, method, headers, signal })
    if (outcome.kind === SESSION_ANSWERS.answered) {
      passAnswer({ load, route, answered: outcome, method, response })
      return
    }
    if (outcome.kind !== TICKET_OUTCOMES.ticket) {
      if (outcome.kind === TICKET_OUTCOMES.refused) record({ load, route, reason: outcome.reason })
      answer({ response, status: statusForOutcome(outcome) })
      return
    }
    const { upstream } = outcome
    if (
      upstream.status === HTTP_STATUSES.unauthorized ||
      upstream.status === HTTP_STATUSES.forbidden
    ) {
      const body = await readShort(upstream.body)
      record({ load, route, reason: accountRefusalOf({ status: upstream.status, body }) })
      answer({ response, status: upstream.status })
      return
    }
    /*
     * The file served again after a refusal (the owner let the account back in): it plays on,
     * so its end is a plain one.
     */
    if (route.isMedia && isSuccessStatus(upstream.status) && isCurrent(load)) {
      forget(load.loadId)
    }
    if (route.playlist !== null && isSuccessStatus(upstream.status)) {
      const playlist = await route.playlist.playlistOf({ upstream, method })
      if (playlist.kind === PLAYLIST_ANSWERS.refused) {
        answer({ response, status: HTTP_STATUSES.badGateway })
        return
      }
      response.writeHead(playlist.status, playlist.headers)
      if (playlist.body === null) {
        response.end()
        return
      }
      response.end(playlist.body)
      return
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

  type Served = { load: Load; route: Route }

  /** The load a path is under and the route it stands for, or null for a path no live load serves. */
  const servedOf = (url: string): Served | null => {
    const load = loads.find((live) => url.startsWith(live.prefix)) ?? null
    if (load === null) return null
    const fixed = load.routes.get(url)
    if (fixed !== undefined) return { load, route: fixed }
    const { hls } = load
    if (hls === null) return null
    const part = hlsPartOf(url.slice(load.prefix.length))
    if (part === null) return null
    return {
      load,
      route: {
        kind: ROUTE_KINDS.session,
        part,
        hls,
        isMedia: true,
        playlist: part.kind === HLS_PARTS.video ? hls : null,
      },
    }
  }

  type ServeProps = {
    request: IncomingMessage
    response: ServerResponse
  }

  const serve = async ({ request, response }: ServeProps): Promise<void> => {
    const served = servedOf(request.url ?? '')
    if (!isRelayMethod(request.method) || served === null) {
      answer({ response, status: HTTP_STATUSES.notFound })
      return
    }
    const { load, route } = served
    const entry: Request = { loadId: load.loadId, controller: new AbortController() }
    requests = [...requests, entry]
    response.once(STREAM_EVENTS.close, () => {
      entry.controller.abort()
      requests = requests.filter((known) => known !== entry)
    })
    try {
      await relay({
        load,
        route,
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
    open: async ({ server, origin, mediaId, sidecarTrackIds, media }) => {
      if (!isMediaId(mediaId)) throw new RangeError('The relay needs a media id.')
      const { port } = await portOf()
      const secret = newSecret(RELAY_SECRET_BYTES)
      if (!SECRET_PATTERN.test(secret)) throw new Error('The relay needs a random secret.')
      // Room for this load: the oldest go.
      const retiring = new Set(loads.slice(0, Math.max(0, loads.length - capacity + 1)))
      retire((load) => retiring.has(load))
      // A retired load's refusal was read by now, or never will be.
      refusals = refusals.filter((known) => loads.some((live) => live.loadId === known.loadId))
      opened += 1
      const loadId = String(opened)
      const sidecars = sidecarTrackIds.filter(isSidecarTrackId)
      const prefix = `/${secret}/`
      // The server's own address is the fallback, so a media origin that goes away mid-title is passed over.
      const origins = [...new Set([origin, server.origin])]
      const loadBase: LoadBase = {
        loadId,
        serverId: server.id,
        origins,
        name: server.name,
        mediaId,
        prefix,
        retired: new AbortController(),
      }
      const mediaRoute = mediaRouteOf({ mediaId, media, hlsFor: hlsFor(loadBase) })
      // mpv asks for `/file` for a file or a track's transcode; the relay knows which bytes it stands for.
      const routes = new Map<string, Route>([
        [`${prefix}${mediaRoute.path}`, mediaRoute.route],
        ...sidecars.map((id): [string, Route] => [
          `${prefix}${subtitlePathOf(id)}`,
          {
            kind: ROUTE_KINDS.ticketed,
            path: `${API_PATHS.media}/${mediaId}/${subtitlePathOf(id)}`,
            query: {},
            isMedia: false,
            playlist: null,
          },
        ]),
      ])
      loads = [...loads, { ...loadBase, routes, hls: mediaRoute.hls }]
      const base = `http://${RELAY_HOST}:${port}/${secret}`
      return {
        loadId,
        base,
        fileUrl: `${base}/${mediaRoute.path}`,
        sidecarUrls: sidecars.map((id) => `${base}/${subtitlePathOf(id)}`),
      }
    },
    close: (loadId) => retire((load) => load.loadId === loadId),
    /*
     * Access ends on a sign out, a removed server or a moved sign-in host: the title playing
     * stops at the end of what mpv holds, and that is read as an account to sign in to again.
     */
    closeServer: (serverId) => {
      const ended = loads.filter((load) => load.serverId === serverId)
      retire((load) => load.serverId === serverId)
      ended
        .filter((load) => !refusals.some((known) => known.loadId === load.loadId))
        .forEach((load) => remember({ loadId: load.loadId, reason: AUTH_REFUSALS.signedOut }))
    },
    closeAll: () => retire(() => true),
    refusalOf: (loadId) => refusals.find((known) => known.loadId === loadId)?.reason ?? null,
  }
}
