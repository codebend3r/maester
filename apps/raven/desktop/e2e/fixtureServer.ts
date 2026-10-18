import { randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { basename, extname } from 'node:path'
import {
  ADMIN_LOCK_STATES,
  isMediaTracks,
  isRecord,
  isString,
  type MediaTracks,
  SUBTITLE_SOURCES,
} from '@raven/core'
import { API_PATHS } from '@/main/servers/allowlist'
import { HTTP_HEADERS } from '@/shared/httpHeaders'
import { SERVER_METHODS } from '@/shared/protocol'
import { mediaItemFor } from '@/shared/test/mediaItem'

/**
 * The titles the fixture holds. `page` answers its file with an HTML page and a 200, as a
 * proxy's sign-in page in front of a server does.
 */
export const FIXTURE_MEDIA = { first: 1, second: 2, redirecting: 3, page: 4 } as const

/** `METHOD path` for the lock routes, as `answer` reads a request. */
const API_ROUTES = {
  lock: `${SERVER_METHODS.get} ${API_PATHS.lock}`,
  unlock: `${SERVER_METHODS.post} ${API_PATHS.unlock}`,
  admin: `${SERVER_METHODS.get} ${API_PATHS.admin}`,
  adminUnlock: `${SERVER_METHODS.post} ${API_PATHS.adminUnlock}`,
} as const

/** `METHOD rest` for a title's routes, `rest` being what follows `/api/media/<id>`. */
const MEDIA_ROUTES = {
  item: `${SERVER_METHODS.get} `,
  tracks: `${SERVER_METHODS.get} /tracks`,
  sidecar: `${SERVER_METHODS.get} /subtitles/external-0`,
  file: `${SERVER_METHODS.get} /file`,
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

export type FixtureMode = { pin: string; isLocked: boolean; admin: FixtureAdmin }

export type FixtureRequest = {
  method: string
  path: string
  hasUnlock: boolean
  hasAdmin: boolean
  hasOtherCookie: boolean
  range: string | null
  body: string | null
}

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
  /** A second listener the redirecting title points at, with its own log. */
  elsewhere: { origin: string; requests: FixtureRequest[] }
  /** Every cookie value it has handed out, unlock and admin, kept past a relock. */
  issued: () => readonly string[]
  /** Forgets every unlock, as a server restart does. */
  relock: () => void
  /**
   * Slows every file answer that reaches byte `byte` to a trickle from there, as a slow
   * link does; an answer that starts past it goes out at full speed. `null` sends the
   * rest of each slowed answer at once and slows nothing more.
   */
  throttle: (input: { byte: number | null }) => void
  /** Holds every answer whose path matches `path` until the returned release is called. */
  stall: (input: { path: RegExp }) => () => void
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

const UNLOCK_COOKIE = 'raven_unlock'
const ADMIN_COOKIE = 'raven_admin'
const COOKIE_ATTRIBUTES = 'Path=/api; HttpOnly; SameSite=Strict'
const ADMIN_MAX_AGE_S = 34_560_000
/** As the server's `WrongTries`: five wrong in a row make every try wait a minute, the right one too. */
const WRONG_TRIES = 5
const WRONG_WAIT_MS = 60_000
const NO_PASSWORD = "Set ADMIN_PASSWORD in raven's .env to turn the admin lock off."
const BODY_MAX_CHARS = 65_536
const TRICKLE_BYTES = 2048
const TRICKLE_MS = 100

const MEDIA_ROUTE = /^\/api\/media\/(\d+)(\/.*)?$/u
const MP4_EXTENSION = '.mp4'
const RANGE_OUTCOMES = { unsatisfiable: 'unsatisfiable' } as const

const fileOf = (mediaId: number) => `/api/media/${mediaId}/file`

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

const afterWrong = ({ tries, now }: { tries: Tries; now: number }): Tries =>
  tries.failed + 1 < WRONG_TRIES
    ? { failed: tries.failed + 1, waitUntil: tries.waitUntil }
    : { failed: 0, waitUntil: now + WRONG_WAIT_MS }

const tokenOf = () => `${Date.now()}.${randomBytes(18).toString('base64url')}`

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

const parseJson = (text: string | null): unknown => {
  if (text === null) return null
  try {
    const value: unknown = JSON.parse(text)
    return value
  } catch {
    return null
  }
}

const fieldOf = ({ body, name }: { body: string | null; name: string }): string | null => {
  const value = parseJson(body)
  if (!isRecord(value)) return null
  const field = value[name]
  return isString(field) ? field : null
}

const sendJson = ({
  response,
  status,
  body,
  cookie = null,
}: {
  response: ServerResponse
  status: number
  body: unknown
  cookie?: string | null
}) => {
  response.writeHead(status, {
    [HTTP_HEADERS.contentType]: 'application/json; charset=utf-8',
    ...(cookie === null ? {} : { [HTTP_HEADERS.setCookie]: cookie }),
  })
  response.end(JSON.stringify(body))
}

const sendEmpty = ({ response, status }: { response: ServerResponse; status: number }) => {
  response.writeHead(status)
  response.end()
}

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

const listen = async (server: Server): Promise<string> => {
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve())
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
 * sidecar and byte ranges. Its logs say which cookies a request carried, never their
 * values. `now` is the clock the wrong-try wait reads.
 */
export const startFixtureServer = async ({
  clips,
  mode,
  now = Date.now,
}: {
  clips: { first: string; second: string; tracks: string }
  mode: FixtureMode
  now?: () => number
}): Promise<FixtureServer> => {
  if (!isMediaTracks(FIXTURE_TRACKS)) throw new Error('The fixture track list is not a MediaTracks')
  const [tracksBytes, secondBytes] = await Promise.all([
    readFile(clips.tracks),
    readFile(clips.second),
  ])
  const titles: ReadonlyMap<number, Title> = new Map([
    [FIXTURE_MEDIA.first, { title: 'Fixture One', path: clips.tracks, bytes: tracksBytes }],
    [FIXTURE_MEDIA.second, { title: 'Fixture Two', path: clips.second, bytes: secondBytes }],
    [FIXTURE_MEDIA.redirecting, { title: 'Fixture Three', path: clips.tracks, bytes: tracksBytes }],
    [FIXTURE_MEDIA.page, { title: 'Fixture Four', path: clips.tracks, bytes: tracksBytes }],
  ])

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
      path: request.url ?? '',
      hasUnlock: cookies.has(UNLOCK_COOKIE),
      hasAdmin: cookies.has(ADMIN_COOKIE),
      hasOtherCookie: Array.from(cookies.keys()).some(
        (name) => name !== UNLOCK_COOKIE && name !== ADMIN_COOKIE,
      ),
      range: request.headers.range ?? null,
      body,
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
    const cookies = cookiesOf(request)
    const missing = { message: `No media ${mediaId}` }
    if (title === undefined) return sendJson({ response, status: 404, body: missing })
    if (!canSee(cookies)) {
      if (adminHolds(cookies)) return sendJson({ response, status: 404, body: missing })
      return sendJson({ response, status: 423, body: { message: 'This library is locked.' } })
    }
    const route = `${request.method ?? ''} ${rest}`
    switch (route) {
      case MEDIA_ROUTES.item:
        return sendJson({
          response,
          status: 200,
          body: mediaItemFor({
            id: mediaId,
            title: title.title,
            duration: 30,
            fileName: basename(title.path),
          }),
        })
      case MEDIA_ROUTES.tracks:
        return sendJson({ response, status: 200, body: FIXTURE_TRACKS })
      case MEDIA_ROUTES.sidecar:
        response.writeHead(200, { [HTTP_HEADERS.contentType]: 'text/vtt; charset=utf-8' })
        response.end(FIXTURE_SIDECAR)
        return
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
        return sendJson({ response, status: 404, body: { message: 'Not found' } })
    }
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
    const media = MEDIA_ROUTE.exec(path)
    if (media === null) return sendJson({ response, status: 404, body: { message: 'Not found' } })
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
      return sendJson({ response, status: 404, body: { message: 'Not found' } })
    },
  })

  const elsewhere = { origin: await listen(away.server), requests: away.requests }
  const origin = await listen(home.server)

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
    relock: () => {
      unlocks = new Set()
    },
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
  }
}
