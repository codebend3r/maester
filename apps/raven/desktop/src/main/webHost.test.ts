import { afterEach, describe, expect, it } from 'bun:test'
import { createHash } from 'node:crypto'
import {
  createServer,
  type IncomingHttpHeaders,
  type IncomingMessage,
  request,
  type Server,
  type ServerResponse,
} from 'node:http'
import { createServer as createNetServer } from 'node:net'
import { join } from 'node:path'
import { text } from 'node:stream/consumers'
import { HTTP_METHODS, WEB_HOST, AUTH_PATHS, WEB_HOST_ERRORS } from '@raven/core'
import { ERROR_CODES, type Timers } from '@/main/stateStore'
import {
  contentSecurityPolicy,
  createWebHostHandler,
  inlineScriptHashes,
  listenWebHost,
  LOOPBACK_ADDRESSES,
  webHostFailureText,
  webRootFor,
} from '@/main/webHost'
import { HTTP_HEADERS } from '@/shared/httpHeaders'

const ROOT = '/opt/raven/web'
const THEME_SCRIPT = "\n      document.documentElement.dataset.theme = 'dusk'\n    "
const INDEX = `<html><head><script>${THEME_SCRIPT}</script><script type="module" src="/assets/app.js"></script></head></html>`
const THEME_HASH = createHash('sha256').update(THEME_SCRIPT).digest('base64')

const FILES: Record<string, string> = {
  [`${ROOT}/index.html`]: INDEX,
  [`${ROOT}/assets/app-1a2b.js`]: 'console.log(1)',
  [`${ROOT}/assets/app-1a2b.css`]: 'a{}',
  [`${ROOT}/assets/font.woff2`]: 'w2',
  [`${ROOT}/favicon.svg`]: '<svg/>',
  [`${ROOT}/favicon.ico`]: 'ico',
  [`${ROOT}/brand/raven-icon-512.png`]: 'png',
  [`${ROOT}/data.bin`]: 'bin',
  '/opt/raven/package.json': 'secret',
  '/opt/raven/web-evil/index.html': 'evil',
}

const servers: Server[] = []

afterEach(() => {
  servers.splice(0).forEach((server) => {
    server.closeAllConnections()
    server.close()
  })
})

const portOf = (server: Server): number => {
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('not listening')
  return address.port
}

const listen = (handler: (request: IncomingMessage, response: ServerResponse) => void) =>
  new Promise<number>((resolve) => {
    const server = createServer(handler)
    servers.push(server)
    server.listen(0, '127.0.0.1', () => resolve(portOf(server)))
  })

type Reply = { status: number; headers: IncomingHttpHeaders; body: string }

const ask = ({
  port,
  path,
  method = HTTP_METHODS.get,
  headers = {},
  body = '',
}: {
  port: number
  path: string
  method?: string
  headers?: Record<string, string>
  body?: string
}) =>
  new Promise<Reply>((resolve, reject) => {
    const outgoing = request(
      {
        host: '127.0.0.1',
        port,
        path,
        method,
        headers: { [HTTP_HEADERS.host]: WEB_HOST, ...headers },
      },
      (response) => {
        text(response).then(
          (read) =>
            resolve({ status: response.statusCode ?? 0, headers: response.headers, body: read }),
          reject,
        )
      },
    )
    outgoing.on('error', reject)
    outgoing.end(body)
  })

type Heard = { method: string; url: string; headers: IncomingHttpHeaders; body: string }

/** A stand-in for raven's server: keeps each request it hears and answers with `answer`. */
const upstream = async (
  answer: (input: { heard: Heard; response: ServerResponse }) => void = ({ response }) => {
    response.writeHead(200, { [HTTP_HEADERS.contentType]: 'application/json' })
    response.end('{"ok":true}')
  },
) => {
  const heard: Heard[] = []
  const hear = async ({
    incoming,
    response,
  }: {
    incoming: IncomingMessage
    response: ServerResponse
  }) => {
    const entry = {
      method: incoming.method ?? '',
      url: incoming.url ?? '',
      headers: incoming.headers,
      body: await text(incoming),
    }
    heard.push(entry)
    answer({ heard: entry, response })
  }
  const port = await listen((incoming, response) => {
    hear({ incoming, response }).catch(() => response.destroy())
  })
  return { heard, origin: `http://127.0.0.1:${port}` }
}

const NO_TIMERS: Timers = { set: () => 0, clear: () => {} }

const host = async ({
  serverOrigin = 'http://127.0.0.1:1',
  authOrigin = null,
  timers = NO_TIMERS,
}: { serverOrigin?: string; authOrigin?: string | null; timers?: Timers } = {}) => {
  const reads: string[] = []
  const warnings: string[] = []
  const notes: string[] = []
  const handler = createWebHostHandler({
    root: ROOT,
    serverOrigin,
    authOrigin,
    readFile: async (path) => {
      reads.push(path)
      const body = FILES[path]
      if (body === undefined) throw Object.assign(new Error('ENOENT'), { code: ERROR_CODES.enoent })
      return new TextEncoder().encode(body)
    },
    timers,
    warn: (message) => warnings.push(message),
    info: (message) => notes.push(message),
  })
  const port = await listen(handler)
  return { port, reads, warnings, notes }
}

describe('contentSecurityPolicy', () => {
  it('allows the page its own origin, Supabase Auth, raven-file media and its inline scripts', () => {
    expect(contentSecurityPolicy({ scriptHashes: ['abc='], authOrigin: null })).toBe(
      "default-src 'self'; script-src 'self' 'sha256-abc='; style-src 'self'; font-src 'self'; img-src 'self' data:; media-src 'self' raven-file:; connect-src 'self' https://*.supabase.co; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    )
  })

  it('allows no inline script when there is none', () => {
    expect(contentSecurityPolicy({ scriptHashes: [], authOrigin: null })).toContain(
      "script-src 'self';",
    )
  })

  it("lets the page call the test hook's Auth origin beside Supabase", () => {
    expect(
      contentSecurityPolicy({ scriptHashes: [], authOrigin: 'http://127.0.0.1:9000' }),
    ).toContain("connect-src 'self' https://*.supabase.co http://127.0.0.1:9000;")
  })
})

describe('inlineScriptHashes', () => {
  it('hashes each inline script and skips the ones loaded from a file', () => {
    expect(inlineScriptHashes(INDEX)).toEqual([THEME_HASH])
    expect(inlineScriptHashes('<script>a</script><p></p><script>b</script>')).toEqual([
      createHash('sha256').update('a').digest('base64'),
      createHash('sha256').update('b').digest('base64'),
    ])
    expect(inlineScriptHashes('<html></html>')).toEqual([])
  })
})

describe('webRootFor', () => {
  it('reads the packaged copy from the resources and the web project build otherwise', () => {
    expect(webRootFor({ isPackaged: true, appPath: '/app', resourcesPath: '/Resources' })).toBe(
      join('/Resources', 'dist'),
    )
    expect(
      webRootFor({
        isPackaged: false,
        appPath: '/repo/apps/raven/desktop',
        resourcesPath: '/Resources',
      }),
    ).toBe('/repo/apps/raven/web/dist')
  })
})

describe('the web host: Host check', () => {
  it.each([
    'localhost:1234',
    '127.0.0.1:47484',
    'evil.example',
    'localhost',
    'localhost:47484.evil.example',
  ])('answers 421 to Host %p and reads nothing', async (name) => {
    const { port, reads } = await host()
    const reply = await ask({ port, path: '/', headers: { [HTTP_HEADERS.host]: name } })
    expect(reply.status).toBe(421)
    expect(reads).toEqual([])
  })

  it('answers 421 to a request for /api from another Host and never forwards it', async () => {
    const server = await upstream()
    const { port } = await host({ serverOrigin: server.origin })
    const reply = await ask({
      port,
      path: AUTH_PATHS.me,
      headers: { [HTTP_HEADERS.host]: 'evil.example:47484' },
    })
    expect(reply.status).toBe(421)
    expect(server.heard).toEqual([])
  })

  it('takes the Host in any case', async () => {
    const { port } = await host()
    const reply = await ask({
      port,
      path: '/',
      headers: { [HTTP_HEADERS.host]: 'LocalHost:47484' },
    })
    expect(reply.status).toBe(200)
  })
})

describe('the web host: the web app', () => {
  it('serves index.html at / with its inline script allowed by hash', async () => {
    const { port } = await host()
    const reply = await ask({ port, path: '/' })
    expect(reply.status).toBe(200)
    expect(reply.body).toBe(INDEX)
    expect(reply.headers[HTTP_HEADERS.contentType]).toBe('text/html; charset=utf-8')
    expect(reply.headers[HTTP_HEADERS.contentSecurityPolicy]).toBe(
      contentSecurityPolicy({ scriptHashes: [THEME_HASH], authOrigin: null }),
    )
    expect(reply.headers[HTTP_HEADERS.contentTypeOptions]).toBe('nosniff')
    expect(reply.headers[HTTP_HEADERS.cacheControl]).toBe('no-cache')
  })

  it("names the test hook's Auth origin in the page's policy", async () => {
    const { port } = await host({ authOrigin: 'http://127.0.0.1:9000' })
    const reply = await ask({ port, path: '/' })
    expect(reply.headers[HTTP_HEADERS.contentSecurityPolicy]).toBe(
      contentSecurityPolicy({ scriptHashes: [THEME_HASH], authOrigin: 'http://127.0.0.1:9000' }),
    )
  })

  it.each([
    ['/assets/app-1a2b.js', 'text/javascript; charset=utf-8'],
    ['/assets/app-1a2b.css', 'text/css; charset=utf-8'],
    ['/assets/font.woff2', 'font/woff2'],
  ])('serves %s as %s, cached for good', async (path, type) => {
    const { port } = await host()
    const reply = await ask({ port, path })
    expect(reply.status).toBe(200)
    expect(reply.headers[HTTP_HEADERS.contentType]).toBe(type)
    expect(reply.headers[HTTP_HEADERS.cacheControl]).toBe('public, max-age=31536000, immutable')
    expect(reply.headers[HTTP_HEADERS.contentSecurityPolicy]).toBe(
      contentSecurityPolicy({ scriptHashes: [], authOrigin: null }),
    )
  })

  it.each([
    ['/favicon.svg', 'image/svg+xml'],
    ['/favicon.ico', 'image/x-icon'],
    ['/brand/raven-icon-512.png', 'image/png'],
    ['/data.bin', 'application/octet-stream'],
  ])('serves %s as %s', async (path, type) => {
    const { port } = await host()
    const reply = await ask({ port, path })
    expect(reply.status).toBe(200)
    expect(reply.headers[HTTP_HEADERS.contentType]).toBe(type)
    expect(reply.headers[HTTP_HEADERS.cacheControl]).toBe('no-cache')
  })

  it.each(['/library/3', '/watch/12?at=30', '/settings/'])(
    'answers the route %s with index.html',
    async (path) => {
      const { port } = await host()
      const reply = await ask({ port, path })
      expect(reply.status).toBe(200)
      expect(reply.body).toBe(INDEX)
      expect(reply.headers[HTTP_HEADERS.contentType]).toBe('text/html; charset=utf-8')
    },
  )

  it('answers a missing asset with 404, never the page', async () => {
    const { port } = await host()
    const reply = await ask({ port, path: '/assets/gone-9z9z.js' })
    expect(reply.status).toBe(404)
    expect(reply.body).not.toBe(INDEX)
  })

  it('treats /apix as a route of the page, not the API', async () => {
    const server = await upstream()
    const { port } = await host({ serverOrigin: server.origin })
    const reply = await ask({ port, path: '/apix' })
    expect(reply.body).toBe(INDEX)
    expect(server.heard).toEqual([])
  })

  it('answers HEAD with the headers and no body', async () => {
    const { port } = await host()
    const reply = await ask({ port, path: '/assets/app-1a2b.js', method: HTTP_METHODS.head })
    expect(reply.status).toBe(200)
    expect(reply.headers[HTTP_HEADERS.contentLength]).toBe('14')
    expect(reply.body).toBe('')
  })

  it.each([HTTP_METHODS.post, HTTP_METHODS.put, HTTP_METHODS.delete])(
    'answers %s with 405',
    async (method) => {
      const { port, reads } = await host()
      const reply = await ask({ port, path: '/index.html', method })
      expect(reply.status).toBe(405)
      expect(reply.headers[HTTP_HEADERS.allow]).toBe('GET, HEAD')
      expect(reads).toEqual([])
    },
  )

  it('answers a malformed escape with 400', async () => {
    const { port, reads } = await host()
    const reply = await ask({ port, path: '/%E0%A4%A' })
    expect(reply.status).toBe(400)
    expect(reads).toEqual([])
  })

  it.each([
    '/..%2fpackage.json',
    '/..%2Fpackage.json',
    '/assets/..%2f..%2fpackage.json',
    '/..%5cpackage.json',
    '/..\\package.json',
    '/../package.json',
    '/%2e%2e/package.json',
    '/%2e%2e%2fpackage.json',
    '/%252e%252e%252fpackage.json',
    '/..%2fweb-evil%2findex.html',
    '/index.html%00.png',
    '//etc/passwd',
    '/%2fetc%2fpasswd',
  ])('never reads outside the build for %s', async (path) => {
    const { port, reads } = await host()
    const reply = await ask({ port, path })
    expect(reply.body).not.toBe('secret')
    expect(reply.body).not.toBe('evil')
    reads.forEach((read) => {
      expect(read.startsWith(`${ROOT}/`)).toBe(true)
    })
  })

  it('refuses a path that climbs out of the build with 403', async () => {
    const { port, reads } = await host()
    const reply = await ask({ port, path: '/..%2fpackage.json' })
    expect(reply.status).toBe(403)
    expect(reads).toEqual([])
  })
})

describe('the web host: /api', () => {
  it('forwards a request to the server, its path, query and cookies included', async () => {
    const server = await upstream()
    const { port } = await host({ serverOrigin: server.origin })
    const reply = await ask({
      port,
      path: '/api/media/3?fields=tracks',
      headers: {
        [HTTP_HEADERS.cookie]: 'raven-auth=abc; raven_unlock=1',
        [HTTP_HEADERS.accept]: 'application/json',
      },
    })
    expect(reply.status).toBe(200)
    expect(reply.body).toBe('{"ok":true}')
    expect(server.heard).toHaveLength(1)
    const [heard] = server.heard
    expect(heard?.method).toBe(HTTP_METHODS.get)
    expect(heard?.url).toBe('/api/media/3?fields=tracks')
    expect(heard?.headers[HTTP_HEADERS.cookie]).toBe('raven-auth=abc; raven_unlock=1')
    expect(heard?.headers[HTTP_HEADERS.accept]).toBe('application/json')
    expect(heard?.headers.host).toBe(new URL(server.origin).host)
  })

  it('forwards /api itself', async () => {
    const server = await upstream()
    const { port } = await host({ serverOrigin: server.origin })
    await ask({ port, path: '/api' })
    expect(server.heard.map(({ url }) => url)).toEqual(['/api'])
  })

  it('sends a body on to the server', async () => {
    const server = await upstream()
    const { port } = await host({ serverOrigin: server.origin })
    await ask({
      port,
      path: '/api/progress',
      method: HTTP_METHODS.post,
      headers: { [HTTP_HEADERS.contentType]: 'application/json' },
      body: '{"position":12}',
    })
    expect(server.heard[0]?.method).toBe(HTTP_METHODS.post)
    expect(server.heard[0]?.body).toBe('{"position":12}')
  })

  it("passes the server's status and headers back untouched, every Set-Cookie included", async () => {
    const server = await upstream(({ response }) => {
      response.writeHead(201, {
        [HTTP_HEADERS.contentType]: 'application/json',
        [HTTP_HEADERS.setCookie]: [
          'raven_unlock=1; Path=/; HttpOnly; SameSite=Lax',
          'raven_admin=2; Path=/api; HttpOnly',
        ],
        [HTTP_HEADERS.cacheControl]: 'private, max-age=60',
      })
      response.end('{}')
    })
    const { port } = await host({ serverOrigin: server.origin })
    const reply = await ask({ port, path: '/api/lock/unlock', method: HTTP_METHODS.post })
    expect(reply.status).toBe(201)
    expect(reply.headers[HTTP_HEADERS.setCookie]).toEqual([
      'raven_unlock=1; Path=/; HttpOnly; SameSite=Lax',
      'raven_admin=2; Path=/api; HttpOnly',
    ])
    expect(reply.headers[HTTP_HEADERS.cacheControl]).toBe('private, max-age=60')
    expect(reply.headers[HTTP_HEADERS.contentSecurityPolicy]).toBeUndefined()
  })

  it('passes a range and its partial answer through', async () => {
    const server = await upstream(({ response }) => {
      response.writeHead(206, {
        [HTTP_HEADERS.contentRange]: 'bytes 0-3/100',
        [HTTP_HEADERS.acceptRanges]: 'bytes',
        [HTTP_HEADERS.contentLength]: '4',
      })
      response.end('abcd')
    })
    const { port } = await host({ serverOrigin: server.origin })
    const reply = await ask({
      port,
      path: '/api/media/3/stream',
      headers: { [HTTP_HEADERS.range]: 'bytes=0-3' },
    })
    expect(server.heard[0]?.headers.range).toBe('bytes=0-3')
    expect(reply.status).toBe(206)
    expect(reply.headers[HTTP_HEADERS.contentRange]).toBe('bytes 0-3/100')
    expect(reply.body).toBe('abcd')
  })

  it('streams server-sent events as they come, and lets go of the server when the page does', async () => {
    const closed = Promise.withResolvers<void>()
    const server = await upstream(({ response }) => {
      response.writeHead(200, { [HTTP_HEADERS.contentType]: 'text/event-stream' })
      response.write('data: first\n\n')
      response.once('close', () => closed.resolve())
    })
    const { port } = await host({ serverOrigin: server.origin })
    const first = await new Promise<string>((resolve, reject) => {
      const outgoing = request(
        {
          host: '127.0.0.1',
          port,
          path: '/api/events',
          headers: { [HTTP_HEADERS.host]: WEB_HOST },
        },
        (response) => {
          response.once('data', (chunk: Buffer) => {
            resolve(chunk.toString())
            outgoing.destroy()
          })
        },
      )
      outgoing.on('error', () => {})
      outgoing.on('close', () => reject(new Error('closed before an event')))
      outgoing.end()
    })
    expect(first).toBe('data: first\n\n')
    await closed.promise
  })

  it('cuts the page off when the server breaks off mid-answer', async () => {
    // Raw bytes, since Bun's own server on Linux drops a destroyed answer before its headers.
    const cutting = createNetServer((socket) => {
      socket.once('data', () => {
        socket.end(`HTTP/1.1 200 OK\r\n${HTTP_HEADERS.contentLength}: 100\r\n\r\nabcd`)
        socket.destroySoon()
      })
    })
    const serverPort = await new Promise<number>((resolve) => {
      cutting.listen(0, '127.0.0.1', () => {
        const address = cutting.address()
        if (address === null || typeof address === 'string') throw new Error('not listening')
        resolve(address.port)
      })
    })
    const { port } = await host({ serverOrigin: `http://127.0.0.1:${serverPort}` })
    const reply = await new Promise<{ status: number; isComplete: boolean }>((resolve) => {
      const outgoing = request(
        {
          host: '127.0.0.1',
          port,
          path: '/api/media/3/file',
          headers: { [HTTP_HEADERS.host]: WEB_HOST },
        },
        (response) => {
          const status = response.statusCode ?? 0
          response.on('error', () => resolve({ status, isComplete: false }))
          response.once('close', () => resolve({ status, isComplete: response.complete }))
          response.resume()
        },
      )
      outgoing.on('error', () => resolve({ status: 0, isComplete: false }))
      outgoing.end()
    })
    cutting.close()
    expect(reply).toEqual({ status: 200, isComplete: false })
  })

  it('lets go of the server when the page breaks off an upload', async () => {
    const reached = Promise.withResolvers<void>()
    const ended = Promise.withResolvers<boolean>()
    const serverPort = await listen((incoming) => {
      incoming.once('data', () => reached.resolve())
      incoming.once('close', () => ended.resolve(incoming.complete))
    })
    const { port } = await host({ serverOrigin: `http://127.0.0.1:${serverPort}` })
    const outgoing = request({
      host: '127.0.0.1',
      port,
      path: '/api/reports',
      method: HTTP_METHODS.post,
      headers: { [HTTP_HEADERS.host]: WEB_HOST, [HTTP_HEADERS.contentLength]: '100' },
    })
    outgoing.on('error', () => {})
    outgoing.write('{"part":')
    await reached.promise
    outgoing.destroy()
    expect(await ended.promise).toBe(false)
  })

  it('keeps the headers a Connection header names to its own hop', async () => {
    const server = await upstream()
    const { port } = await host({ serverOrigin: server.origin })
    await ask({
      port,
      path: AUTH_PATHS.me,
      headers: { [HTTP_HEADERS.connection]: 'x-hop, keep-alive', 'x-hop': 'one', 'x-end': 'two' },
    })
    expect(server.heard[0]?.headers['x-hop']).toBeUndefined()
    expect(server.heard[0]?.headers['x-end']).toBe('two')
  })

  it('answers 502 server_unreachable when the server is down', async () => {
    const { port, warnings } = await host({ serverOrigin: 'http://127.0.0.1:1' })
    const reply = await ask({ port, path: AUTH_PATHS.config })
    expect(reply.status).toBe(502)
    expect(reply.headers[HTTP_HEADERS.contentType]).toBe('application/json')
    expect(JSON.parse(reply.body)).toEqual({ error: WEB_HOST_ERRORS.serverUnreachable })
    expect(warnings).toEqual(['raven player could not reach its server: ECONNREFUSED'])
  })

  it("names why when localhost's two addresses both refuse", async () => {
    const { port, warnings } = await host({ serverOrigin: 'http://localhost:1' })
    const reply = await ask({ port, path: AUTH_PATHS.config })
    expect(reply.status).toBe(502)
    expect(warnings).toEqual(['raven player could not reach its server: ECONNREFUSED'])
  })

  it('tells once that the server is gone, and once that it is back', async () => {
    const parked = createServer()
    await new Promise<void>((resolve) => parked.listen(0, '127.0.0.1', resolve))
    const serverPort = portOf(parked)
    await new Promise<void>((resolve) => parked.close(() => resolve()))
    const { port, warnings, notes } = await host({ serverOrigin: `http://127.0.0.1:${serverPort}` })
    await ask({ port, path: AUTH_PATHS.me })
    await ask({ port, path: AUTH_PATHS.me })
    expect(warnings).toHaveLength(1)
    const back = createServer((_request, response) => response.end('{}'))
    servers.push(back)
    await new Promise<void>((resolve) => back.listen(serverPort, '127.0.0.1', resolve))
    expect((await ask({ port, path: AUTH_PATHS.me })).status).toBe(200)
    await ask({ port, path: AUTH_PATHS.me })
    expect(notes).toEqual(['raven player reached its server again'])
    expect(warnings).toHaveLength(1)
  })

  it('answers 502 server_unreachable when the server takes too long to connect', async () => {
    const server = await upstream()
    const armed: number[] = []
    const { port } = await host({
      serverOrigin: server.origin,
      timers: {
        set: ({ run, ms }) => {
          armed.push(ms)
          run()
          return 1
        },
        clear: () => {},
      },
    })
    const reply = await ask({ port, path: AUTH_PATHS.me })
    expect(armed).toEqual([10_000])
    expect(reply.status).toBe(502)
    expect(JSON.parse(reply.body)).toEqual({ error: WEB_HOST_ERRORS.serverUnreachable })
  })

  it('never lets a request name another host', async () => {
    const server = await upstream()
    const { port } = await host({ serverOrigin: server.origin })
    const reply = await ask({ port, path: '//evil.example/api/me' })
    expect(server.heard).toEqual([])
    expect(reply.status).not.toBe(200)
  })
})

describe('webHostFailureText', () => {
  it('names the port when another app holds it', () => {
    const taken = Object.assign(new Error('listen EADDRINUSE'), {
      code: ERROR_CODES.addressInUse,
      syscall: 'listen',
    })
    expect(webHostFailureText(taken)).toBe(
      'Another app is using port 47484 on this Mac. Quit it, then open raven player again.',
    )
  })

  it('says what failed otherwise', () => {
    const refused = Object.assign(new Error('listen EACCES'), { code: 'EACCES', syscall: 'listen' })
    expect(webHostFailureText(refused)).toBe(
      'raven player could not start serving its page: listen EACCES',
    )
  })
})

describe('listenWebHost', () => {
  const freePort = async () => {
    const server = createServer()
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const port = portOf(server)
    await new Promise<void>((resolve) => server.close(() => resolve()))
    return port
  }

  const tracked = (handler: (request: IncomingMessage, response: ServerResponse) => void) => {
    const server = createServer(handler)
    servers.push(server)
    return server
  }

  it('listens on both loopback addresses', async () => {
    const port = await freePort()
    await listenWebHost({
      createServer: tracked,
      handler: (_request, response) => response.end('raven'),
      port,
      addresses: LOOPBACK_ADDRESSES,
      warn: () => {},
    })
    const answers = await Promise.all(
      ['127.0.0.1', '::1'].map(
        (address) =>
          new Promise<string>((resolve, reject) => {
            const outgoing = request({ host: address, port, path: '/' }, (response) => {
              text(response).then(resolve, reject)
            })
            outgoing.on('error', reject)
            outgoing.end()
          }),
      ),
    )
    expect(answers).toEqual(['raven', 'raven'])
  })

  /** A server that fails to listen on `::1` as a Mac with IPv6 off does, and on nothing else. */
  const withoutIpv6 = (handler: (request: IncomingMessage, response: ServerResponse) => void) => {
    const server = tracked(handler)
    const listenForReal = server.listen.bind(server)
    const failOnIpv6 = (port: number, address: string, onListening: () => void) => {
      if (address !== '::1') return listenForReal(port, address, onListening)
      const missing = Object.assign(new Error('listen EADDRNOTAVAIL'), {
        code: ERROR_CODES.addressNotAvailable,
      })
      queueMicrotask(() => server.emit('error', missing))
      return server
    }
    Object.defineProperty(server, 'listen', { value: failOnIpv6 })
    return server
  }

  it('leaves out an address this Mac does not have, with a warning', async () => {
    const port = await freePort()
    const warnings: string[] = []
    await listenWebHost({
      createServer: withoutIpv6,
      handler: (_request, response) => response.end('raven'),
      port,
      addresses: LOOPBACK_ADDRESSES,
      warn: (message) => warnings.push(message),
    })
    const answer = await new Promise<string>((resolve, reject) => {
      const outgoing = request({ host: '127.0.0.1', port, path: '/' }, (response) => {
        text(response).then(resolve, reject)
      })
      outgoing.on('error', reject)
      outgoing.end()
    })
    expect(answer).toBe('raven')
    expect(warnings).toEqual(['the web host left out ::1, which this Mac does not have'])
  })

  it('fails when it has no address at all', async () => {
    const failure = await listenWebHost({
      createServer: withoutIpv6,
      handler: (_request, response) => response.end(),
      port: await freePort(),
      addresses: ['::1'],
      warn: () => {},
    })
      .then(() => null)
      .catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(Error)
  })

  it('fails when the port is taken, and keeps nothing open', async () => {
    const port = await freePort()
    const taken = createServer()
    servers.push(taken)
    // The second address, so the first has to be let go again.
    await new Promise<void>((resolve) => taken.listen(port, '::1', resolve))
    const failure = await listenWebHost({
      createServer: tracked,
      handler: (_request, response) => response.end(),
      port,
      addresses: LOOPBACK_ADDRESSES,
      warn: () => {},
    })
      .then(() => null)
      .catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(Error)
    expect(failure).toHaveProperty('code', ERROR_CODES.addressInUse)
    const free = createServer()
    servers.push(free)
    await new Promise<void>((resolve, reject) => {
      free.once('error', reject)
      free.listen(port, '127.0.0.1', resolve)
    })
  })
})
