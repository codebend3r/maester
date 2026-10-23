import { randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { basename, extname } from 'node:path'
import {
  type Account,
  ADMIN_LOCK_STATES,
  AUTH_PARAMS,
  AUTH_PATHS,
  DEFAULT_DISPLAY_SETTINGS,
  DEFAULT_PLAYBACK_SETTINGS,
  isMediaTracks,
  ITEM_TYPES,
  MEDIA_PROBE_BYTES,
  MEDIA_TICKET_PARAM,
  MEDIA_TICKET_SECONDS,
  type MediaItem,
  MEMBER_STATUSES,
  type MediaTracks,
  SERVER_COOKIES,
  SERVER_METHODS,
  SUBTITLE_SOURCES,
} from '@raven/core'
import {
  ACCOUNT_TICKET_PREFIX,
  AUTH_V1_PREFIX,
  bearerOf,
  createFixtureAuth,
  FIXTURE_ACCOUNT_KINDS,
  type FixtureAccounts,
  TICKET_CHECKS,
} from '@/e2e/fixtureAuth'
import {
  fieldOf,
  partsOf,
  sendEmpty,
  sendJson,
  sendMissing,
  tokenOf,
  URL_BASE,
} from '@/e2e/fixtureHttp'
import {
  catalogOf,
  FIXTURE_ITEMS,
  FIXTURE_MEDIA,
  FIXTURE_TITLE_ITEMS,
  FIXTURE_TITLES,
} from '@/e2e/fixtureLibrary'
import { API_PATHS } from '@/main/servers/allowlist'
import { HTTP_HEADERS } from '@/shared/httpHeaders'
import { mediaItemFor } from '@/shared/test/mediaItem'

/** The lock routes the fixture answers. */
export const FIXTURE_LOCK_PATHS = {
  lock: '/api/lock',
  unlock: '/api/lock/unlock',
  admin: '/api/admin',
  adminUnlock: '/api/admin/unlock',
} as const

/** `METHOD path` for the lock routes, as `answer` reads a request. */
const API_ROUTES = {
  lock: `${SERVER_METHODS.get} ${FIXTURE_LOCK_PATHS.lock}`,
  unlock: `${SERVER_METHODS.post} ${FIXTURE_LOCK_PATHS.unlock}`,
  admin: `${SERVER_METHODS.get} ${FIXTURE_LOCK_PATHS.admin}`,
  adminUnlock: `${SERVER_METHODS.post} ${FIXTURE_LOCK_PATHS.adminUnlock}`,
} as const

/** The path of one of a title's routes, as a request to the server carries it. */
export const MEDIA_PATHS = {
  item: (mediaId: number) => `/api/media/${mediaId}`,
  file: (mediaId: number) => `/api/media/${mediaId}/file`,
  sidecar: (mediaId: number) => `/api/media/${mediaId}/subtitles/external-0`,
  ticket: (mediaId: number) => `/api/media/${mediaId}/ticket`,
  progress: (mediaId: number) => `/api/media/${mediaId}/progress`,
  plays: (mediaId: number) => `/api/media/${mediaId}/plays`,
  accountTicket: (mediaId: number) =>
    AUTH_PATHS.ticket.replace(`:${AUTH_PARAMS.id}`, String(mediaId)),
} as const

/** `METHOD rest` for a title's routes, `rest` being what follows `/api/media/<id>`. */
const MEDIA_ROUTES = {
  item: `${SERVER_METHODS.get} `,
  tracks: `${SERVER_METHODS.get} /tracks`,
  sidecar: `${SERVER_METHODS.get} /subtitles/external-0`,
  file: `${SERVER_METHODS.get} /file`,
  ticket: `${SERVER_METHODS.get} /ticket`,
  progress: `${SERVER_METHODS.put} /progress`,
  plays: `${SERVER_METHODS.post} /plays`,
} as const

export const FIXTURE_ADMIN_KINDS = {
  off: 'off',
  password: 'password',
  noPassword: 'noPassword',
} as const

/**
 * The admin lock as this browser meets it:
 * - `off`: off for this browser, as after an admin unlock (a server with a password).
 * - `password`: on until `POST /api/admin/unlock` with `password` sets `raven_admin`.
 * - `noPassword`: a server with no `ADMIN_PASSWORD`, where it is on for everyone for good,
 *   so a locked title answers 404 whatever PIN went in.
 */
export type FixtureAdmin =
  | { kind: typeof FIXTURE_ADMIN_KINDS.off }
  | { kind: typeof FIXTURE_ADMIN_KINDS.password; password: string }
  | { kind: typeof FIXTURE_ADMIN_KINDS.noPassword }

/** `accounts` left out is a server with accounts off. */
export type FixtureMode = {
  pin: string
  isLocked: boolean
  admin: FixtureAdmin
  accounts?: FixtureAccounts
}

export type FixtureRequest = {
  method: string
  /** The path and query as sent, less any media ticket, whose value never reaches the log. */
  path: string
  /** Whether the query carried a media ticket in `t`. */
  hasTicket: boolean
  /** Whether that ticket was an account ticket. */
  hasAccountTicket: boolean
  /** Whether the request carried a Bearer token; the token never reaches the log. */
  hasBearer: boolean
  hasUnlock: boolean
  hasAdmin: boolean
  hasOtherCookie: boolean
  range: string | null
  body: string | null
}

/**
 * What main's media fetches send, the relay's and the downloads': an account ticket and nothing
 * else, no Bearer and no cookie.
 */
export const isTicketOnly = ({
  hasAccountTicket,
  hasBearer,
  hasUnlock,
  hasAdmin,
  hasOtherCookie,
}: FixtureRequest): boolean =>
  hasAccountTicket && !hasBearer && !hasUnlock && !hasAdmin && !hasOtherCookie

/** `METHOD path` for each request, never the bodies, which hold PINs and passwords. */
export const routesOf = (requests: readonly FixtureRequest[]): string[] =>
  requests.map(({ method, path }) => `${method} ${path}`)

export type FixtureServer = {
  origin: string
  /**
   * Every request in order. `body` holds what was sent, PINs and passwords included: read
   * the fields a test needs, never print the log whole.
   */
  requests: FixtureRequest[]
  /**
   * A second listener the redirecting title points at, with its own log. With the media plane
   * on, it is the media origin the server lists, serving files and sidecars for a ticket alone.
   */
  elsewhere: { origin: string; requests: FixtureRequest[] }
  /** Every cookie value it has handed out, unlock and admin, kept past a relock. */
  issued: () => readonly string[]
  /** Every access token, refresh token and account ticket it has handed out, in order. */
  issuedTokens: () => readonly string[]
  /** Forgets every unlock, as a server restart does. */
  relock: () => void
  /** Changes the status of the `ready` account from now on; the fixture throws when accounts are not `ready`. */
  setStatus: (status: Account['status']) => void
  /**
   * Slows every file answer that reaches byte `byte` to a trickle from there, as a slow
   * link does; an answer that starts past it goes out at full speed. `null` sends the
   * rest of each slowed answer at once and slows nothing more.
   */
  throttle: (input: { byte: number | null }) => void
  /** Holds every answer whose path matches `path` until the returned release is called. */
  stall: (input: { path: RegExp }) => () => void
  /**
   * Listens again at the same two addresses after `close`, keeping all it knew (sessions,
   * unlocks, the request logs), as a server back from an outage does.
   */
  reopen: () => Promise<void>
  /** Cuts every open connection on both listeners, as a restart or a dropped link does. */
  disconnect: () => void
  /**
   * Stops sending anything while keeping every connection open, as a server that hangs
   * does: slowed answers stop where they are and new requests wait until `close`.
   */
  hang: () => void
  /**
   * From now on every file answer sends its headers and then nothing, keeping the
   * connection open, as a server that hangs mid-answer does.
   */
  stallFiles: () => void
  close: () => Promise<void>
}

const FIXTURE_TRACKS = {
  audio: [
    { index: 0, codec: 'aac', channels: 1, language: 'en', title: null, default: true },
    { index: 1, codec: 'aac', channels: 1, language: 'fr', title: null, default: false },
  ],
  subtitles: [
    {
      id: 'embedded-0',
      source: SUBTITLE_SOURCES.embedded,
      codec: 'subrip',
      language: 'en',
      title: null,
      default: false,
      forced: false,
      hearingImpaired: false,
      supported: true,
    },
    {
      id: 'external-0',
      source: SUBTITLE_SOURCES.external,
      codec: 'subrip',
      language: 'en',
      title: null,
      default: false,
      forced: false,
      hearingImpaired: false,
      supported: true,
    },
  ],
  defaultAudio: 0,
  frameRate: 24,
} as const satisfies MediaTracks

const FIXTURE_SIDECAR =
  'WEBVTT\n\n00:00.000 --> 00:14.000\nraven fixture sidecar one\n\n00:14.000 --> 00:29.000\nraven fixture sidecar two\n'

const FIXTURE_PAGE = '<!doctype html><html><head><title>Sign in</title></head><body></body></html>'

const UNLOCK_COOKIE = SERVER_COOKIES.unlock
const ADMIN_COOKIE = SERVER_COOKIES.admin
const COOKIE_ATTRIBUTES = 'Path=/api; HttpOnly; SameSite=Strict'
const ADMIN_MAX_AGE_S = 34_560_000
/** As the server's `WrongTries`: five wrong in a row make every try wait a minute, the right one too. */
const WRONG_TRIES = 5
const WRONG_WAIT_MS = 60_000
const NO_PASSWORD = "Set ADMIN_PASSWORD in raven's .env to turn the admin lock off."
const BODY_MAX_CHARS = 65_536
const TRICKLE_BYTES = 2048
const TRICKLE_MS = 100

const LOCKED_MESSAGE = 'This library is locked.'
const PROBE_MAX_BYTES = 1_048_576
const PROBE_BYTES_PARAM = 'bytes'

const MEDIA_ROUTE = /^\/api\/media\/(\d+)(\/.*)?$/u
const MP4_EXTENSION = '.mp4'
const RANGE_OUTCOMES = { unsatisfiable: 'unsatisfiable' } as const
const ITEM_ROUTE = /^\/api\/items\/(\d+)$/u
const PING_PATH = '/api/media-origins/ping'
const LIBRARY_ROUTE = /^\/api\/libraries\/(\d+)$/u
const SAGAS_PATH = `/api/libraries/${FIXTURE_ITEMS.library}/sagas`
/** The web's reads beside the library's: the list, Home, its playback settings and its events. */
const WEB_PATHS = {
  libraries: '/api/libraries',
  home: '/api/home',
  playback: '/api/settings/playback',
  display: '/api/settings/display',
  events: '/api/events',
  showNext: `/api/items/${FIXTURE_ITEMS.show}/next`,
} as const
// What a media origin serves for a ticket: a title's file and its sidecar.
const MEDIA_PLANE_ROUTE = /^\/api\/media\/(\d+)\/(file|subtitles\/external-0)$/u

/** What `MEDIA_PLANE_ROUTE` captures for a title's file; anything else it matches is the sidecar. */
const MEDIA_PLANE_FILE = 'file'

const fileOf = (mediaId: number) => `/api/media/${mediaId}/file`

/** The ticket the fixture issues for a title, and the only one its media origin takes for it. */
const ticketFor = (mediaId: number) => `fixture-ticket-${mediaId}`

/** A slowed answer: `finish` sends the rest at once, `stop` leaves it as it is. */
type Slowed = { finish: () => void; stop: () => void }
type Stall = { path: RegExp; gate: Promise<void>; release: () => void }
type Title = { title: string; path: string; bytes: Buffer }
type Tries = { failed: number; waitUntil: number }
type Serve = (input: {
  request: IncomingMessage
  response: ServerResponse
  body: string | null
}) => void

const NO_TRIES: Tries = { failed: 0, waitUntil: 0 }

/** A request's path for the log, its ticket left out, and whether it carried one and of which kind. */
const withoutTicket = (
  url: string,
): { path: string; hasTicket: boolean; hasAccountTicket: boolean } => {
  if (!URL.canParse(url, URL_BASE)) return { path: url, hasTicket: false, hasAccountTicket: false }
  const parsed = new URL(url, URL_BASE)
  const ticket = parsed.searchParams.get(MEDIA_TICKET_PARAM)
  if (ticket === null) return { path: url, hasTicket: false, hasAccountTicket: false }
  parsed.searchParams.delete(MEDIA_TICKET_PARAM)
  return {
    path: `${parsed.pathname}${parsed.search}`,
    hasTicket: true,
    hasAccountTicket: ticket.startsWith(ACCOUNT_TICKET_PREFIX),
  }
}

/** The container the server names a clip by, from its extension: `mkv`, `mp4`. */
export const containerOf = (path: string) => extname(path).slice(1).toLowerCase()

/** How many bytes the probe asked for, as the server reads `bytes`. */
const probeLengthOf = (query: URLSearchParams): number => {
  const asked = Number(query.get(PROBE_BYTES_PARAM) ?? MEDIA_PROBE_BYTES)
  if (!Number.isSafeInteger(asked)) return MEDIA_PROBE_BYTES
  return Math.min(Math.max(asked, 1), PROBE_MAX_BYTES)
}

const afterWrong = ({ tries, now }: { tries: Tries; now: number }): Tries =>
  tries.failed + 1 < WRONG_TRIES
    ? { failed: tries.failed + 1, waitUntil: tries.waitUntil }
    : { failed: 0, waitUntil: now + WRONG_WAIT_MS }

/** The cookies a request carries, by name; values stay here and never reach a log. */
const cookiesOf = (request: IncomingMessage): ReadonlyMap<string, string> =>
  new Map(
    (request.headers.cookie ?? '')
      .split(';')
      .map((pair) => pair.trim())
      .filter((pair) => pair !== '')
      .map((pair): [string, string] => {
        const split = pair.indexOf('=')
        return split < 0 ? [pair, ''] : [pair.slice(0, split), pair.slice(split + 1)]
      }),
  )

const readBody = (request: IncomingMessage): Promise<string | null> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => {
      chunks.push(chunk)
    })
    request.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8').slice(0, BODY_MAX_CHARS)
      resolve(text === '' ? null : text)
    })
    request.on('error', reject)
  })

/** A `Range` header read as raven's `parseRange` reads it. */
const rangeOf = ({
  header,
  size,
}: {
  header: string | undefined
  size: number
}): { start: number; end: number } | typeof RANGE_OUTCOMES.unsatisfiable | null => {
  const match = /^bytes=(\d*)-(\d*)/u.exec((header ?? '').trim())
  if (match === null) return null
  const [, rawStart = '', rawEnd = ''] = match
  if (rawStart === '' && rawEnd === '') return null
  if (rawStart === '') {
    const suffix = Number(rawEnd)
    if (suffix === 0) return RANGE_OUTCOMES.unsatisfiable
    return { start: Math.max(0, size - suffix), end: size - 1 }
  }
  const start = Number(rawStart)
  const end = rawEnd === '' ? size - 1 : Math.min(Number(rawEnd), size - 1)
  if (start >= size || end < start) return RANGE_OUTCOMES.unsatisfiable
  return { start, end }
}

/**
 * Sends `bytes` from `from` to `end` a `TRICKLE_BYTES` chunk every `TRICKLE_MS`: slower
 * than either clip plays, yet each read returns, so mpv can still act on a seek.
 */
const trickle = ({
  response,
  bytes,
  from,
  end,
}: {
  response: ServerResponse
  bytes: Buffer
  from: number
  end: number
}): Slowed => {
  const position = { next: from }
  const timer = setInterval(() => {
    if (response.destroyed) return clearInterval(timer)
    const until = Math.min(position.next + TRICKLE_BYTES, end + 1)
    response.write(bytes.subarray(position.next, until))
    position.next = until
    if (until > end) {
      clearInterval(timer)
      response.end()
    }
  }, TRICKLE_MS)
  return {
    finish: () => {
      clearInterval(timer)
      if (response.destroyed || response.writableEnded) return
      response.end(bytes.subarray(position.next, end + 1))
    },
    stop: () => clearInterval(timer),
  }
}

const contentTypeOf = (path: string) =>
  extname(path).toLowerCase() === MP4_EXTENSION ? 'video/mp4' : 'video/x-matroska'

const listen = async ({ server, port }: { server: Server; port: number }): Promise<string> => {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('No fixture port')
  return `http://127.0.0.1:${address.port}`
}

const shut = (server: Server): Promise<void> =>
  new Promise((resolve) => {
    if (!server.listening) return resolve()
    server.closeAllConnections()
    server.close(() => resolve())
  })

/**
 * A stand-in raven server on `127.0.0.1`, shaped like `apps/raven/server` (Ruling 1): the
 * PIN and admin locks with their cookies, titles behind the lock, their track list, a
 * sidecar and byte ranges, and a library holding a show, its season and a saga. Each title
 * reports its file's real size, as a download checks the bytes against it. Its logs say
 * which cookies a request carried, never their values, and whether it carried a ticket,
 * never the ticket. `now` is the clock the wrong-try wait and the tickets read.
 *
 * With `hasMediaPlane` on (Ruling 15), the server lists `elsewhere` as its `lan` media origin,
 * answers the probe, and issues tickets behind the lock, timed in epoch milliseconds as the
 * server's `MediaTickets` times them. `port` keeps an earlier fixture's address, as a server
 * that restarts does; 0 takes any free one.
 */
export const startFixtureServer = async ({
  clips,
  mode,
  now = Date.now,
  hasMediaPlane = false,
  port = 0,
}: {
  clips: { first: string; second: string; tracks: string }
  mode: FixtureMode
  now?: () => number
  hasMediaPlane?: boolean
  port?: number
}): Promise<FixtureServer> => {
  if (!isMediaTracks(FIXTURE_TRACKS)) throw new Error('The fixture track list is not a MediaTracks')
  const [tracksBytes, firstBytes, secondBytes] = await Promise.all([
    readFile(clips.tracks),
    readFile(clips.first),
    readFile(clips.second),
  ])
  const titles: ReadonlyMap<number, Title> = new Map([
    [FIXTURE_MEDIA.first, { title: FIXTURE_TITLES.first, path: clips.tracks, bytes: tracksBytes }],
    [
      FIXTURE_MEDIA.second,
      { title: FIXTURE_TITLES.second, path: clips.second, bytes: secondBytes },
    ],
    [FIXTURE_MEDIA.redirecting, { title: 'Fixture Three', path: clips.tracks, bytes: tracksBytes }],
    [FIXTURE_MEDIA.page, { title: 'Fixture Four', path: clips.tracks, bytes: tracksBytes }],
    [
      FIXTURE_MEDIA.firstEpisode,
      { title: FIXTURE_TITLES.firstEpisode, path: clips.first, bytes: firstBytes },
    ],
    [
      FIXTURE_MEDIA.secondEpisode,
      { title: FIXTURE_TITLES.secondEpisode, path: clips.second, bytes: secondBytes },
    ],
  ])
  const mediaItems: ReadonlyMap<number, MediaItem> = new Map(
    [...titles].map(([mediaId, { title, path, bytes }]): [number, MediaItem] => {
      const item = FIXTURE_TITLE_ITEMS.get(mediaId) ?? null
      return [
        mediaId,
        mediaItemFor({
          id: mediaId,
          libraryId:
            (item?.type ?? null) === ITEM_TYPES.episode
              ? FIXTURE_ITEMS.showLibrary
              : FIXTURE_ITEMS.library,
          title,
          duration: 30,
          fileName: basename(path),
          size: bytes.length,
          container: containerOf(path),
          item,
        }),
      ]
    }),
  )
  const { items, libraries, sagas, home: homePage } = catalogOf({ media: mediaItems })

  // A restart forgets `unlocks` but not `admins`: the admin cookie outlives the process.
  let unlocks: ReadonlySet<string> = new Set()
  let admins: ReadonlySet<string> = new Set()
  let issued: readonly string[] = []
  let pinTries = NO_TRIES
  let adminTries = NO_TRIES
  let throttleAt: number | null = null
  let isFileStalled = false
  let slowed: readonly Slowed[] = []
  let stalls: readonly Stall[] = []

  const logOf = ({
    request,
    body,
  }: {
    request: IncomingMessage
    body: string | null
  }): FixtureRequest => {
    const cookies = cookiesOf(request)
    return {
      method: request.method ?? '',
      ...withoutTicket(request.url ?? ''),
      hasBearer: bearerOf(request) !== null,
      hasUnlock: cookies.has(UNLOCK_COOKIE),
      hasAdmin: cookies.has(ADMIN_COOKIE),
      hasOtherCookie: Array.from(cookies.keys()).some(
        (name) => name !== UNLOCK_COOKIE && name !== ADMIN_COOKIE,
      ),
      range: request.headers.range ?? null,
      body: partsOf(request.url ?? '').pathname.startsWith(AUTH_V1_PREFIX) ? null : body,
    }
  }

  const sendFile = ({
    request,
    response,
    path,
    bytes,
  }: {
    request: IncomingMessage
    response: ServerResponse
    path: string
    bytes: Buffer
  }) => {
    const range = rangeOf({ header: request.headers.range, size: bytes.length })
    const common = {
      [HTTP_HEADERS.acceptRanges]: 'bytes',
      [HTTP_HEADERS.contentType]: contentTypeOf(path),
    }
    if (range === RANGE_OUTCOMES.unsatisfiable) {
      response.writeHead(416, { ...common, [HTTP_HEADERS.contentRange]: `bytes */${bytes.length}` })
      response.end()
      return
    }
    const { start, end } = range ?? { start: 0, end: bytes.length - 1 }
    response.writeHead(range === null ? 200 : 206, {
      ...common,
      ...(range === null
        ? {}
        : { [HTTP_HEADERS.contentRange]: `bytes ${start}-${end}/${bytes.length}` }),
      [HTTP_HEADERS.contentLength]: end - start + 1,
    })
    if (isFileStalled) {
      response.flushHeaders()
      return
    }
    const at = throttleAt
    if (at === null || start >= at || end < at) {
      response.end(bytes.subarray(start, end + 1))
      return
    }
    response.write(bytes.subarray(start, at))
    slowed = [...slowed, trickle({ response, bytes, from: at, end })]
  }

  const adminHolds = (cookies: ReadonlyMap<string, string>): boolean => {
    switch (mode.admin.kind) {
      case FIXTURE_ADMIN_KINDS.off:
        return false
      case FIXTURE_ADMIN_KINDS.noPassword:
        return true
      case FIXTURE_ADMIN_KINDS.password:
        return !admins.has(cookies.get(ADMIN_COOKIE) ?? '')
      default: {
        const unreachable: never = mode.admin
        return unreachable
      }
    }
  }

  const adminLockOf = (cookies: ReadonlyMap<string, string>) => {
    switch (mode.admin.kind) {
      case FIXTURE_ADMIN_KINDS.off:
        return { state: ADMIN_LOCK_STATES.off }
      case FIXTURE_ADMIN_KINDS.noPassword:
        return { state: ADMIN_LOCK_STATES.on, available: false }
      case FIXTURE_ADMIN_KINDS.password:
        return adminHolds(cookies)
          ? { state: ADMIN_LOCK_STATES.on, available: true }
          : { state: ADMIN_LOCK_STATES.off }
      default: {
        const unreachable: never = mode.admin
        return unreachable
      }
    }
  }

  // As the server's `LockService`: the PIN opens nothing while the admin lock holds.
  const isUnlocked = (cookies: ReadonlyMap<string, string>) =>
    unlocks.has(cookies.get(UNLOCK_COOKIE) ?? '') && !adminHolds(cookies)

  const canSee = (cookies: ReadonlyMap<string, string>) => !mode.isLocked || isUnlocked(cookies)

  /**
   * Answers for what sits in the locked library when this browser may not see it, as the
   * server's `LockGuard` does: 404 while the admin lock holds, so nothing asks for the PIN,
   * else 423. False, answering nothing, when it may see it.
   */
  const isHeldBack = ({
    request,
    response,
    missing,
  }: {
    request: IncomingMessage
    response: ServerResponse
    missing: string
  }): boolean => {
    const cookies = cookiesOf(request)
    if (canSee(cookies)) return false
    const isHidden = adminHolds(cookies)
    sendJson({
      response,
      status: isHidden ? 404 : 423,
      body: { message: isHidden ? missing : LOCKED_MESSAGE },
    })
    return true
  }

  const auth = createFixtureAuth({
    accounts: mode.accounts ?? { kind: FIXTURE_ACCOUNT_KINDS.off },
    origin: () => origin,
    now,
    hasTitle: (mediaId) => titles.has(mediaId),
    isHeldBack,
  })

  const sendPing = ({ response, query }: { response: ServerResponse; query: URLSearchParams }) => {
    const length = probeLengthOf(query)
    response.writeHead(200, {
      [HTTP_HEADERS.contentType]: 'application/octet-stream',
      [HTTP_HEADERS.contentLength]: length,
      [HTTP_HEADERS.cacheControl]: 'no-store',
    })
    response.end(randomBytes(length))
  }

  const sendSidecar = (response: ServerResponse) => {
    response.writeHead(200, { [HTTP_HEADERS.contentType]: 'text/vtt; charset=utf-8' })
    response.end(FIXTURE_SIDECAR)
  }

  const answerMedia = ({
    request,
    response,
    mediaId,
    rest,
  }: {
    request: IncomingMessage
    response: ServerResponse
    mediaId: number
    rest: string
  }) => {
    const title = titles.get(mediaId)
    const missing = `No media ${mediaId}`
    if (title === undefined) return sendJson({ response, status: 404, body: { message: missing } })
    const route = `${request.method ?? ''} ${rest}`
    const isTicketRoute = route === MEDIA_ROUTES.file || route === MEDIA_ROUTES.sidecar
    const ticket = isTicketRoute
      ? auth.checkTicket({ request, response, mediaId })
      : TICKET_CHECKS.none
    if (ticket === TICKET_CHECKS.refused) return
    // An account ticket passes the PIN lock, as the server's media plane lets it.
    if (ticket === TICKET_CHECKS.none && isHeldBack({ request, response, missing })) return
    switch (route) {
      case MEDIA_ROUTES.item:
        return sendJson({ response, status: 200, body: mediaItems.get(mediaId) })
      case MEDIA_ROUTES.tracks:
        return sendJson({ response, status: 200, body: FIXTURE_TRACKS })
      case MEDIA_ROUTES.sidecar:
        return sendSidecar(response)
      case MEDIA_ROUTES.ticket:
        if (!hasMediaPlane) return sendMissing(response)
        return sendJson({
          response,
          status: 200,
          body: {
            ticket: ticketFor(mediaId),
            expiresAt: now() + MEDIA_TICKET_SECONDS * 1000,
          },
        })
      case MEDIA_ROUTES.file:
        if (mediaId === FIXTURE_MEDIA.redirecting) {
          response.writeHead(302, { location: `${elsewhere.origin}${fileOf(mediaId)}` })
          response.end()
          return
        }
        if (mediaId === FIXTURE_MEDIA.page) {
          response.writeHead(200, { [HTTP_HEADERS.contentType]: 'text/html; charset=utf-8' })
          response.end(FIXTURE_PAGE)
          return
        }
        return sendFile({ request, response, path: title.path, bytes: title.bytes })
      case MEDIA_ROUTES.progress:
      case MEDIA_ROUTES.plays:
        return sendEmpty({ response, status: 204 })
      default:
        return sendMissing(response)
    }
  }

  const answerItem = ({
    request,
    response,
    itemId,
  }: {
    request: IncomingMessage
    response: ServerResponse
    itemId: number
  }) => {
    const item = items.get(itemId)
    const missing = `No item ${itemId}`
    if (item === undefined) return sendJson({ response, status: 404, body: { message: missing } })
    if (isHeldBack({ request, response, missing })) return
    return sendJson({ response, status: 200, body: item })
  }

  const answerSagas = ({
    request,
    response,
  }: {
    request: IncomingMessage
    response: ServerResponse
  }) => {
    if (isHeldBack({ request, response, missing: `No library ${FIXTURE_ITEMS.library}` })) return
    sendJson({ response, status: 200, body: sagas })
  }

  /**
   * How the routes of the library and the media plane, which name no title, answer a request;
   * null for any other request.
   */
  const libraryRouteOf = ({
    request,
    response,
  }: {
    request: IncomingMessage
    response: ServerResponse
  }): (() => void) | null => {
    if (request.method !== SERVER_METHODS.get) return null
    const { pathname, query } = partsOf(request.url ?? '')
    if (pathname === API_PATHS.mediaOrigins) {
      const origins = hasMediaPlane ? [{ kind: 'lan', url: elsewhere.origin }] : []
      return () => sendJson({ response, status: 200, body: { origins } })
    }
    if (pathname === PING_PATH) {
      return () => (hasMediaPlane ? sendPing({ response, query }) : sendMissing(response))
    }
    const webRoute = webRouteOf({ pathname, response })
    if (webRoute !== null) return webRoute
    // Public, as the server's is: a library's settings hold nothing the lock keeps back.
    const libraryId = Number(LIBRARY_ROUTE.exec(pathname)?.[1] ?? 0)
    const found = libraries.find(({ id }) => id === libraryId)
    if (found !== undefined) return () => sendJson({ response, status: 200, body: found })
    if (pathname === SAGAS_PATH) return () => answerSagas({ request, response })
    const item = ITEM_ROUTE.exec(pathname)
    if (item === null) return null
    return () => answerItem({ request, response, itemId: Number(item[1]) })
  }

  /** The web's reads that name no library or title; null for any other path. */
  const webRouteOf = ({
    pathname,
    response,
  }: {
    pathname: string
    response: ServerResponse
  }): (() => void) | null => {
    switch (pathname) {
      case WEB_PATHS.libraries:
        return () => sendJson({ response, status: 200, body: libraries })
      case WEB_PATHS.home:
        return () => sendJson({ response, status: 200, body: homePage })
      case WEB_PATHS.playback:
        return () => sendJson({ response, status: 200, body: DEFAULT_PLAYBACK_SETTINGS })
      case WEB_PATHS.display:
        return () => sendJson({ response, status: 200, body: DEFAULT_DISPLAY_SETTINGS })
      case WEB_PATHS.showNext:
        return () =>
          sendJson({
            response,
            status: 200,
            body: mediaItems.get(FIXTURE_MEDIA.firstEpisode) ?? null,
          })
      // Open and quiet: the fixture's library never changes under the page.
      case WEB_PATHS.events:
        return () => {
          response.writeHead(200, {
            [HTTP_HEADERS.contentType]: 'text/event-stream',
            [HTTP_HEADERS.cacheControl]: 'no-store',
          })
          response.flushHeaders()
        }
      default:
        return null
    }
  }

  /**
   * The media origin: a title's file and sidecar for that title's ticket alone. A browser
   * sends no cookie to another origin, so a cookie here opens nothing.
   */
  const answerMediaPlane = ({
    request,
    response,
  }: {
    request: IncomingMessage
    response: ServerResponse
  }) => {
    if (!hasMediaPlane || request.method !== SERVER_METHODS.get) return sendMissing(response)
    const { pathname, query } = partsOf(request.url ?? '')
    if (pathname === PING_PATH) return sendPing({ response, query })
    const route = MEDIA_PLANE_ROUTE.exec(pathname)
    const mediaId = Number(route?.[1] ?? 0)
    const title = titles.get(mediaId)
    if (route === null || title === undefined) return sendMissing(response)
    // An account ticket opens the title here too, as on the server's own address.
    const ticket =
      query.get(MEDIA_TICKET_PARAM) === ticketFor(mediaId)
        ? TICKET_CHECKS.passed
        : auth.checkTicket({ request, response, mediaId })
    if (ticket === TICKET_CHECKS.refused) return
    if (ticket === TICKET_CHECKS.none) {
      return sendJson({ response, status: 401, body: { message: 'That ticket is not valid.' } })
    }
    if (route[2] !== MEDIA_PLANE_FILE) return sendSidecar(response)
    return sendFile({ request, response, path: title.path, bytes: title.bytes })
  }

  const answerUnlock = ({ response, body }: { response: ServerResponse; body: string | null }) => {
    if (now() < pinTries.waitUntil) {
      return sendJson({
        response,
        status: 429,
        body: { message: 'Too many wrong PINs. Try again in a minute.' },
      })
    }
    if (fieldOf({ body, name: 'pin' }) === mode.pin) {
      pinTries = { ...pinTries, failed: 0 }
      const token = tokenOf()
      unlocks = new Set([...unlocks, token])
      issued = [...issued, token]
      return sendJson({
        response,
        status: 200,
        body: { available: true, unlocked: true },
        cookie: `${UNLOCK_COOKIE}=${token}; ${COOKIE_ATTRIBUTES}`,
      })
    }
    pinTries = afterWrong({ tries: pinTries, now: now() })
    return sendJson({ response, status: 401, body: { message: 'That PIN is not right.' } })
  }

  const answerAdminUnlock = ({
    response,
    body,
  }: {
    response: ServerResponse
    body: string | null
  }) => {
    switch (mode.admin.kind) {
      case FIXTURE_ADMIN_KINDS.noPassword:
        return sendJson({ response, status: 503, body: { message: NO_PASSWORD } })
      // Already off for this browser: there is nothing to turn off.
      case FIXTURE_ADMIN_KINDS.off:
        return sendJson({ response, status: 200, body: { state: ADMIN_LOCK_STATES.off } })
      case FIXTURE_ADMIN_KINDS.password:
        break
      default: {
        const unreachable: never = mode.admin
        return unreachable
      }
    }
    if (now() < adminTries.waitUntil) {
      return sendJson({
        response,
        status: 429,
        body: { message: 'Too many wrong passwords. Try again in a minute.' },
      })
    }
    if (fieldOf({ body, name: 'password' }) !== mode.admin.password) {
      adminTries = afterWrong({ tries: adminTries, now: now() })
      return sendJson({ response, status: 401, body: { message: 'That password is not right.' } })
    }
    adminTries = { ...adminTries, failed: 0 }
    const token = tokenOf()
    admins = new Set([...admins, token])
    issued = [...issued, token]
    return sendJson({
      response,
      status: 200,
      body: { state: ADMIN_LOCK_STATES.off },
      cookie: `${ADMIN_COOKIE}=${token}; ${COOKIE_ATTRIBUTES}; Max-Age=${ADMIN_MAX_AGE_S}`,
    })
  }

  const answer = ({
    request,
    response,
    body,
  }: {
    request: IncomingMessage
    response: ServerResponse
    body: string | null
  }) => {
    const path = request.url ?? ''
    const cookies = cookiesOf(request)
    const route = `${request.method ?? ''} ${path}`
    if (route === API_ROUTES.lock) {
      return sendJson({
        response,
        status: 200,
        body: { available: true, unlocked: isUnlocked(cookies) },
      })
    }
    if (route === API_ROUTES.unlock) return answerUnlock({ response, body })
    if (route === API_ROUTES.admin) {
      return sendJson({ response, status: 200, body: adminLockOf(cookies) })
    }
    if (route === API_ROUTES.adminUnlock) return answerAdminUnlock({ response, body })
    if (auth.answerAccounts({ request, response, body })) return
    const libraryRoute = libraryRouteOf({ request, response })
    if (libraryRoute !== null) return libraryRoute()
    const media = MEDIA_ROUTE.exec(partsOf(path).pathname)
    if (media === null) return sendMissing(response)
    return answerMedia({ request, response, mediaId: Number(media[1]), rest: media[2] ?? '' })
  }

  /** A listener and its own request log: each request is logged, then held by any stall it matches. */
  const listener = ({ serve }: { serve: Serve }) => {
    const requests: FixtureRequest[] = []
    const handle = async ({
      request,
      response,
    }: {
      request: IncomingMessage
      response: ServerResponse
    }) => {
      const body = await readBody(request)
      requests.push(logOf({ request, body }))
      const path = request.url ?? ''
      await Promise.all(stalls.filter((stall) => stall.path.test(path)).map(({ gate }) => gate))
      if (response.destroyed) return
      serve({ request, response, body })
    }
    const server = createServer((request, response) => {
      handle({ request, response }).catch(() => {
        response.destroy()
      })
    })
    return { server, requests }
  }

  const home = listener({ serve: answer })
  const away = listener({
    serve: ({ request, response }) => {
      if (
        request.method === SERVER_METHODS.get &&
        request.url === fileOf(FIXTURE_MEDIA.redirecting)
      ) {
        return sendFile({ request, response, path: clips.tracks, bytes: tracksBytes })
      }
      return answerMediaPlane({ request, response })
    },
  })

  // Home first: a stored `port` is free again only since the last fixture closed, and a
  // listener taking any free port first could be handed that very one.
  const origin = await listen({ server: home.server, port })
  const elsewhere = {
    origin: await listen({ server: away.server, port: 0 }).catch(async (error: unknown) => {
      await shut(home.server)
      throw error
    }),
    requests: away.requests,
  }

  const stall = ({ path }: { path: RegExp }) => {
    const opened: { release: () => void } = { release: () => {} }
    const gate = new Promise<void>((resolve) => {
      opened.release = resolve
    })
    const held = { path, gate, release: opened.release }
    stalls = [...stalls, held]
    return () => {
      stalls = stalls.filter((candidate) => candidate !== held)
      held.release()
    }
  }

  const releaseAll = () => {
    stalls.forEach(({ release }) => release())
    stalls = []
  }

  const stopSlowed = () => {
    slowed.forEach(({ stop }) => stop())
    slowed = []
  }

  const disconnect = () => {
    stopSlowed()
    home.server.closeAllConnections()
    away.server.closeAllConnections()
  }

  return {
    origin,
    requests: home.requests,
    elsewhere,
    issued: () => issued,
    issuedTokens: auth.issuedTokens,
    relock: () => {
      unlocks = new Set()
    },
    setStatus: auth.setStatus,
    throttle: ({ byte }) => {
      throttleAt = byte
      if (byte !== null) return
      const waiting = slowed
      slowed = []
      waiting.forEach(({ finish }) => finish())
    },
    stall,
    disconnect,
    stallFiles: () => {
      isFileStalled = true
    },
    hang: () => {
      stopSlowed()
      stall({ path: /^/u })
    },
    close: async () => {
      releaseAll()
      throttleAt = null
      disconnect()
      await Promise.all([shut(home.server), shut(away.server)])
    },
    reopen: async () => {
      await listen({ server: home.server, port: Number(new URL(origin).port) })
      await listen({ server: away.server, port: Number(new URL(elsewhere.origin).port) })
    },
  }
}

/** The web fixture's PIN, which nothing asks for: it locks no library. */
const WEB_PIN = '3001'
/** A ticket's life on the web's fixture: the server's five minutes. */
const WEB_TICKET_MS = 300_000
/** An access token's life on the web's fixture, as Supabase's default hour. */
const WEB_JWT_SECONDS = 3600

/**
 * The server Raven's web pages run against: accounts on, the fixture's account approved,
 * no library locked. With `hasMediaPlane` it lists its media origin too.
 */
export const startWebFixture = ({
  clips,
  hasMediaPlane = false,
}: {
  clips: { first: string; second: string; tracks: string }
  hasMediaPlane?: boolean
}): Promise<FixtureServer> =>
  startFixtureServer({
    clips,
    mode: {
      pin: WEB_PIN,
      isLocked: false,
      admin: { kind: FIXTURE_ADMIN_KINDS.off },
      accounts: {
        kind: FIXTURE_ACCOUNT_KINDS.ready,
        status: MEMBER_STATUSES.approved,
        ticketMs: WEB_TICKET_MS,
        jwtSeconds: WEB_JWT_SECONDS,
      },
    },
    hasMediaPlane,
  })
