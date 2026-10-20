/** The HTTP statuses main reads off a server's answers or gives mpv. */
export const HTTP_STATUSES = {
  ok: 200,
  partialContent: 206,
  unauthorized: 401,
  forbidden: 403,
  notFound: 404,
  tooManyRequests: 429,
  badGateway: 502,
  unavailable: 503,
} as const
