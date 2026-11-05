import type { AddressInfo } from 'node:net'
import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  AUDIO_BITRATE_PARAM,
  type AudioBitrate,
  AUTH_REFUSALS,
  type AuthRefusal,
  HTTP_METHODS,
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
  type HlsSession,
  masterRequestOf,
  REWRITE_OUTCOMES,
  type RewrittenPlaylist,
  rewritePlaylist,
  sessionUrlOf,
} from '@/main/servers/hlsRelay'
import type { OriginPicks } from '@/main/servers/originPicks'
import {
  type AccountTickets,
  TICKET_OUTCOMES,
  type TicketOutcome,
} from '@/main/servers/accountTickets'
import {
  API_PATHS,
  MEDIA_FILE_PATH,
  MEDIA_TRANSCODE_PATH,
  subtitlePathOf,
} from '@/main/servers/allowlist'
import { accountRefusalOf, readShort } from '@/main/servers/authRefusals'
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

type UpstreamFetchProps = {
  url: string
  method: RelayMethod
  headers: Record<string, string>
  signal: AbortSignal
}

/**
 * Main's `net.fetch` for a relayed request: no cookie, no redirect followed, nothing cached.
 * The signal aborts the fetch and its body as mpv lets go of the request.
 */
export type UpstreamFetch = (input: UpstreamFetchProps) => Promise<{
  status: number
  headers: { get: (name: string) => string | null }
  body: ReadableStream<Uint8Array> | null
}>

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
 * asked for with that session's key. `isMedia` marks the title's own bytes, the file or its
 * transcode, whose refusal ends the title; a sidecar's does not. `isPlaylist` marks an HLS
 * playlist, which the relay rewrites before mpv reads it.
 */
type Route =
  | {
      kind: typeof ROUTE_KINDS.ticketed
      path: string
      query: Readonly<Record<string, string>>
      isMedia: boolean
      isPlaylist: boolean
    }
  | { kind: typeof ROUTE_KINDS.session; part: HlsPart; isMedia: true; isPlaylist: boolean }

type TicketedRoute = Extract<Route, { kind: typeof ROUTE_KINDS.ticketed }>

type Load = {
  loadId: string
  serverId: string
  /** Where requests go, the first that answers: the origin picked, then the server's own address. */
  origins: readonly string[]
  name: string
  mediaId: number
  /** `/<secret>/`, which every path of the load begins with. */
  prefix: string
  /** Each path mpv may ask for besides an HLS session's, to what it stands for. */
  routes: ReadonlyMap<string, Route>
  /** For a transcode, the master playlist and the session it opened last; null for a file. */
  hls: { master: TicketedRoute; session: HlsSession | null } | null
}

type MediaRouteOfProps = { mediaId: number; media: RelayedMedia }

/** The title's own bytes: its file, a track's transcode, or a video's HLS master playlist. */
const mediaRouteOf = ({ mediaId, media }: MediaRouteOfProps): TicketedRoute => {
  const under = `${API_PATHS.media}/${mediaId}`
  const route = { kind: ROUTE_KINDS.ticketed, isMedia: true } as const
  switch (media.kind) {
    case RELAYED_MEDIA_KINDS.file:
      return { ...route, path: `${under}/${MEDIA_FILE_PATH}`, query: {}, isPlaylist: false }
    case RELAYED_MEDIA_KINDS.audio:
      return {
        ...route,
        path: `${under}/${MEDIA_TRANSCODE_PATH}`,
        query: { [AUDIO_BITRATE_PARAM]: String(media.kbps) },
        isPlaylist: false,
      }
    case RELAYED_MEDIA_KINDS.transcode:
      return { ...route, ...masterRequestOf({ mediaId, quality: media.quality }), isPlaylist: true }
    default: {
      const unreachable: never = media
      return unreachable
    }
  }
}

/** What mpv opens under the secret for the title's own bytes. */
const mediaPathOf = (media: RelayedMedia): string =>
  media.kind === RELAYED_MEDIA_KINDS.transcode ? HLS_MASTER_PATH : MEDIA_FILE_PATH

/** The most of a playlist the relay reads: a VOD playlist of a long film is a few hundred KB. */
const PLAYLIST_MAX_BYTES = 8 * 1024 * 1024

type Request = { loadId: string; controller: AbortController }

type Upstream = Awaited<ReturnType<UpstreamFetch>>

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

type TicketFailure = Exclude<TicketOutcome, { kind: typeof TICKET_OUTCOMES.ticket }>

/** What the relay fetched for a request: the upstream's answer, or why no ticket was minted. */
type Fetched = { kind: typeof TICKET_OUTCOMES.ticket; upstream: Upstream } | TicketFailure

type ReadState = { text: string; bytes: number }

/** A playlist's text, read to its end; null past `PLAYLIST_MAX_BYTES` or when the read fails. */
const readPlaylistText = async (
  body: ReadableStream<Uint8Array> | null,
): Promise<string | null> => {
  if (body === null) return ''
  const reader = body.getReader()
  const decoder = new TextDecoder()
  const readFrom = async ({ text, bytes }: ReadState): Promise<string | null> => {
    const { done, value } = await reader.read()
    if (done) return `${text}${decoder.decode()}`
    const total = bytes + value.length
    if (total > PLAYLIST_MAX_BYTES) return null
    return readFrom({ text: `${text}${decoder.decode(value, { stream: true })}`, bytes: total })
  }
  try {
    return await readFrom({ text: '', bytes: 0 })
  } catch {
    return null
  } finally {
    await reader.cancel().catch(() => undefined)
  }
}

/** What reopening a load's HLS session came to: the session, or the answer mpv's request gets instead. */
const SESSION_STEPS = { session: 'session', failed: 'failed', answered: 'answered' } as const

type SessionStep =
  | { kind: typeof SESSION_STEPS.session; session: HlsSession }
  | { kind: typeof SESSION_STEPS.failed; outcome: TicketFailure }
  | { kind: typeof SESSION_STEPS.answered; status: number; text: string }

type FailedStep = Exclude<SessionStep, { kind: typeof SESSION_STEPS.session }>

/**
 * A step that is no session as a fetch of its own: a reopen is shared between the requests that
 * found the session lost, so each gets its own copy of the body read off the master.
 */
const fetchedOfStep = (step: FailedStep): Fetched => {
  switch (step.kind) {
    case SESSION_STEPS.failed:
      return step.outcome
    case SESSION_STEPS.answered: {
      const response = new Response(step.text === '' ? null : step.text)
      return {
        kind: TICKET_OUTCOMES.ticket,
        upstream: { status: step.status, headers: response.headers, body: response.body },
      }
    }
    default: {
      const unreachable: never = step
      return unreachable
    }
  }
}

/** A session the server forgot (it restarted, or let it go) answers 404, or 401 for its key. */
const isLostSession = (status: number): boolean =>
  status === HTTP_STATUSES.notFound || status === HTTP_STATUSES.unauthorized

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
    const gone = new Set(retiring.map((load) => load.loadId))
    const ending = requests.filter((request) => gone.has(request.loadId))
    requests = requests.filter((request) => !gone.has(request.loadId))
    ending.forEach((request) => request.controller.abort())
  }

  const isCurrent = (load: Load): boolean => loads.some((live) => live.loadId === load.loadId)

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
    load: Load
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

  type FallBackProps = { load: Load; origin: string }

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

  type FetchFromProps = {
    url: string
    method: RelayMethod
    headers: Record<string, string>
    signal: AbortSignal
    hasFallback: boolean
  }

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

  type FetchFirstProps = {
    load: Load
    origins: readonly string[]
    path: string
    method: RelayMethod
    headers: Record<string, string>
    signal: AbortSignal
  }

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
  const originsOf = (load: Load): readonly string[] =>
    loads.find((live) => live.loadId === load.loadId)?.origins ?? load.origins

  type TicketedProps = {
    load: Load
    route: TicketedRoute
    method: RelayMethod
    headers: Record<string, string>
    signal: AbortSignal
    isFresh: boolean
  }

  const ticketed = async ({
    load,
    route,
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
    const query = toQueryString({ ...route.query, [MEDIA_TICKET_PARAM]: outcome.ticket })
    const upstream = await fetchFirst({
      load,
      origins: originsOf(load),
      path: `${route.path}?${query}`,
      method,
      headers,
      signal,
    })
    return { kind: TICKET_OUTCOMES.ticket, upstream }
  }

  type FetchTicketedProps = Omit<TicketedProps, 'isFresh'>

  /** A ticketed request; a ticket the server no longer takes (it restarted, or the clocks disagree) is minted once more. */
  const fetchTicketed = async (request: FetchTicketedProps): Promise<Fetched> => {
    const first = await ticketed({ ...request, isFresh: false })
    return first.kind === TICKET_OUTCOMES.ticket &&
      first.upstream.status === HTTP_STATUSES.unauthorized
      ? discard(first.upstream).then(() => ticketed({ ...request, isFresh: true }))
      : first
  }

  type KeepSessionProps = { load: Load; session: HlsSession }

  const keepSession = ({ load, session }: KeepSessionProps): void => {
    loads = loads.map((live) =>
      live.loadId === load.loadId && live.hls !== null
        ? { ...live, hls: { ...live.hls, session } }
        : live,
    )
  }

  /** The load's HLS session as it stands: a reopen since this request began is the one it uses. */
  const sessionOf = (load: Load): HlsSession | null =>
    loads.find((live) => live.loadId === load.loadId)?.hls?.session ?? null

  type ReadPlaylistProps = { load: Load; upstream: Upstream }

  /** A playlist rewritten for mpv, keeping the session it names; null for one the relay does not pass on. */
  const readPlaylist = async ({
    load,
    upstream,
  }: ReadPlaylistProps): Promise<RewrittenPlaylist | null> => {
    const text = await readPlaylistText(upstream.body)
    if (text === null) return null
    const rewritten = rewritePlaylist({ text, mediaId: load.mediaId })
    if (rewritten.kind === REWRITE_OUTCOMES.refused) return null
    if (rewritten.session !== null && isCurrent(load)) {
      keepSession({ load, session: rewritten.session })
    }
    return rewritten
  }

  /** Each load's reopen in flight, so the requests that found its session lost share one. */
  let reopenings: ReadonlyMap<string, Promise<SessionStep>> = new Map()

  /**
   * Asks the load's master playlist again, with a ticket, for a new session to go on with. The
   * fetch is the load's own, so retiring the load ends it, but no one request's.
   */
  const reopen = async (load: Load): Promise<SessionStep> => {
    const master = load.hls?.master ?? null
    if (master === null) throw new Error('The relay has no master playlist for this load.')
    const entry: Request = { loadId: load.loadId, controller: new AbortController() }
    requests = [...requests, entry]
    try {
      const fetched = await fetchTicketed({
        load,
        route: master,
        method: RELAY_METHODS.get,
        headers: {},
        signal: entry.controller.signal,
      })
      if (fetched.kind !== TICKET_OUTCOMES.ticket) {
        return { kind: SESSION_STEPS.failed, outcome: fetched }
      }
      const { upstream } = fetched
      if (!isSuccessStatus(upstream.status)) {
        const text = await readShort(upstream.body)
        return { kind: SESSION_STEPS.answered, status: upstream.status, text }
      }
      const read = await readPlaylist({ load, upstream })
      if (read === null || read.session === null) {
        safeWarn(`${loggable(load.name)} sent a master playlist the relay does not pass on`)
        return { kind: SESSION_STEPS.answered, status: HTTP_STATUSES.badGateway, text: '' }
      }
      return { kind: SESSION_STEPS.session, session: read.session }
    } finally {
      requests = requests.filter((known) => known !== entry)
    }
  }

  type OpenSessionProps = { load: Load; lost: HlsSession | null }

  /** The session to ask: the load's own, unless it is the one found lost, else one reopened. */
  const openSession = ({ load, lost }: OpenSessionProps): Promise<SessionStep> => {
    const current = sessionOf(load)
    if (current !== null && current.id !== lost?.id) {
      return Promise.resolve({ kind: SESSION_STEPS.session, session: current })
    }
    const running = reopenings.get(load.loadId)
    if (running !== undefined) return running
    const step = reopen(load).finally(() => {
      reopenings = new Map([...reopenings].filter(([loadId]) => loadId !== load.loadId))
    })
    reopenings = new Map([...reopenings, [load.loadId, step]])
    return step
  }

  type SessionedProps = {
    load: Load
    part: HlsPart
    method: RelayMethod
    headers: Record<string, string>
    signal: AbortSignal
  }

  type FromSessionProps = SessionedProps & { session: HlsSession }

  const fromSession = async ({
    load,
    part,
    session,
    ...request
  }: FromSessionProps): Promise<Fetched> => ({
    kind: TICKET_OUTCOMES.ticket,
    upstream: await fetchFirst({
      load,
      origins: originsOf(load),
      path: sessionUrlOf({ mediaId: load.mediaId, session, part }),
      ...request,
    }),
  })

  /**
   * A part of the load's HLS session, with the session's key. A session the server no longer has
   * is opened again from the master once, and the part asked for in the new one: its segments are
   * cut the same way, so mpv goes on where it was.
   */
  const sessioned = async (request: SessionedProps): Promise<Fetched> => {
    const step = await openSession({ load: request.load, lost: null })
    if (step.kind !== SESSION_STEPS.session) return fetchedOfStep(step)
    const fetched = await fromSession({ ...request, session: step.session })
    if (fetched.kind !== TICKET_OUTCOMES.ticket || !isLostSession(fetched.upstream.status)) {
      return fetched
    }
    await discard(fetched.upstream)
    const again = await openSession({ load: request.load, lost: step.session })
    if (again.kind !== SESSION_STEPS.session) return fetchedOfStep(again)
    return fromSession({ ...request, session: again.session })
  }

  type AnswerPlaylistProps = {
    load: Load
    upstream: Upstream
    method: RelayMethod
    response: ServerResponse
  }

  /** A playlist goes to mpv whole and rewritten, never as the server wrote it. */
  const answerPlaylist = async ({
    load,
    upstream,
    method,
    response,
  }: AnswerPlaylistProps): Promise<void> => {
    const type = upstream.headers.get(HTTP_HEADERS.contentType)
    const typed: Record<string, string> = type === null ? {} : { [HTTP_HEADERS.contentType]: type }
    if (method === RELAY_METHODS.head) {
      await discard(upstream)
      response.writeHead(upstream.status, typed)
      response.end()
      return
    }
    const read = await readPlaylist({ load, upstream })
    if (read === null) {
      safeWarn(`${loggable(load.name)} sent a playlist the relay does not pass on`)
      answer({ response, status: HTTP_STATUSES.badGateway })
      return
    }
    const bytes = new TextEncoder().encode(read.text)
    response.writeHead(upstream.status, {
      ...typed,
      [HTTP_HEADERS.contentLength]: String(bytes.length),
    })
    response.end(bytes)
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
      range === null || route.isPlaylist ? {} : { [HTTP_HEADERS.range]: range }
    const outcome =
      route.kind === ROUTE_KINDS.session
        ? await sessioned({ load, part: route.part, method, headers, signal })
        : await fetchTicketed({ load, route, method, headers, signal })
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
    // The file served again after a refusal (the owner let the account back in): it plays on,
    // so its end is a plain one.
    if (route.isMedia && isSuccessStatus(upstream.status) && isCurrent(load)) {
      forget(load.loadId)
    }
    if (route.isPlaylist && isSuccessStatus(upstream.status)) {
      await answerPlaylist({ load, upstream, method, response })
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
    const part = load.hls === null ? null : hlsPartOf(url.slice(load.prefix.length))
    if (part === null) return null
    return {
      load,
      route: {
        kind: ROUTE_KINDS.session,
        part,
        isMedia: true,
        isPlaylist: part.kind === HLS_PARTS.video,
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
      const mediaRoute = mediaRouteOf({ mediaId, media })
      // mpv asks for `/file` for a file or a track's transcode; the relay knows which bytes it stands for.
      const routes = new Map<string, Route>([
        [`${prefix}${mediaPathOf(media)}`, mediaRoute],
        ...sidecars.map((id): [string, Route] => [
          `${prefix}${subtitlePathOf(id)}`,
          {
            kind: ROUTE_KINDS.ticketed,
            path: `${API_PATHS.media}/${mediaId}/${subtitlePathOf(id)}`,
            query: {},
            isMedia: false,
            isPlaylist: false,
          },
        ]),
      ])
      // The server's own address is the fallback, so a media origin that goes away mid-title is passed over.
      const origins = [...new Set([origin, server.origin])]
      const hls =
        media.kind === RELAYED_MEDIA_KINDS.transcode ? { master: mediaRoute, session: null } : null
      loads = [
        ...loads,
        { loadId, serverId: server.id, origins, name: server.name, mediaId, prefix, routes, hls },
      ]
      const base = `http://${RELAY_HOST}:${port}/${secret}`
      return {
        loadId,
        base,
        fileUrl: `${base}/${mediaPathOf(media)}`,
        sidecarUrls: sidecars.map((id) => `${base}/${subtitlePathOf(id)}`),
      }
    },
    close: (loadId) => retire((load) => load.loadId === loadId),
    // Access ends on a sign out, a removed server or a moved sign-in host: the title playing
    // stops at the end of what mpv holds, and that is read as an account to sign in to again.
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
