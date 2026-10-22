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
import { basename, join, resolve, sep } from 'node:path'
import { pipeline } from 'node:stream'
import {
  extensionOf,
  FILE_SCHEME,
  HTTP_METHODS,
  PAGE_ORIGIN,
  WEB_HOST,
  WEB_HOST_ERRORS,
  WEB_HOST_PORT,
} from '@raven/core'
import { WEB_DIST } from '@/build/forgeOptions'
import { errorText } from '@/main/log/errorText'
import { quietly } from '@/main/log/quietly'
import type { Timers } from '@/main/stateStore'
import { HTTP_HEADERS } from '@/shared/httpHeaders'
import { HTTP_STATUSES } from '@/shared/httpStatuses'
import { URL_PROTOCOLS } from '@/shared/playLink'

/** The log line the packaged smoke waits for: the page has somewhere to load from. */
export const WEB_HOST_READY = 'web host ready'

/** The only methods raven player's own pages and files answer. */
export const ALLOWED_METHODS = [HTTP_METHODS.get, HTTP_METHODS.head].join(', ')

const API_PATH = '/api'
const ASSETS_PATH = '/assets/'
const INDEX = 'index.html'

/** How long the server may take to take the connection before the page hears it is unreachable. */
const CONNECT_TIMEOUT_MS = 10_000

/** `localhost` reaches either, so the web host holds both and no other app can take the other. */
export const LOOPBACK_ADDRESSES = ['127.0.0.1', '::1'] as const

/** Vite names every file under `assets/` by its hash, so it never changes. */
const CACHE_POLICIES = {
  immutable: 'public, max-age=31536000, immutable',
  revalidate: 'no-cache',
  never: 'no-store',
} as const

const HTML_TYPE = 'text/html; charset=utf-8'
const JSON_TYPE = 'application/json'

const CONTENT_TYPES = new Map(
  Object.entries({
    html: HTML_TYPE,
    js: 'text/javascript; charset=utf-8',
    css: 'text/css; charset=utf-8',
    svg: 'image/svg+xml',
    json: JSON_TYPE,
    png: 'image/png',
    ico: 'image/x-icon',
    woff2: 'font/woff2',
    woff: 'font/woff',
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
const HOP_BY_HOP = new Set<string>([
  HTTP_HEADERS.connection,
  HTTP_HEADERS.keepAlive,
  HTTP_HEADERS.proxyAuthenticate,
  HTTP_HEADERS.proxyAuthorization,
  HTTP_HEADERS.te,
  HTTP_HEADERS.trailer,
  HTTP_HEADERS.transferEncoding,
  HTTP_HEADERS.upgrade,
  // The request names the server it goes to instead.
  HTTP_HEADERS.host,
])

// The web signs in with Supabase Auth directly: the one origin the page calls besides its own.
const SUPABASE_ORIGINS = 'https://*.supabase.co'

/**
 * The page's policy. Its styles, fonts and scripts are files of its own build, its posters come
 * through `/api`, and only its inline scripts (the theme, set before first paint) need a hash.
 * `authOrigin` is the test hook's Supabase Auth, or null.
 */
export const contentSecurityPolicy = ({
  scriptHashes,
  authOrigin,
}: {
  scriptHashes: readonly string[]
  authOrigin: string | null
}): string =>
  [
    "default-src 'self'",
    ["script-src 'self'", ...scriptHashes.map((hash) => `'sha256-${hash}'`)].join(' '),
    "style-src 'self'",
    "font-src 'self'",
    "img-src 'self' data:",
    `media-src 'self' ${FILE_SCHEME}:`,
    ["connect-src 'self'", SUPABASE_ORIGINS, ...(authOrigin === null ? [] : [authOrigin])].join(
      ' ',
    ),
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
  ].join('; ')

const INLINE_SCRIPT = /<script>([\s\S]*?)<\/script>/g

/** Each inline script of a page, hashed as `script-src` names it. */
export const inlineScriptHashes = (html: string): string[] =>
  [...html.matchAll(INLINE_SCRIPT)].map(([, body = '']) =>
    createHash('sha256').update(body).digest('base64'),
  )

/** The web app's build: the copy in the app's resources, or the web project's own unpackaged. */
export const webRootFor = ({
  isPackaged,
  appPath,
  resourcesPath,
}: {
  isPackaged: boolean
  appPath: string
  resourcesPath: string
}): string => (isPackaged ? join(resourcesPath, basename(WEB_DIST)) : join(appPath, WEB_DIST))

type Handler = (request: IncomingMessage, response: ServerResponse) => void

const answer = ({
  response,
  status,
  headers = {},
  body,
}: {
  response: ServerResponse
  status: number
  headers?: OutgoingHttpHeaders
  body?: Uint8Array | string
}): void => {
  response.writeHead(status, headers)
  response.end(body)
}

const isOwnHost = (host: string | undefined): boolean => (host ?? '').toLowerCase() === WEB_HOST

/** The request's address on the page's origin; null for one that names another host. */
const pageUrlOf = (url: string | undefined): URL | null => {
  const raw = url ?? ''
  if (!URL.canParse(raw, PAGE_ORIGIN)) return null
  const parsed = new URL(raw, PAGE_ORIGIN)
  return parsed.origin === PAGE_ORIGIN ? parsed : null
}

const isApiPath = (pathname: string): boolean =>
  pathname === API_PATH || pathname.startsWith(`${API_PATH}/`)

const decode = (pathname: string): string | null => {
  try {
    return decodeURIComponent(pathname)
  } catch {
    return null
  }
}

const isInside = ({ root, path }: { root: string; path: string }): boolean =>
  path === root || path.startsWith(root.endsWith(sep) ? root : `${root}${sep}`)

/**
 * Why a connection failed. Node tries both of `localhost`'s addresses and, when both refuse,
 * throws an `AggregateError` with no message, so its code says it instead.
 */
const reasonOf = (error: unknown): string =>
  error instanceof Error && 'code' in error && typeof error.code === 'string'
    ? error.code
    : errorText(error)

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

/**
 * The web host's requests: the web app's build, with every route of the single-page app
 * answered by its `index.html`, and `/api` passed on to the server untouched, streamed both
 * ways. A request for any `Host` but `localhost:47484` is refused, which blocks DNS rebinding.
 */
export const createWebHostHandler = ({
  root,
  serverOrigin,
  authOrigin,
  readFile,
  timers,
  warn,
  info,
}: {
  root: string
  serverOrigin: string
  /** The test hook's Supabase Auth origin, which the policy lets the page call; null for none. */
  authOrigin: string | null
  readFile: (path: string) => Promise<Uint8Array>
  timers: Timers
  warn: (message: string) => void
  info: (message: string) => void
}): Handler => {
  const base = resolve(root)
  const indexPath = join(base, INDEX)
  // Told once each time it changes, since the page asks again and again while it is down.
  const reach = { isReachable: true }

  const guarded = (scriptHashes: readonly string[] = []): OutgoingHttpHeaders => ({
    [HTTP_HEADERS.contentSecurityPolicy]: contentSecurityPolicy({ scriptHashes, authOrigin }),
    [HTTP_HEADERS.contentTypeOptions]: 'nosniff',
  })

  const read = (path: string) =>
    readFile(path).then(
      (bytes) => ({ path, bytes }),
      () => null,
    )

  const serveFile = async ({
    request,
    response,
    url,
  }: {
    request: IncomingMessage
    response: ServerResponse
    url: URL
  }): Promise<void> => {
    if (request.method !== HTTP_METHODS.get && request.method !== HTTP_METHODS.head) {
      answer({
        response,
        status: HTTP_STATUSES.methodNotAllowed,
        headers: { ...guarded(), [HTTP_HEADERS.allow]: ALLOWED_METHODS },
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
    const isAsset = decoded.startsWith(ASSETS_PATH)
    const found = await read(path)
    // A missing asset is a 404, so a stale chunk fails as a script rather than parse a page.
    const file = found ?? (isAsset ? null : await read(indexPath))
    if (file === null) {
      answer({ response, status: HTTP_STATUSES.notFound, headers: guarded() })
      return
    }
    const type = CONTENT_TYPES.get(extensionOf(basename(file.path))) ?? 'application/octet-stream'
    const scriptHashes =
      type === HTML_TYPE ? inlineScriptHashes(new TextDecoder().decode(file.bytes)) : []
    answer({
      response,
      status: HTTP_STATUSES.ok,
      headers: {
        ...guarded(scriptHashes),
        [HTTP_HEADERS.contentType]: type,
        [HTTP_HEADERS.contentLength]: `${file.bytes.byteLength}`,
        [HTTP_HEADERS.cacheControl]:
          isAsset && found !== null ? CACHE_POLICIES.immutable : CACHE_POLICIES.revalidate,
      },
      body: request.method === HTTP_METHODS.head ? undefined : file.bytes,
    })
  }

  const unreachable = ({ response, error }: { response: ServerResponse; error: unknown }) => {
    if (reach.isReachable) {
      quietly(warn)(`raven player could not reach its server: ${reasonOf(error)}`)
    }
    reach.isReachable = false
    answer({
      response,
      status: HTTP_STATUSES.badGateway,
      headers: {
        [HTTP_HEADERS.contentType]: JSON_TYPE,
        [HTTP_HEADERS.cacheControl]: CACHE_POLICIES.never,
      },
      body: JSON.stringify({ error: WEB_HOST_ERRORS.serverUnreachable }),
    })
  }

  const forward = ({
    request,
    response,
    url,
  }: {
    request: IncomingMessage
    response: ServerResponse
    url: URL
  }): void => {
    const target = new URL(`${url.pathname}${url.search}`, serverOrigin)
    const send = target.protocol === URL_PROTOCOLS.https ? requestHttps : requestHttp
    const outgoing = send(target, { method: request.method, headers: passed(request.headers) })
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
      if (!reach.isReachable) quietly(info)('raven player reached its server again')
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

const listenOn = ({
  createServer,
  handler,
  port,
  address,
  warn,
}: {
  createServer: (handler: Handler) => Server
  handler: Handler
  port: number
  address: string
  warn: (message: string) => void
}) =>
  new Promise<Server>((resolvePromise, reject) => {
    const server = createServer(handler)
    server.once(HTTP_EVENTS.error, reject)
    server.listen(port, address, () => {
      server.off(HTTP_EVENTS.error, reject)
      // Once it listens, a later error on the server is warned rather than thrown in main.
      server.on(HTTP_EVENTS.error, () => quietly(warn)('the web host hit an error on its socket'))
      resolvePromise(server)
    })
  })

const closeServer = (server: Server) =>
  new Promise<void>((resolvePromise) => {
    server.close(() => resolvePromise())
  })

const ADDRESS_IN_USE = 'EADDRINUSE'

/** What `listen` fails with for an address this Mac does not have, such as `::1` with IPv6 off. */
const MISSING_ADDRESS_CODES: ReadonlySet<unknown> = new Set(['EADDRNOTAVAIL', 'EAFNOSUPPORT'])

const isMissingAddress = (error: unknown): boolean =>
  error instanceof Error && 'code' in error && MISSING_ADDRESS_CODES.has(error.code)

/** What the person is told when the web host cannot listen, and raven player quits. */
export const webHostFailureText = (error: unknown): string =>
  error instanceof Error && 'code' in error && error.code === ADDRESS_IN_USE
    ? `Another app is using port ${WEB_HOST_PORT} on this Mac. Quit it, then open raven player again.`
    : `raven player could not start serving its page: ${errorText(error)}`

/**
 * Listens on `port` on each of `addresses` (`LOOPBACK_ADDRESSES`), or on none: when one is taken,
 * the others are closed again and the failure (`EADDRINUSE`) is thrown. An address this Mac does
 * not have is left out, with a warning, so long as another listens.
 */
export const listenWebHost = async ({
  createServer,
  handler,
  port,
  addresses,
  warn,
}: {
  createServer: (handler: Handler) => Server
  handler: Handler
  port: number
  addresses: readonly string[]
  warn: (message: string) => void
}): Promise<void> => {
  const opened = await addresses.reduce<Promise<Server[]>>(async (previous, address) => {
    const listening = await previous
    try {
      return [...listening, await listenOn({ createServer, handler, port, address, warn })]
    } catch (error) {
      if (isMissingAddress(error)) {
        quietly(warn)(`the web host left out ${address}, which this Mac does not have`)
        return listening
      }
      await Promise.all(listening.map(closeServer))
      throw error
    }
  }, Promise.resolve([]))
  if (opened.length === 0) throw new Error('This Mac has no loopback address to serve the page on.')
}
