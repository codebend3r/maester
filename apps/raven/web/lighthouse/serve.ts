import { spawnSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { type Http2ServerRequest, type Http2ServerResponse, createSecureServer } from 'node:http2'
import { tmpdir } from 'node:os'
import { extname, join, normalize } from 'node:path'
import { brotliCompressSync, constants } from 'node:zlib'
import { AUTH_CONFIG_STATES, AUTH_COOKIE, AUTH_PATHS, type AuthConfig } from '@raven/core'

/**
 * The production build as Netlify serves it, for Lighthouse CI: over HTTP/2, Brotli for every
 * text file, hashed assets cached for good, the single-page fallback to index.html, and the one
 * call the sign-in page makes before it draws, answered here so no raven or Supabase has to run.
 * HTTP/2 matters: over HTTP/1.1 Lighthouse queues the app's chunks six at a time, which Netlify
 * never does, and scores a page slower than it is. Chrome speaks HTTP/2 only over TLS, so the
 * server makes a certificate of its own each run, which lighthouserc.json tells Chrome to accept.
 */

/** Where Lighthouse CI's `startServerCommand` expects the build (lighthouserc.json's `url`). */
const LIGHTHOUSE_SERVER = { host: '127.0.0.1', port: 4173 } as const

/** The headers this server reads and writes; `@shared/server` has the same, behind Nest and SQLite. */
const HEADERS = {
  acceptEncoding: 'accept-encoding',
  cacheControl: 'cache-control',
  contentEncoding: 'content-encoding',
  contentType: 'content-type',
  vary: 'vary',
} as const

/** Netlify's `Cache-Control` for hashed assets (netlify.toml) and its default for everything else. */
const CACHE_POLICIES = {
  immutable: 'public, max-age=31536000, immutable',
  noCache: 'public, max-age=0, must-revalidate',
  noStore: 'no-store',
} as const

const DIST_DIR = join(import.meta.dirname, '..', 'dist')
const INDEX_FILE = 'index.html'
const ASSETS_PREFIX = '/assets/'
const API_PREFIX = '/api/'
const BROTLI = 'br'

/** An auth config that sends the app to its sign-in page; nothing ever calls the Supabase it names. */
const AUTH_CONFIG = {
  state: AUTH_CONFIG_STATES.ready,
  supabaseUrl: `https://${LIGHTHOUSE_SERVER.host}:${LIGHTHOUSE_SERVER.port}/supabase`,
  publishableKey: 'lighthouse',
  webUrl: `https://${LIGHTHOUSE_SERVER.host}:${LIGHTHOUSE_SERVER.port}`,
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

const apiResponse = (pathname: string): Response =>
  pathname === AUTH_PATHS.config
    ? Response.json(AUTH_CONFIG, { headers: { [HEADERS.cacheControl]: CACHE_POLICIES.noStore } })
    : Response.json({ message: 'Not here' }, { status: 404 })

const respond = async (request: Request): Promise<Response> => {
  const { pathname } = new URL(request.url)
  if (pathname.startsWith(API_PREFIX)) return apiResponse(pathname)
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
    `/CN=${LIGHTHOUSE_SERVER.host}`,
    '-keyout',
    keyPath,
    '-out',
    certPath,
  ])
  if (made.status !== 0) throw new Error(`openssl could not make a certificate: ${made.stderr}`)
  return { key: await Bun.file(keyPath).text(), cert: await Bun.file(certPath).text() }
}

type AnswerProps = { request: Http2ServerRequest; response: Http2ServerResponse }

/** Hands an HTTP/2 request to `respond` as a fetch `Request`, and writes back what it answers. */
const answer = async ({ request, response }: AnswerProps): Promise<void> => {
  const headers = new Headers(
    Object.entries(request.headers).flatMap(([name, value]) =>
      typeof value === 'string' && !name.startsWith(':') ? [[name, value]] : [],
    ),
  )
  const answered = await respond(
    new Request(`https://${LIGHTHOUSE_SERVER.host}${request.url}`, { headers }),
  )
  response.writeHead(answered.status, Object.fromEntries(answered.headers))
  response.end(new Uint8Array(await answered.arrayBuffer()))
}

const isIndexBuilt = await Bun.file(join(DIST_DIR, INDEX_FILE)).exists()
if (!isIndexBuilt) throw new Error(`No build in ${DIST_DIR}; run nx run @raven/web:build first`)

const server = createSecureServer(await makeCertificate(), (request, response) => {
  answer({ request, response }).catch((error: unknown) => {
    console.error(error)
    response.writeHead(500)
    response.end()
  })
})
// Lighthouse CI waits for this line (lighthouserc.json's `startServerReadyPattern`).
server.listen(LIGHTHOUSE_SERVER.port, LIGHTHOUSE_SERVER.host, () => {
  process.stdout.write(
    `Lighthouse server listening on https://${LIGHTHOUSE_SERVER.host}:${LIGHTHOUSE_SERVER.port}\n`,
  )
})
