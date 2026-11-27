import { afterAll, beforeAll, describe, expect, it, mock } from 'bun:test'
import { type IncomingMessage, type Server, createServer, request } from 'node:http'
import { type AddressInfo } from 'node:net'
import { join } from 'node:path'
import { HTTP_METHODS, WEB_HOST_ERRORS } from '@raven/core'
import { WREN_HOST, WREN_HOST_META } from '@raven/wren'
import {
  ALLOWED_METHODS,
  type Handler,
  contentSecurityPolicy,
  createNodeTimers,
  inlineHashesOf,
} from '@shared/desktop'
import { CACHE_POLICIES, CONTENT_TYPES, HEADERS, HTTP_STATUSES } from '@shared/http'
import { WREN_POLICY_SOURCES, createWrenHostHandler, taggedPage } from '@/main/webHost'

const ROOT = '/wren-web/dist'
const THEME_SCRIPT = 'document.documentElement.dataset.theme = "night"'
const INDEX = `<!doctype html><html><head><title>Wren</title><script>${THEME_SCRIPT}</script></head><body></body></html>`
const SCRIPT = 'console.log("wren")'

const FILES: ReadonlyMap<string, string> = new Map([
  [join(ROOT, 'index.html'), INDEX],
  [join(ROOT, 'assets', 'index-abc.js'), SCRIPT],
])

const readFile = (path: string): Promise<Uint8Array> => {
  const text = FILES.get(path)
  if (text === undefined) return Promise.reject(new Error(`ENOENT ${path}`))
  return Promise.resolve(new TextEncoder().encode(text))
}

type Answer = { status: number; headers: IncomingMessage['headers']; body: string }

type AskProps = {
  port: number
  path: string
  method?: string
  host?: string
  headers?: Record<string, string>
}

const ask = ({ port, path, method = HTTP_METHODS.get, host = WREN_HOST, headers = {} }: AskProps) =>
  new Promise<Answer>((resolve, reject) => {
    const outgoing = request(
      { host: '127.0.0.1', port, path, method, headers: { ...headers, [HEADERS.host]: host } },
      (response) => {
        const chunks: Buffer[] = []
        response.on('data', (chunk: Buffer) => chunks.push(chunk))
        response.on('end', () =>
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        )
      },
    )
    outgoing.on('error', reject)
    outgoing.end()
  })

const listen = (handler: Handler) =>
  new Promise<Server>((resolve) => {
    const server = createServer(handler)
    server.listen(0, '127.0.0.1', () => resolve(server))
  })

const portOf = (server: Server): number => {
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('not listening')
  const { port }: AddressInfo = address
  return port
}

const close = (server: Server) => new Promise<void>((resolve) => server.close(() => resolve()))

describe('the web host', () => {
  const seen: { path: string; cookie: string }[] = []
  const servers: { raven?: Server; host?: Server; downHost?: Server } = {}
  const ports = { host: 0, downHost: 0 }
  const warn = mock()

  beforeAll(async () => {
    servers.raven = await listen((incoming, response) => {
      seen.push({ path: incoming.url ?? '', cookie: incoming.headers.cookie ?? '' })
      response.writeHead(HTTP_STATUSES.ok, { [HEADERS.contentType]: CONTENT_TYPES.json })
      response.end('{"ok":true}')
    })
    servers.host = await listen(
      createWrenHostHandler({
        root: ROOT,
        timers: createNodeTimers(),
        serverOrigin: `http://127.0.0.1:${portOf(servers.raven)}`,
        readFile,
        warn,
        info: mock(),
      }),
    )
    // Nothing listens on port 9 of the loopback, so `/api` there is out of reach.
    servers.downHost = await listen(
      createWrenHostHandler({
        root: ROOT,
        timers: createNodeTimers(),
        serverOrigin: 'http://127.0.0.1:9',
        readFile,
        warn,
        info: mock(),
      }),
    )
    ports.host = portOf(servers.host)
    ports.downHost = portOf(servers.downHost)
  })

  afterAll(async () => {
    await Promise.all(
      [servers.raven, servers.host, servers.downHost].flatMap((server) =>
        server === undefined ? [] : [close(server)],
      ),
    )
  })

  it('serves the page tagged with the raven it plays from, under a policy that hashes its theme script', async () => {
    const answer = await ask({ port: ports.host, path: '/' })
    expect(answer.status).toBe(HTTP_STATUSES.ok)
    expect(answer.body).toContain(
      `<meta name="${WREN_HOST_META.serverAddress}" content="http://127.0.0.1:`,
    )
    expect(answer.headers[HEADERS.contentSecurityPolicy]).toBe(
      contentSecurityPolicy({ inlineHashes: inlineHashesOf(INDEX), sources: WREN_POLICY_SOURCES }),
    )
    expect(answer.headers[HEADERS.cacheControl]).toBe(CACHE_POLICIES.noCache)
  })

  it("answers every route of the single-page app with its page, and keeps an asset's name forever", async () => {
    expect((await ask({ port: ports.host, path: '/album/3' })).body).toContain(
      '<title>Wren</title>',
    )
    const asset = await ask({ port: ports.host, path: '/assets/index-abc.js' })
    expect(asset.body).toBe(SCRIPT)
    expect(asset.headers[HEADERS.cacheControl]).toBe(CACHE_POLICIES.immutable)
  })

  it('answers a missing asset with a 404 rather than the page', async () => {
    expect((await ask({ port: ports.host, path: '/assets/gone.js' })).status).toBe(
      HTTP_STATUSES.notFound,
    )
  })

  it('refuses a path out of the build, a write, and any other host', async () => {
    expect((await ask({ port: ports.host, path: '/..%2f..%2fetc%2fhosts' })).status).toBe(
      HTTP_STATUSES.forbidden,
    )
    const write = await ask({ port: ports.host, path: '/', method: HTTP_METHODS.post })
    expect(write.status).toBe(HTTP_STATUSES.methodNotAllowed)
    expect(write.headers[HEADERS.allow]).toBe(ALLOWED_METHODS)
    expect((await ask({ port: ports.host, path: '/', host: 'evil.example:47485' })).status).toBe(
      HTTP_STATUSES.misdirected,
    )
  })

  it('passes /api on to raven with its query and cookie, and hands back the answer', async () => {
    const answer = await ask({
      port: ports.host,
      path: '/api/music/albums?library=3',
      headers: { cookie: 'sb=1' },
    })
    expect(answer.status).toBe(HTTP_STATUSES.ok)
    expect(answer.body).toBe('{"ok":true}')
    expect(seen.at(-1)).toEqual({ path: '/api/music/albums?library=3', cookie: 'sb=1' })
  })

  it('says raven is out of reach in the words the web app reads, and warns once', async () => {
    const first = await ask({ port: ports.downHost, path: '/api/auth/config' })
    await ask({ port: ports.downHost, path: '/api/auth/config' })
    expect(first.status).toBe(HTTP_STATUSES.badGateway)
    expect(JSON.parse(first.body)).toEqual({ error: WEB_HOST_ERRORS.serverUnreachable })
    expect(warn).toHaveBeenCalledTimes(1)
  })
})

describe('taggedPage', () => {
  it('escapes the origin it names, and leaves a page with no head alone', () => {
    expect(taggedPage({ html: '<head></head>', serverOrigin: 'http://a"b' })).toContain(
      'content="http://a&quot;b"',
    )
    expect(taggedPage({ html: '<p>no head</p>', serverOrigin: 'http://a' })).toBe('<p>no head</p>')
  })
})
