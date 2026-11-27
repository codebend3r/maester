import { afterEach, describe, expect, it } from 'bun:test'
import { createHash } from 'node:crypto'
import {
  type IncomingMessage,
  type Server,
  type ServerResponse,
  createServer,
  request,
} from 'node:http'
import { text } from 'node:stream/consumers'

import { ERROR_CODES } from '@/errors'
import {
  LOOPBACK_ADDRESSES,
  contentSecurityPolicy,
  inlineHashesOf,
  listenWebHost,
  webRootFor,
} from '@/webHost'

const THEME_SCRIPT = "\n      document.documentElement.dataset.theme = 'dusk'\n    "
const LOADER_STYLE = '.boot-loader{display:grid}'
const INDEX = `<html><head><script>${THEME_SCRIPT}</script><style>${LOADER_STYLE}</style><script type="module" src="/assets/app.js"></script></head></html>`
const sha256 = (body: string) => createHash('sha256').update(body).digest('base64')
const INDEX_HASHES = { scripts: [sha256(THEME_SCRIPT)], styles: [sha256(LOADER_STYLE)] }
const NO_HASHES = { scripts: [], styles: [] }
const NO_SOURCES = { images: [], media: [], connections: [] }

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

describe('contentSecurityPolicy', () => {
  it("allows the page its own origin, Supabase Auth, an app's sources and its inline scripts and styles", () => {
    expect(
      contentSecurityPolicy({
        inlineHashes: { scripts: ['abc='], styles: ['def='] },
        sources: { images: ['pic:'], media: ['file:'], connections: ['http://127.0.0.1:9000'] },
      }),
    ).toBe(
      "default-src 'self'; script-src 'self' 'sha256-abc='; style-src 'self' 'sha256-def='; font-src 'self'; img-src 'self' data: pic:; media-src 'self' file:; connect-src 'self' https://*.supabase.co http://127.0.0.1:9000; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    )
  })

  it('allows no inline script or style when there is none', () => {
    const policy = contentSecurityPolicy({ inlineHashes: NO_HASHES, sources: NO_SOURCES })
    expect(policy).toContain("script-src 'self';")
    expect(policy).toContain("media-src 'self';")
  })
})

describe('inlineHashesOf', () => {
  it('recognises script and style tags in any case without changing the body being hashed', () => {
    expect(
      inlineHashesOf(`<SCRIPT>${THEME_SCRIPT}</sCrIpT><STYLE>${LOADER_STYLE}</sTyLe>`),
    ).toEqual(INDEX_HASHES)
  })
  it('hashes each inline script and style and skips the ones loaded from a file', () => {
    expect(inlineHashesOf(INDEX)).toEqual(INDEX_HASHES)
    expect(inlineHashesOf('<script>a</script><p></p><script>b</script><style>c</style>')).toEqual({
      scripts: [sha256('a'), sha256('b')],
      styles: [sha256('c')],
    })
    expect(inlineHashesOf('<html></html>')).toEqual(NO_HASHES)
  })
})

describe('webRootFor', () => {
  it('reads the packaged copy from the resources and the web project build otherwise', () => {
    const where = {
      appPath: '/repo/apps/raven/desktop',
      resourcesPath: '/Resources',
      webDist: '../web/dist',
    }
    expect(webRootFor({ ...where, isPackaged: true })).toBe('/Resources/dist')
    expect(webRootFor({ ...where, isPackaged: false })).toBe('/repo/apps/raven/web/dist')
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

  it('leaves out an address this computer does not have, with a warning', async () => {
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
    expect(warnings).toEqual(['the web host left out ::1, which this computer does not have'])
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
