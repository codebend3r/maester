import { describe, expect, it } from 'bun:test'
import { CONTENT_SECURITY_POLICY, createAppHandler } from '@/main/appProtocol'

const ROOT = '/opt/raven/renderer'

const setup = (files: Record<string, string>) => {
  const reads: string[] = []
  const handler = createAppHandler({
    root: ROOT,
    readFile: async (path) => {
      reads.push(path)
      const body = files[path]
      if (body === undefined) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      return new TextEncoder().encode(body)
    },
  })
  return { handler, reads }
}

const FILES = {
  [`${ROOT}/index.html`]: '<html>raven</html>',
  [`${ROOT}/assets/app-1a2b.js`]: 'console.log(1)',
  [`${ROOT}/assets/app-1a2b.css`]: 'a{}',
  [`${ROOT}/favicon.svg`]: '<svg/>',
  [`${ROOT}/manifest.json`]: '{}',
  [`${ROOT}/logo.png`]: 'png',
  [`${ROOT}/favicon.ico`]: 'ico',
  [`${ROOT}/font.woff2`]: 'w2',
  [`${ROOT}/font.woff`]: 'w1',
  [`${ROOT}/data.bin`]: 'bin',
  [`${ROOT}/a.constructor`]: 'c',
  [`${ROOT}/a.__proto__`]: 'p',
  [`${ROOT}/UPPER.JS`]: 'x',
  '/opt/raven/package.json': 'secret',
  '/opt/raven/renderer-evil/index.html': 'evil',
}

const expectGuarded = (response: Response) => {
  expect(response.headers.get('Content-Security-Policy')).toBe(CONTENT_SECURITY_POLICY)
  expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
}

describe('CONTENT_SECURITY_POLICY', () => {
  it('is the exact policy', () => {
    expect(CONTENT_SECURITY_POLICY).toBe(
      "default-src 'self'; img-src 'self' data:; media-src 'self' raven-file:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    )
  })
})

describe('app handler serving', () => {
  it('serves index.html at / and /index.html', async () => {
    const { handler } = setup(FILES)
    const [root, index] = await Promise.all([
      handler(new Request('app://raven/')),
      handler(new Request('app://raven/index.html')),
    ])
    expect(root.status).toBe(200)
    expect(await root.text()).toBe('<html>raven</html>')
    expect(root.headers.get('Content-Type')).toBe('text/html; charset=utf-8')
    expectGuarded(root)
    expect(index.status).toBe(200)
    expect(await index.text()).toBe('<html>raven</html>')
    expectGuarded(index)
  })

  it('serves the origin with no path as index.html', async () => {
    const { handler } = setup(FILES)
    const response = await handler(new Request('app://raven'))
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('<html>raven</html>')
  })

  it.each([
    ['/assets/app-1a2b.js', 'text/javascript; charset=utf-8'],
    ['/assets/app-1a2b.css', 'text/css; charset=utf-8'],
    ['/favicon.svg', 'image/svg+xml'],
    ['/manifest.json', 'application/json'],
    ['/logo.png', 'image/png'],
    ['/favicon.ico', 'image/x-icon'],
    ['/font.woff2', 'font/woff2'],
    ['/font.woff', 'font/woff'],
    ['/data.bin', 'application/octet-stream'],
    ['/a.constructor', 'application/octet-stream'],
    ['/a.__proto__', 'application/octet-stream'],
    ['/UPPER.JS', 'text/javascript; charset=utf-8'],
  ])('types %s as %s', async (path, type) => {
    const { handler } = setup(FILES)
    const response = await handler(new Request(`app://raven${path}`))
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe(type)
    expectGuarded(response)
  })

  it('ignores the query string and the fragment', async () => {
    const { handler } = setup(FILES)
    const response = await handler(new Request('app://raven/assets/app-1a2b.js?v=3#x'))
    expect(response.status).toBe(200)
  })

  it('answers HEAD with the headers and no body', async () => {
    const { handler } = setup(FILES)
    const response = await handler(new Request('app://raven/index.html', { method: 'HEAD' }))
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('text/html; charset=utf-8')
    expectGuarded(response)
    expect(await response.text()).toBe('')
  })
})

describe('app handler refusals', () => {
  it('404s another host, with the policy', async () => {
    const { handler, reads } = setup(FILES)
    const response = await handler(new Request('app://other/index.html'))
    expect(response.status).toBe(404)
    expectGuarded(response)
    expect(reads).toEqual([])
  })

  it.each(['app://evil@raven/index.html', 'app://user:pass@raven/index.html'])(
    '404s a URL with credentials: %s',
    async (url) => {
      const { handler, reads } = setup(FILES)
      const response = await handler(new Request(url))
      expect(response.status).toBe(404)
      expectGuarded(response)
      expect(reads).toEqual([])
    },
  )

  it('404s a lookalike host', async () => {
    const { handler, reads } = setup(FILES)
    const response = await handler(new Request('app://raven.evil/index.html'))
    expect(response.status).toBe(404)
    expect(reads).toEqual([])
  })

  it.each(['POST', 'PUT', 'DELETE', 'PATCH'])('405s %s, with the policy', async (method) => {
    const { handler, reads } = setup(FILES)
    const response = await handler(new Request('app://raven/index.html', { method }))
    expect(response.status).toBe(405)
    expectGuarded(response)
    expect(reads).toEqual([])
  })

  it('404s a missing file and still carries the policy', async () => {
    const { handler } = setup(FILES)
    const response = await handler(new Request('app://raven/nope.js'))
    expect(response.status).toBe(404)
    expectGuarded(response)
  })

  it('404s a directory the reader cannot read', async () => {
    const { handler } = setup(FILES)
    const response = await handler(new Request('app://raven/assets/'))
    expect(response.status).toBe(404)
    expectGuarded(response)
  })

  it('400s a malformed escape, with the policy', async () => {
    const { handler, reads } = setup(FILES)
    const response = await handler(new Request('app://raven/%E0%A4%A'))
    expect(response.status).toBe(400)
    expectGuarded(response)
    expect(reads).toEqual([])
  })
})

describe('app handler traversal', () => {
  const attacks = [
    '/%2e%2e/package.json',
    '/%2E%2E/package.json',
    '/..%2fpackage.json',
    '/..%2Fpackage.json',
    '/assets/%2e%2e%2f%2e%2e%2fsecret',
    '/assets/%2e%2e/%2e%2e/package.json',
    '/../package.json',
    '/assets/../../package.json',
    '/%2e%2e%2f%2e%2e%2fetc%2fpasswd',
    '/..%5cpackage.json',
    '/assets%5c..%5c..%5cpackage.json',
    '/%5c..%5cpackage.json',
    '/..\\package.json',
    '/%252e%252e/package.json',
    '/%252e%252e%252fpackage.json',
    '/..%252fpackage.json',
    '/index.html%00.png',
    '/%00',
    '/..%00/package.json',
    '/%2e%2e%2frenderer-evil/index.html',
    '/..%2frenderer-evil/index.html',
    '//etc/passwd',
    '/%2fetc%2fpasswd',
    '/%2f%2fetc/passwd',
    '/%2e%2e%2f',
  ]

  it.each(attacks)('never serves %s, and never reads outside the root', async (path) => {
    const { handler, reads } = setup(FILES)
    const response = await handler(new Request(`app://raven${path}`))
    expect(response.status).not.toBe(200)
    expectGuarded(response)
    reads.forEach((read) => {
      expect(read === ROOT || read.startsWith(`${ROOT}/`)).toBe(true)
    })
  })

  it('refuses a decoded escape with 403 and reads nothing', async () => {
    const { handler, reads } = setup(FILES)
    const response = await handler(new Request('app://raven/..%2fpackage.json'))
    expect([403, 404]).toContain(response.status)
    expect(reads).toEqual([])
  })

  it('refuses a sibling folder sharing the root as a prefix', async () => {
    const { handler, reads } = setup(FILES)
    const response = await handler(new Request('app://raven/..%2frenderer-evil%2findex.html'))
    expect(response.status).not.toBe(200)
    expect(reads).toEqual([])
  })

  it('treats a double-encoded name as a plain missing file', async () => {
    const { handler, reads } = setup(FILES)
    const response = await handler(new Request('app://raven/%252e%252e/package.json'))
    expect(response.status).toBe(404)
    expect(reads.every((read) => read.startsWith(`${ROOT}/`))).toBe(true)
  })

  it('400s a NUL byte without reading', async () => {
    const { handler, reads } = setup(FILES)
    const response = await handler(new Request('app://raven/index.html%00.png'))
    expect(response.status).toBe(400)
    expect(reads).toEqual([])
  })
})
