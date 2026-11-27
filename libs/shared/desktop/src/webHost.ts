import { createHash } from 'node:crypto'
import {
  type IncomingHttpHeaders,
  type IncomingMessage,
  type OutgoingHttpHeaders,
  request as requestHttp,
  type Server,
  type ServerResponse,
} from 'node:http'
import { request as requestHttps } from 'node:https'
import { basename, extname, join, resolve, sep } from 'node:path'
import { pipeline } from 'node:stream'
import { CACHE_POLICIES, CONTENT_TYPES, HEADERS, HTTP_METHODS, HTTP_STATUSES } from '@shared/http'

import { ERROR_CODES, errorCodeOf, errorText } from '@/errors'
import type { Timers } from '@/timers'

/** The only methods the page's own files answer. */
export const ALLOWED_METHODS = [HTTP_METHODS.get, HTTP_METHODS.head].join(', ')

/** The paths the web host tells apart: the server's API, and Vite's hashed build files. */
const PATHS = { api: '/api', assets: '/assets/' } as const
const INDEX = 'index.html'

/** The URL protocols a server may be reached by. */
const URL_PROTOCOLS = { https: 'https:' } as const

/** How long the server may take to take the connection before the page hears it is unreachable. */
const CONNECT_TIMEOUT_MS = 10_000

/** `localhost` reaches either, so the web host holds both and no other app can take the other. */
export const LOOPBACK_ADDRESSES = ['127.0.0.1', '::1'] as const

/** The content type of each file extension the web app's build holds. */
const TYPES_BY_EXTENSION: ReadonlyMap<string, string> = new Map(
  Object.entries({
    html: CONTENT_TYPES.html,
    js: 'text/javascript; charset=utf-8',
    css: 'text/css; charset=utf-8',
    svg: 'image/svg+xml',
    json: CONTENT_TYPES.json,
    png: 'image/png',
    ico: 'image/x-icon',
    woff2: 'font/woff2',
    woff: 'font/woff',
    txt: 'text/plain; charset=utf-8',
  }),
)

/** The `node:http` events the web host listens for. */
const HTTP_EVENTS = {
  close: 'close',
  connect: 'connect',
  error: 'error',
  response: 'response',
  socket: 'socket',
} as const

/** Headers that belong to one connection, not to the request or answer it carries. */
const HOP_BY_HOP: ReadonlySet<string> = new Set([
  HEADERS.connection,
  HEADERS.keepAlive,
  HEADERS.proxyAuthenticate,
  HEADERS.proxyAuthorization,
  HEADERS.te,
  HEADERS.trailer,
  HEADERS.transferEncoding,
  HEADERS.upgrade,
  // The request names the server it goes to instead.
  HEADERS.host,
])

// The page signs in with Supabase Auth directly: the one origin it calls besides its own.
const SUPABASE_ORIGINS = 'https://*.supabase.co'

/** The page's inline scripts and styles, each hashed as its CSP directive names it. */
export type InlineHashes = { scripts: readonly string[]; styles: readonly string[] }

const NO_INLINE_HASHES = { scripts: [], styles: [] } as const satisfies InlineHashes

/** What an app's page may load beyond its own origin, by the directive that allows it. */
export type PolicySources = {
  images: readonly string[]
  media: readonly string[]
  /** Besides Supabase Auth, which every page signs in with. */
  connections: readonly string[]
}

type DirectiveProps = { directive: string; sources: readonly string[] }

const directive = ({ directive: name, sources }: DirectiveProps): string =>
  [name, "'self'", ...sources].join(' ')

const hashed = (hashes: readonly string[]): string[] => hashes.map((hash) => `'sha256-${hash}'`)

type ContentSecurityPolicyProps = { inlineHashes: InlineHashes; sources: PolicySources }

/**
 * The page's policy. Its styles, fonts and scripts are files of its own build, what it plays and
 * shows comes through `/api` or `sources`, and only what index.html carries inline before first
 * paint (a theme script, a loader's styles) needs a hash.
 */
export const contentSecurityPolicy = ({
  inlineHashes,
  sources,
}: ContentSecurityPolicyProps): string =>
  [
    "default-src 'self'",
    directive({ directive: 'script-src', sources: hashed(inlineHashes.scripts) }),
    directive({ directive: 'style-src', sources: hashed(inlineHashes.styles) }),
    "font-src 'self'",
    directive({ directive: 'img-src', sources: ['data:', ...sources.images] }),
    directive({ directive: 'media-src', sources: sources.media }),
    directive({ directive: 'connect-src', sources: [SUPABASE_ORIGINS, ...sources.connections] }),
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
  ].join('; ')

const INLINE_SCRIPT = /<script>([\s\S]*?)<\/script>/gi

const INLINE_STYLE = /<style>([\s\S]*?)<\/style>/gi

type HashesOfProps = { html: string; pattern: RegExp }

const hashesOf = ({ html, pattern }: HashesOfProps): string[] =>
  [...html.matchAll(pattern)].map(([, body = '']) =>
    createHash('sha256').update(body).digest('base64'),
  )

/** Each inline script and style of a page, hashed as `script-src` and `style-src` name them. */
export const inlineHashesOf = (html: string): InlineHashes => ({
  scripts: hashesOf({ html, pattern: INLINE_SCRIPT }),
  styles: hashesOf({ html, pattern: INLINE_STYLE }),
})

type WebRootForProps = {
  isPackaged: boolean
  appPath: string
  resourcesPath: string
  /** The web project's build, relative to the app's own folder. */
  webDist: string
}

/** The web app's build: the copy in the app's resources, or the web project's own unpackaged. */
export const webRootFor = ({
  isPackaged,
  appPath,
  resourcesPath,
  webDist,
}: WebRootForProps): string =>
  isPackaged ? join(resourcesPath, basename(webDist)) : join(appPath, webDist)

export type Handler = (request: IncomingMessage, response: ServerResponse) => void

type AnswerProps = {
  response: ServerResponse
  status: number
  headers?: OutgoingHttpHeaders
  body?: Uint8Array | string
}

const answer = ({ response, status, headers = {}, body }: AnswerProps): void => {
  response.writeHead(status, headers)
  response.end(body)
}

const isApiPath = (pathname: string): boolean =>
  pathname === PATHS.api || pathname.startsWith(`${PATHS.api}/`)

const decode = (pathname: string): string | null => {
  try {
    return decodeURIComponent(pathname)
  } catch {
    return null
  }
}

type IsInsideProps = { root: string; path: string }

const isInside = ({ root, path }: IsInsideProps): boolean =>
  path === root || path.startsWith(root.endsWith(sep) ? root : `${root}${sep}`)

const typeOf = (path: string): string =>
  TYPES_BY_EXTENSION.get(extname(path).slice(1).toLowerCase()) ?? CONTENT_TYPES.octetStream

/**
 * Why a connection failed. Node tries both of `localhost`'s addresses and, when both refuse,
 * throws an `AggregateError` with no message, so its code says it instead.
 */
const reasonOf = (error: unknown): string => errorCodeOf(error) ?? errorText(error)

/** The headers a message's `Connection` names, which belong to that one connection too. */
const connectionNamed = (headers: IncomingHttpHeaders): ReadonlySet<string> =>
  new Set(
    (headers.connection ?? '')
      .split(',')
      .map((name) => name.trim().toLowerCase())
      .filter((name) => name !== ''),
  )

const passed = (headers: IncomingHttpHeaders): OutgoingHttpHeaders => {
  const named = connectionNamed(headers)
  return Object.fromEntries(
    Object.entries(headers).flatMap(([name, value]) =>
      value === undefined || HOP_BY_HOP.has(name) || named.has(name)
        ? []
        : [[name, value] as const],
    ),
  )
}

/** What the web host logs as its server goes out of reach and comes back. */
export type ReachNotes = {
  unreachable: (reason: string) => string
  reachedAgain: string
}

type CreateWebHostHandlerProps = {
  root: string
  /** The one `Host` the page is served on, `localhost:<port>`. */
  host: string
  /** The page's origin, `http://localhost:<port>`. */
  pageOrigin: string
  /** The server a request to `/api` goes to, read for each request. */
  upstreamOf: (url: URL) => string
  sources: PolicySources
  /** The page as served, made from the build's `index.html`; the build's own when left out. */
  pageOf?: (html: string) => string
  /** The JSON the page reads as its server out of reach, answered with a 502. */
  unreachableBody: string
  notes: ReachNotes
  readFile: (path: string) => Promise<Uint8Array>
  timers: Timers
  warn: (message: string) => void
  info: (message: string) => void
}

/**
 * The web host's requests: the web app's build, with every route of the single-page app
 * answered by its `index.html`, and `/api` passed on to the server untouched, streamed both
 * ways, so the page's cookie session, its media and its pictures work as they do on the
 * server's own origin. A request for any `Host` but `host` is refused, which blocks DNS
 * rebinding.
 */
export const createWebHostHandler = ({
  root,
  host,
  pageOrigin,
  upstreamOf,
  sources,
  pageOf = (html) => html,
  unreachableBody,
  notes,
  readFile,
  timers,
  warn,
  info,
}: CreateWebHostHandlerProps): Handler => {
  const base = resolve(root)
  const indexPath = join(base, INDEX)
  // Told once each time it changes, since the page asks again and again while it is down.
  const reach = { isReachable: true }

  const guarded = (inlineHashes: InlineHashes = NO_INLINE_HASHES): OutgoingHttpHeaders => ({
    [HEADERS.contentSecurityPolicy]: contentSecurityPolicy({ inlineHashes, sources }),
    [HEADERS.contentTypeOptions]: 'nosniff',
  })

  const isOwnHost = (requested: string | undefined): boolean =>
    (requested ?? '').toLowerCase() === host

  /** The request's address on the page's origin; null for one that names another host. */
  const pageUrlOf = (url: string | undefined): URL | null => {
    const raw = url ?? ''
    if (!URL.canParse(raw, pageOrigin)) return null
    const parsed = new URL(raw, pageOrigin)
    return parsed.origin === pageOrigin ? parsed : null
  }

  const read = (path: string) =>
    readFile(path).then(
      (bytes) => ({ path, bytes }),
      () => null,
    )

  type ServeFileProps = { request: IncomingMessage; response: ServerResponse; url: URL }

  const serveFile = async ({ request, response, url }: ServeFileProps): Promise<void> => {
    if (request.method !== HTTP_METHODS.get && request.method !== HTTP_METHODS.head) {
      answer({
        response,
        status: HTTP_STATUSES.methodNotAllowed,
        headers: { ...guarded(), [HEADERS.allow]: ALLOWED_METHODS },
      })
      return
    }
    const decoded = decode(url.pathname)
    if (decoded === null || decoded.includes('\0')) {
      answer({ response, status: HTTP_STATUSES.badRequest, headers: guarded() })
      return
    }
    // A backslash separates path segments on Windows, so it never belongs in a name here.
    if (decoded.includes('\\')) {
      answer({ response, status: HTTP_STATUSES.forbidden, headers: guarded() })
      return
    }
    const relative = decoded.replace(/^\/+/, '')
    const path = resolve(base, relative === '' ? INDEX : relative)
    if (!isInside({ root: base, path })) {
      answer({ response, status: HTTP_STATUSES.forbidden, headers: guarded() })
      return
    }
    const isAsset = decoded.startsWith(PATHS.assets)
    const found = await read(path)
    // A missing asset is a 404, so a stale chunk fails as a script rather than parse a page.
    const file = found ?? (isAsset ? null : await read(indexPath))
    if (file === null) {
      answer({ response, status: HTTP_STATUSES.notFound, headers: guarded() })
      return
    }
    const type = typeOf(file.path)
    const isPage = type === CONTENT_TYPES.html
    const html = isPage ? pageOf(new TextDecoder().decode(file.bytes)) : ''
    const bytes = isPage ? new TextEncoder().encode(html) : file.bytes
    answer({
      response,
      status: HTTP_STATUSES.ok,
      headers: {
        ...guarded(isPage ? inlineHashesOf(html) : NO_INLINE_HASHES),
        [HEADERS.contentType]: type,
        [HEADERS.contentLength]: `${bytes.byteLength}`,
        // Vite names every file under `assets/` by its hash, so it never changes.
        [HEADERS.cacheControl]:
          isAsset && found !== null ? CACHE_POLICIES.immutable : CACHE_POLICIES.noCache,
      },
      body: request.method === HTTP_METHODS.head ? undefined : bytes,
    })
  }

  type UnreachableProps = { response: ServerResponse; error: unknown }

  const unreachable = ({ response, error }: UnreachableProps) => {
    if (reach.isReachable) warn(notes.unreachable(reasonOf(error)))
    reach.isReachable = false
    answer({
      response,
      status: HTTP_STATUSES.badGateway,
      headers: {
        [HEADERS.contentType]: CONTENT_TYPES.json,
        [HEADERS.cacheControl]: CACHE_POLICIES.noStore,
      },
      body: unreachableBody,
    })
  }

  type ForwardProps = { request: IncomingMessage; response: ServerResponse; url: URL }

  const forward = ({ request, response, url }: ForwardProps): void => {
    const destination = new URL(upstreamOf(url))
    const send = destination.protocol === URL_PROTOCOLS.https ? requestHttps : requestHttp
    const outgoing = send({
      protocol: destination.protocol,
      hostname: destination.hostname.replace(/^\[|\]$/g, ''),
      port: destination.port,
      path: `${url.pathname}${url.search}`,
      method: request.method,
      headers: passed(request.headers),
    })
    const page = { hasLeft: false }

    outgoing.on(HTTP_EVENTS.socket, (socket) => {
      if (!socket.connecting) return
      const timer = timers.set({
        run: () => outgoing.destroy(new Error('The server did not take the connection in time.')),
        ms: CONNECT_TIMEOUT_MS,
      })
      socket.once(HTTP_EVENTS.connect, () => timers.clear(timer))
      socket.once(HTTP_EVENTS.close, () => timers.clear(timer))
    })
    outgoing.on(HTTP_EVENTS.response, (upstream) => {
      if (!reach.isReachable) info(notes.reachedAgain)
      reach.isReachable = true
      response.writeHead(upstream.statusCode ?? HTTP_STATUSES.badGateway, passed(upstream.headers))
      // Sent at once, so an event stream opens before its first event.
      response.flushHeaders()
      // A break on either side ends both; there is no one left to tell.
      pipeline(upstream, response, () => {})
    })
    outgoing.on(HTTP_EVENTS.error, (error) => {
      if (page.hasLeft) return
      if (response.headersSent) {
        response.destroy()
        return
      }
      unreachable({ response, error })
    })
    // The page let go (a closed event stream, a seek): the server's request goes too.
    response.on(HTTP_EVENTS.close, () => {
      if (response.writableFinished) return
      page.hasLeft = true
      outgoing.destroy()
    })
    request.on(HTTP_EVENTS.error, () => outgoing.destroy())
    request.pipe(outgoing)
  }

  return (request, response) => {
    if (!isOwnHost(request.headers.host)) {
      answer({ response, status: HTTP_STATUSES.misdirected, headers: guarded() })
      return
    }
    const url = pageUrlOf(request.url)
    if (url === null) {
      answer({ response, status: HTTP_STATUSES.badRequest, headers: guarded() })
      return
    }
    if (isApiPath(url.pathname)) {
      forward({ request, response, url })
      return
    }
    serveFile({ request, response, url }).catch(() => {
      response.destroy()
    })
  }
}

type ListenOnProps = {
  createServer: (handler: Handler) => Server
  handler: Handler
  port: number
  address: string
  warn: (message: string) => void
}

const listenOn = ({ createServer, handler, port, address, warn }: ListenOnProps) =>
  new Promise<Server>((resolvePromise, reject) => {
    const server = createServer(handler)
    server.once(HTTP_EVENTS.error, reject)
    server.listen(port, address, () => {
      server.off(HTTP_EVENTS.error, reject)
      // Once it listens, a later error on the server is warned rather than thrown in main.
      server.on(HTTP_EVENTS.error, () => warn('the web host hit an error on its socket'))
      resolvePromise(server)
    })
  })

const closeServer = (server: Server) =>
  new Promise<void>((resolvePromise) => {
    server.close(() => resolvePromise())
  })

/** What `listen` fails with for an address this Mac does not have, such as `::1` with IPv6 off. */
const MISSING_ADDRESS_CODES: ReadonlySet<string | null> = new Set([
  ERROR_CODES.addressNotAvailable,
  ERROR_CODES.familyNotSupported,
])

const isMissingAddress = (error: unknown): boolean => MISSING_ADDRESS_CODES.has(errorCodeOf(error))

type ListenWebHostProps = {
  createServer: (handler: Handler) => Server
  handler: Handler
  port: number
  addresses: readonly string[]
  warn: (message: string) => void
}

/**
 * Listens on `port` on each of `addresses` (`LOOPBACK_ADDRESSES`), or on none: when one is taken,
 * the others are closed again and the failure (`EADDRINUSE`) is thrown. An address this computer
 * does not have is left out, with a warning, so long as another listens.
 */
export const listenWebHost = async ({
  createServer,
  handler,
  port,
  addresses,
  warn,
}: ListenWebHostProps): Promise<void> => {
  const opened = await addresses.reduce<Promise<Server[]>>(async (previous, address) => {
    const listening = await previous
    try {
      return [...listening, await listenOn({ createServer, handler, port, address, warn })]
    } catch (error) {
      if (isMissingAddress(error)) {
        warn(`the web host left out ${address}, which this computer does not have`)
        return listening
      }
      await Promise.all(listening.map(closeServer))
      throw error
    }
  }, Promise.resolve([]))
  if (opened.length === 0)
    throw new Error('This computer has no loopback address to serve the page on.')
}
