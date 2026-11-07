import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { type Http2ServerRequest, type Http2ServerResponse, createSecureServer } from 'node:http2'
import { tmpdir } from 'node:os'
import { extname, join, normalize } from 'node:path'
import { brotliCompressSync, constants } from 'node:zlib'
import {
  AUTH_CONFIG_STATES,
  AUTH_COOKIE,
  AUTH_PATHS,
  type AuthConfig,
  FIXTURE_SERVER,
  HTTP_METHODS,
} from '@raven/core'

/**
 * The production build as Netlify serves it, for Lighthouse CI: over HTTP/2, Brotli for every
 * text file, hashed assets cached for good, and the single-page fallback to index.html. HTTP/2
 * matters: over HTTP/1.1 Lighthouse queues the app's chunks six at a time, which Netlify never
 * does, and scores a page slower than it is. Chrome speaks HTTP/2 only over TLS, so the server
 * makes a certificate of its own each run, which lighthouserc.json tells Chrome to accept.
 *
 * It serves the build twice, once for each page lighthouserc.json scores:
 * - `signIn`: the sign-in page. The one call it makes before it draws, `/api/auth/config`, is
 *   answered here, so no raven or Supabase has to run.
 * - `home`: Home, signed in. `/api` goes to `@raven/server`'s Lighthouse fixture, which this
 *   starts and waits for: a real raven with accounts off, so Home opens without a sign-in, over a
 *   library the size of Vhagar's Home. Its answers pass through as raven compressed them, as
 *   Netlify's proxy passes them. Its pictures come from raven as JPEGs, where Netlify's Image CDN
 *   sends AVIF or WebP, so they weigh more here than in production.
 *
 * The sign-in page's performance floor in lighthouserc.json is 0.90, set from CI's runner: its
 * warm runs score 0.94 to 0.95 there, on mobile and desktop alike, and the first of the three is
 * a cold outlier (0.62 to 0.68 on mobile), so a floor of 0.95 failed whenever the median landed
 * on 0.94. It holds the page where it is; raise it as the page gets faster.
 *
 * Home's performance floor in lighthouserc.json is 0.70: its largest paint is the hero's
 * backdrop, which waits on the app, Home's chunk and `/api/home/hero` before it loads, about 4 s on simulated mobile, and drawing its hero and
 * shelves blocks the main thread for 370 to 570 ms on CI's runner, where Lighthouse slows every
 * task fourfold. The floor comes from that runner, which scored Home 0.72 to 0.78 when it was set
 * (a Mac, with a faster CPU, scores 0.87 to 0.93). It holds Home where it is; raise it as Home
 * gets faster.
 */

const SITES = {
  signIn: { host: '127.0.0.1', port: 4173 },
  home: { host: '127.0.0.1', port: 4174 },
} as const

type Site = (typeof SITES)[keyof typeof SITES]

const FIXTURE_ORIGIN = `http://${FIXTURE_SERVER.host}:${FIXTURE_SERVER.lighthousePort}`

/** How often to ask the fixture whether it is up; `startServerReadyTimeout` gives up on it. */
const FIXTURE_POLL_MS = 500

/** The headers this server reads and writes; `@shared/server` has the same, behind Nest and SQLite. */
const HEADERS = {
  acceptEncoding: 'accept-encoding',
  cacheControl: 'cache-control',
  contentEncoding: 'content-encoding',
  contentType: 'content-type',
  host: 'host',
  vary: 'vary',
} as const

/**
 * HTTP/1.1's connection headers, which the fixture sends and HTTP/2 forbids: Chrome fails a
 * response that carries one with `ERR_HTTP2_PROTOCOL_ERROR`, so they stop here, as at any proxy.
 */
const CONNECTION_HEADER_NAMES = [
  'connection',
  'keep-alive',
  'proxy-connection',
  'transfer-encoding',
  'upgrade',
] as const

const CONNECTION_HEADERS = new Set<string>(CONNECTION_HEADER_NAMES)

/** Netlify's `Cache-Control` for hashed assets (netlify.toml) and its default for everything else. */
const CACHE_POLICIES = {
  immutable: 'public, max-age=31536000, immutable',
  noCache: 'public, max-age=0, must-revalidate',
  noStore: 'no-store',
} as const

const DIST_DIR = join(import.meta.dirname, '..', 'dist')
const SERVER_DIR = join(import.meta.dirname, '..', '..', 'server')
const INDEX_FILE = 'index.html'
const ASSETS_PREFIX = '/assets/'
const API_PREFIX = '/api/'
const BROTLI = 'br'

/** The methods whose requests carry no body. */
const BODILESS_METHODS = new Set<string>([HTTP_METHODS.get, HTTP_METHODS.head])

const originOf = ({ host, port }: Site): string => `https://${host}:${port}`

/** An auth config that sends the app to its sign-in page; nothing ever calls the Supabase it names. */
const AUTH_CONFIG = {
  state: AUTH_CONFIG_STATES.ready,
  supabaseUrl: `${originOf(SITES.signIn)}/supabase`,
  publishableKey: 'lighthouse',
  webUrl: originOf(SITES.signIn),
  cookieName: AUTH_COOKIE,
} as const satisfies AuthConfig

/** The file types Netlify compresses; pictures and fonts are compressed already. */
const COMPRESSED_TYPES = new Set(['.html', '.js', '.css', '.svg', '.txt', '.json'])

type FileResponseProps = { path: string; canTakeBrotli: boolean }

const cachePolicyOf = (path: string): string =>
  path.startsWith(ASSETS_PREFIX) ? CACHE_POLICIES.immutable : CACHE_POLICIES.noCache

const fileResponse = async ({ path, canTakeBrotli }: FileResponseProps): Promise<Response> => {
  const file = Bun.file(join(DIST_DIR, path))
  const headers = {
    [HEADERS.contentType]: file.type,
    [HEADERS.cacheControl]: cachePolicyOf(path),
    [HEADERS.vary]: HEADERS.acceptEncoding,
  }
  if (!canTakeBrotli || !COMPRESSED_TYPES.has(extname(path))) {
    return new Response(file, { headers })
  }
  const body = brotliCompressSync(await file.bytes(), {
    params: { [constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY },
  })
  return new Response(body, { headers: { ...headers, [HEADERS.contentEncoding]: BROTLI } })
}

/** The file a path names inside the build, or index.html for a route the app draws itself. */
const builtPathOf = async (pathname: string): Promise<string> => {
  const path = normalize(pathname)
  const isInside = !path.split('/').includes('..')
  const isBuilt = isInside && path !== '/' && (await Bun.file(join(DIST_DIR, path)).exists())
  return isBuilt ? path : `/${INDEX_FILE}`
}

const signInApiResponse = (pathname: string): Response =>
  pathname === AUTH_PATHS.config
    ? Response.json(AUTH_CONFIG, { headers: { [HEADERS.cacheControl]: CACHE_POLICIES.noStore } })
    : Response.json({ message: 'Not here' }, { status: 404 })

/** The request as the fixture gets it: the same method, headers and body, under its own host. */
const fixtureResponse = async (request: Request): Promise<Response> => {
  const { pathname, search } = new URL(request.url)
  const headers = new Headers(request.headers)
  headers.delete(HEADERS.host)
  return fetch(`${FIXTURE_ORIGIN}${pathname}${search}`, {
    method: request.method,
    headers,
    body: BODILESS_METHODS.has(request.method) ? null : await request.arrayBuffer(),
    signal: request.signal,
    redirect: 'manual',
    // raven compressed it already; the answer goes on as it came, Content-Encoding and all.
    decompress: false,
  })
}

const API_RESPONSES = {
  [SITES.signIn.port]: (request: Request) => signInApiResponse(new URL(request.url).pathname),
  [SITES.home.port]: fixtureResponse,
} as const satisfies Record<Site['port'], (request: Request) => Response | Promise<Response>>

type RespondProps = { request: Request; site: Site }

const respond = async ({ request, site }: RespondProps): Promise<Response> => {
  const { pathname } = new URL(request.url)
  if (pathname.startsWith(API_PREFIX)) return API_RESPONSES[site.port](request)
  const canTakeBrotli = (request.headers.get(HEADERS.acceptEncoding) ?? '').includes(BROTLI)
  return fileResponse({ path: await builtPathOf(pathname), canTakeBrotli })
}

/** A TLS key and the certificate for it, as `createSecureServer` takes them. */
type Certificate = { key: string; cert: string }

/** A throwaway key and self-signed certificate for this run, made with the system's openssl. */
const makeCertificate = async (): Promise<Certificate> => {
  const dir = mkdtempSync(join(tmpdir(), 'raven-lighthouse-'))
  const keyPath = join(dir, 'key.pem')
  const certPath = join(dir, 'cert.pem')
  const made = spawnSync('openssl', [
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-days',
    '1',
    '-subj',
    `/CN=${SITES.signIn.host}`,
    '-keyout',
    keyPath,
    '-out',
    certPath,
  ])
  if (made.status !== 0) throw new Error(`openssl could not make a certificate: ${made.stderr}`)
  return { key: await Bun.file(keyPath).text(), cert: await Bun.file(certPath).text() }
}

/** An HTTP/2 request's body, read whole; empty for a GET or HEAD. */
const bodyOf = async (request: Http2ServerRequest): Promise<Blob | null> => {
  if (BODILESS_METHODS.has(request.method)) return null
  const chunks: unknown[] = await Array.fromAsync(request)
  return new Blob(
    chunks
      .filter((chunk): chunk is Buffer => Buffer.isBuffer(chunk))
      .map((chunk) => new Uint8Array(chunk)),
  )
}

type AnswerProps = { request: Http2ServerRequest; response: Http2ServerResponse; site: Site }

/**
 * Hands an HTTP/2 request to `respond` as a fetch `Request`, and streams back what it answers, so
 * a server-sent event stream from the fixture reaches the page as it is written. A page that goes
 * away aborts the request, which ends any stream the fixture still holds open.
 */
const answer = async ({ request, response, site }: AnswerProps): Promise<void> => {
  const headers = new Headers(
    Object.entries(request.headers).flatMap(([name, value]) =>
      typeof value === 'string' && !name.startsWith(':') ? [[name, value]] : [],
    ),
  )
  const gone = new AbortController()
  response.once('close', () => gone.abort())
  const answered = await respond({
    request: new Request(`${originOf(site)}${request.url}`, {
      method: request.method,
      headers,
      body: await bodyOf(request),
      signal: gone.signal,
    }),
    site,
  })
  response.writeHead(
    answered.status,
    Object.fromEntries(
      [...answered.headers].filter(([name]) => !CONNECTION_HEADERS.has(name.toLowerCase())),
    ),
  )
  await (answered.body ?? new Blob().stream()).pipeTo(
    new WritableStream({
      write: (chunk) => {
        response.write(chunk)
      },
      close: () => {
        response.end()
      },
    }),
    { signal: gone.signal },
  )
}

/** The name a fetch or stream gives the error it throws once its signal aborts. */
const ABORT_ERROR = 'AbortError'

const isAbort = (error: unknown): boolean => error instanceof Error && error.name === ABORT_ERROR

type ListenProps = { site: Site; certificate: Certificate }

const listen = ({ site, certificate }: ListenProps): Promise<void> =>
  new Promise((resolve) => {
    const server = createSecureServer(certificate, (request, response) => {
      answer({ request, response, site }).catch((error: unknown) => {
        if (isAbort(error)) return
        console.error(error)
        if (!response.headersSent) response.writeHead(502)
        response.end()
      })
    })
    server.listen(site.port, site.host, resolve)
  })

const isUp = async (): Promise<boolean> =>
  fetch(`${FIXTURE_ORIGIN}${FIXTURE_SERVER.readyPath}`)
    .then((answered) => answered.ok)
    .catch(() => false)

/** Starts the fixture and resolves once it answers, which it does only once its scans are done. */
const startFixture = async (): Promise<void> => {
  const fixture = spawn('bun', ['run', 'serve:lighthouse'], {
    cwd: SERVER_DIR,
    stdio: ['ignore', 'ignore', 'inherit'],
  })
  /*
   * Lighthouse CI stops this server with a signal once it is done; the fixture goes with it and
   * takes its temporary folder.
   */
  const stop = () => {
    fixture.kill()
    process.exit(0)
  }
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
  fixture.once('exit', (code) => {
    console.error(`The Lighthouse fixture stopped (exit ${code})`)
    process.exit(1)
  })
  const waitUntilUp = async (): Promise<void> => {
    if (await isUp()) return
    await Bun.sleep(FIXTURE_POLL_MS)
    return waitUntilUp()
  }
  await waitUntilUp()
}

const isIndexBuilt = await Bun.file(join(DIST_DIR, INDEX_FILE)).exists()
if (!isIndexBuilt) throw new Error(`No build in ${DIST_DIR}; run nx run @raven/web:build first`)

const certificate = await makeCertificate()
await startFixture()
await Promise.all(Object.values(SITES).map((site) => listen({ site, certificate })))
// Lighthouse CI waits for this line (lighthouserc.json's `startServerReadyPattern`).
process.stdout.write(
  `Lighthouse server listening on ${Object.values(SITES).map(originOf).join(' and ')}\n`,
)
