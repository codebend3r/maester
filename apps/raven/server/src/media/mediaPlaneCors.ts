import type { Type } from '@nestjs/common'
import { HEADERS, HTTP_METHODS } from '@shared/server'
import type { FastifyInstance } from 'fastify'
import { type AllowedOriginCheck, type CorsPolicy, answerPreflight, responseHeaders } from '@/cors'
import { routeMarks } from '@/routeMarks'

/** The methods the media plane answers cross-origin: GET and HEAD, and the preflight. */
const MEDIA_PLANE_METHODS = {
  get: HTTP_METHODS.get,
  head: HTTP_METHODS.head,
  options: HTTP_METHODS.options,
} as const

/**
 * What the media plane allows another origin: its methods, the `Range` a
 * player seeks with, and the headers a player reads off the answer.
 */
export const MEDIA_PLANE_CORS = {
  methods: Object.values(MEDIA_PLANE_METHODS),
  requestHeaders: [HEADERS.range],
  exposedHeaders: [HEADERS.contentLength, HEADERS.contentRange, HEADERS.acceptRanges],
} as const satisfies CorsPolicy

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

const isMediaPlaneMethod = (method: string): boolean =>
  Object.values(MEDIA_PLANE_METHODS).some((allowed) => allowed === method)

/** The origin of a `Referer`, or null for a missing or malformed one. */
const refererOrigin = (referer: string | string[] | undefined): string | null => {
  const value = Array.isArray(referer) ? referer[0] : referer
  if (value === undefined || !URL.canParse(value)) return null
  return new URL(value).origin
}

type RegisterMediaPlaneHookProps = {
  fastify: FastifyInstance
  isMediaPlanePath: (path: string) => boolean
  isAllowedOrigin: AllowedOriginCheck
  /** Told the web origin whose `/api` proxy a media request came through. */
  onProxied: (webOrigin: string) => void
}

/**
 * Lets the web origins call the media plane routes from another origin: it
 * answers their preflight and puts the CORS headers on the reply, so a 423
 * is one the page can read. Credentials are never allowed; a ticket in the
 * address stands in for the cookie. A page on a media origin sends `Origin`;
 * a page whose `/api` proxy forwards the request sends none, since to the
 * browser it is the same origin, but the `Referer` the proxy passes on still
 * names the page's origin, one of the web origins, and `onProxied` hears it.
 * The ping never comes that way: the probe always fetches it cross-origin.
 * Any other route, method or origin is left alone.
 */
export const registerMediaPlaneHook = ({
  fastify,
  isMediaPlanePath,
  isAllowedOrigin,
  onProxied,
}: RegisterMediaPlaneHookProps): void => {
  fastify.addHook('onRequest', async (request, reply) => {
    if (!isMediaPlaneMethod(request.method) || !isMediaPlanePath(request.url)) return
    const { origin } = request.headers
    if (origin === undefined) {
      const webOrigin = refererOrigin(request.headers[HEADERS.referer])
      if (webOrigin !== null && isAllowedOrigin(webOrigin)) onProxied(webOrigin)
      return
    }
    if (!isAllowedOrigin(origin)) return
    if (request.method === MEDIA_PLANE_METHODS.options) {
      return answerPreflight({ request, reply, origin, policy: MEDIA_PLANE_CORS })
    }
    if (request.method !== MEDIA_PLANE_METHODS.get && request.method !== MEDIA_PLANE_METHODS.head) {
      return
    }
    reply.headers(
      responseHeaders({
        origin,
        policy: MEDIA_PLANE_CORS,
        vary: reply.getHeader(HEADERS.vary),
      }),
    )
  })
}
