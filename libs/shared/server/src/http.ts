/** Header names in lower case, as Node hands incoming ones over, so they index `request.headers` too. */
export const HEADERS = {
  accept: 'accept',
  acceptEncoding: 'accept-encoding',
  cacheControl: 'cache-control',
  contentEncoding: 'content-encoding',
  contentLength: 'content-length',
  contentRange: 'content-range',
  contentType: 'content-type',
  range: 'range',
  setCookie: 'set-cookie',
  vary: 'vary',
  xNoCompression: 'x-no-compression',
} as const

export const CONTENT_TYPES = {
  eventStream: 'text/event-stream',
  html: 'text/html; charset=utf-8',
  json: 'application/json',
  octetStream: 'application/octet-stream',
  vtt: 'text/vtt; charset=utf-8',
} as const

/** `Cache-Control` values: `immutable` for fingerprinted files, `noCache` for what changes under the same name. */
export const CACHE_POLICIES = {
  immutable: 'public, max-age=31536000, immutable',
  noCache: 'no-cache',
  noStore: 'no-store',
} as const

export const HTTP_METHODS = { get: 'GET', head: 'HEAD', options: 'OPTIONS', post: 'POST' } as const
