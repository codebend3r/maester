/** Header names in lower case, as Node hands incoming ones over, so they index `request.headers` too. */
export const HEADERS = {
  accept: 'accept',
  acceptEncoding: 'accept-encoding',
  acceptRanges: 'accept-ranges',
  allow: 'allow',
  authorization: 'authorization',
  cacheControl: 'cache-control',
  connection: 'connection',
  contentEncoding: 'content-encoding',
  contentLength: 'content-length',
  contentRange: 'content-range',
  contentSecurityPolicy: 'content-security-policy',
  contentType: 'content-type',
  contentTypeOptions: 'x-content-type-options',
  cookie: 'cookie',
  etag: 'etag',
  forwardedFor: 'x-forwarded-for',
  host: 'host',
  keepAlive: 'keep-alive',
  link: 'link',
  location: 'location',
  proxyAuthenticate: 'proxy-authenticate',
  proxyAuthorization: 'proxy-authorization',
  range: 'range',
  referer: 'referer',
  retryAfter: 'retry-after',
  setCookie: 'set-cookie',
  te: 'te',
  trailer: 'trailer',
  transferEncoding: 'transfer-encoding',
  upgrade: 'upgrade',
  userAgent: 'user-agent',
  vary: 'vary',
} as const

export const CONTENT_TYPES = {
  eventStream: 'text/event-stream',
  /** A form body, as `application/x-www-form-urlencoded` APIs take it. */
  form: 'application/x-www-form-urlencoded',
  html: 'text/html; charset=utf-8',
  json: 'application/json',
  /** An HLS playlist. */
  m3u8: 'application/vnd.apple.mpegurl',
  octetStream: 'application/octet-stream',
  vtt: 'text/vtt; charset=utf-8',
} as const

/** `Cache-Control` values: `immutable` for fingerprinted files, `noCache` for what changes under the same name. */
export const CACHE_POLICIES = {
  immutable: 'public, max-age=31536000, immutable',
  noCache: 'no-cache',
  noStore: 'no-store',
} as const

export const HTTP_METHODS = {
  get: 'GET',
  head: 'HEAD',
  options: 'OPTIONS',
  post: 'POST',
  put: 'PUT',
  delete: 'DELETE',
} as const

export type HttpMethod = (typeof HTTP_METHODS)[keyof typeof HTTP_METHODS]

export const HTTP_STATUSES = {
  ok: 200,
  noContent: 204,
  partialContent: 206,
  seeOther: 303,
  badRequest: 400,
  unauthorized: 401,
  forbidden: 403,
  notFound: 404,
  methodNotAllowed: 405,
  conflict: 409,
  locked: 423,
  unsupportedMediaType: 415,
  rangeNotSatisfiable: 416,
  misdirected: 421,
  tooManyRequests: 429,
  internalServerError: 500,
  badGateway: 502,
  unavailable: 503,
} as const

/** Whether a status is a 2xx: the server took the request. */
export const isSuccessStatus = (status: number): boolean => status >= 200 && status < 300

/** Whether a status is a 5xx: the server, or a proxy in front of it, failed. */
export const isServerErrorStatus = (status: number): boolean => status >= 500 && status < 600
