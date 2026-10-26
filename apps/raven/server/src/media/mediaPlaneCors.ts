import type { Type } from '@nestjs/common'
import { HEADERS, HTTP_METHODS } from '@shared/server'
import type { FastifyInstance } from 'fastify'
import { RAVEN_HEADERS } from '@/http'
import { routeMarks } from '@/routeMarks'

/** The CORS headers the media plane reads and sends, in lower case as Node hands incoming ones over. */
export const CORS_HEADERS = {
  origin: 'origin',
  allowOrigin: 'access-control-allow-origin',
  allowMethods: 'access-control-allow-methods',
  allowHeaders: 'access-control-allow-headers',
  allowCredentials: 'access-control-allow-credentials',
  allowPrivateNetwork: 'access-control-allow-private-network',
  exposeHeaders: 'access-control-expose-headers',
  maxAge: 'access-control-max-age',
  requestMethod: 'access-control-request-method',
  requestPrivateNetwork: 'access-control-request-private-network',
} as const

/** What a yes-or-no CORS header says for yes. */
export const CORS_FLAGS = { true: 'true' } as const

/** The methods the media plane answers cross-origin: GET and HEAD, and the preflight. */
const MEDIA_PLANE_METHODS = {
  get: HTTP_METHODS.get,
  head: HTTP_METHODS.head,
  options: HTTP_METHODS.options,
} as const

/** How `Vary` names the header a CORS answer depends on. */
const VARIES = { origin: 'Origin' } as const

/** The path of every route marked for the media plane. */
export const mediaPlanePaths = (controllers: readonly Type[]): string[] =>
  routeMarks(controllers).flatMap(({ path, mediaPlane }) => (mediaPlane ? [path] : []))

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const segmentPattern = (segment: string): string =>
  segment.startsWith(':') ? '[^/]+' : escapeRegExp(segment)

/** Whether a request URL is one of `paths`, where a `:name` segment is any one non-empty segment; the query is ignored. */
export const pathMatcher = (paths: readonly string[]): ((path: string) => boolean) => {
  const patterns = paths.map(
    (path) => new RegExp(`^${path.split('/').map(segmentPattern).join('/')}$`),
  )
  return (path) => {
    const pathname = path.split('?')[0] ?? ''
    return patterns.some((pattern) => pattern.test(pathname))
  }
}

export const responseHeaders = (origin: string): Record<string, string> => ({
  [CORS_HEADERS.allowOrigin]: origin,
  [HEADERS.vary]: VARIES.origin,
  [CORS_HEADERS.exposeHeaders]: [
    HEADERS.contentLength,
    HEADERS.contentRange,
    RAVEN_HEADERS.acceptRanges,
  ].join(', '),
})

type PreflightHeadersProps = {
  origin: string
  wantsPrivateNetwork: boolean
}

export const preflightHeaders = ({
  origin,
  wantsPrivateNetwork,
}: PreflightHeadersProps): Record<string, string> => ({
  [CORS_HEADERS.allowOrigin]: origin,
  [HEADERS.vary]: VARIES.origin,
  [CORS_HEADERS.allowMethods]: Object.values(MEDIA_PLANE_METHODS).join(', '),
  [CORS_HEADERS.allowHeaders]: HEADERS.range,
  [CORS_HEADERS.maxAge]: '600',
  ...(wantsPrivateNetwork ? { [CORS_HEADERS.allowPrivateNetwork]: CORS_FLAGS.true } : {}),
})

const withOrigin = (existing: string | number | string[] | undefined): string => {
  const current = Array.isArray(existing) ? existing.join(', ') : String(existing ?? '')
  const names = current.split(',').map((name) => name.trim().toLowerCase())
  if (names.includes(CORS_HEADERS.origin)) return current
  return current === '' ? VARIES.origin : `${current}, ${VARIES.origin}`
}

type RegisterMediaPlaneCorsProps = {
  fastify: FastifyInstance
  isMediaPlanePath: (path: string) => boolean
  isAllowedOrigin: (origin: string | undefined) => boolean
}

/**
 * Lets the web origins call the media plane routes from another origin: it
 * answers their preflight and puts the CORS headers on the reply, so a 423
 * is one the page can read. Credentials are never allowed; a ticket in the
 * address stands in for the cookie. Any other route, method or origin is
 * left alone.
 */
export const registerMediaPlaneCors = ({
  fastify,
  isMediaPlanePath,
  isAllowedOrigin,
}: RegisterMediaPlaneCorsProps): void => {
  fastify.addHook('onRequest', async (request, reply) => {
    const { origin } = request.headers
    if (origin === undefined || !isAllowedOrigin(origin) || !isMediaPlanePath(request.url)) return
    if (request.method === MEDIA_PLANE_METHODS.options) {
      const wantsPrivateNetwork =
        request.headers[CORS_HEADERS.requestPrivateNetwork] === CORS_FLAGS.true
      return reply.headers(preflightHeaders({ origin, wantsPrivateNetwork })).code(204).send()
    }
    if (request.method !== MEDIA_PLANE_METHODS.get && request.method !== MEDIA_PLANE_METHODS.head) {
      return
    }
    reply.headers({
      ...responseHeaders(origin),
      [HEADERS.vary]: withOrigin(reply.getHeader(HEADERS.vary)),
    })
  })
}
