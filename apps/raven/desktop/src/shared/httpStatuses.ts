/** The HTTP statuses main reads off a server's answers, gives mpv or answers the page with. */
export const HTTP_STATUSES = {
  ok: 200,
  partialContent: 206,
  badRequest: 400,
  unauthorized: 401,
  forbidden: 403,
  notFound: 404,
  methodNotAllowed: 405,
  misdirected: 421,
  tooManyRequests: 429,
  badGateway: 502,
  unavailable: 503,
} as const

/** Whether a status is a 2xx: the server took the request. */
export const isSuccessStatus = (status: number): boolean => status >= 200 && status < 300
