import { basename, resolve, sep } from 'node:path'
import { extensionOf } from '@raven/core'
import { isAppUrl } from '@/main/security'

export const CONTENT_SECURITY_POLICY =
  "default-src 'self'; img-src 'self' data:; media-src 'self' raven-file:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"

const CONTENT_TYPES = new Map(
  Object.entries({
    html: 'text/html; charset=utf-8',
    js: 'text/javascript; charset=utf-8',
    css: 'text/css; charset=utf-8',
    svg: 'image/svg+xml',
    json: 'application/json',
    png: 'image/png',
    ico: 'image/x-icon',
    woff2: 'font/woff2',
    woff: 'font/woff',
  }),
)

const contentTypeOf = (fileName: string): string =>
  CONTENT_TYPES.get(extensionOf(fileName)) ?? 'application/octet-stream'

const answer = ({
  status,
  body = null,
  headers = {},
}: {
  status: number
  body?: Uint8Array | null
  headers?: Record<string, string>
}): Response =>
  new Response(body, {
    status,
    headers: {
      ...headers,
      'Content-Security-Policy': CONTENT_SECURITY_POLICY,
      'X-Content-Type-Options': 'nosniff',
    },
  })

const parse = (url: string): URL | null => {
  try {
    return new URL(url)
  } catch {
    return null
  }
}

const decode = (pathname: string): string | null => {
  try {
    return decodeURIComponent(pathname)
  } catch {
    return null
  }
}

const isInside = ({ root, path }: { root: string; path: string }): boolean =>
  path === root || path.startsWith(root.endsWith(sep) ? root : `${root}${sep}`)

export const createAppHandler = ({
  root,
  readFile,
}: {
  root: string
  readFile: (path: string) => Promise<Uint8Array>
}): ((request: Request) => Promise<Response>) => {
  const base = resolve(root)

  return async (request) => {
    const url = parse(request.url)
    if (url === null) return answer({ status: 400 })
    if (!isAppUrl(request.url)) return answer({ status: 404 })
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return answer({ status: 405, headers: { Allow: 'GET, HEAD' } })
    }

    const decoded = decode(url.pathname)
    if (decoded === null || decoded.includes('\0')) return answer({ status: 400 })
    // A backslash separates path segments on Windows, so it never belongs in a name here.
    if (decoded.includes('\\')) return answer({ status: 403 })

    const relative = decoded === '/' || decoded === '' ? 'index.html' : decoded.replace(/^\/+/, '')
    const path = resolve(base, relative)
    if (!isInside({ root: base, path })) return answer({ status: 403 })

    const bytes = await readFile(path).catch(() => null)
    if (bytes === null) return answer({ status: 404 })

    return answer({
      status: 200,
      body: request.method === 'HEAD' ? null : bytes,
      headers: {
        'Content-Type': contentTypeOf(basename(path)),
        'Content-Length': `${bytes.byteLength}`,
      },
    })
  }
}
