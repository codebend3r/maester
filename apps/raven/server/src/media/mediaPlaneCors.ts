import type { Type } from '@nestjs/common'
import type { FastifyInstance } from 'fastify'
import { routeMarks } from '@/routeMarks'

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
  'access-control-allow-origin': origin,
  vary: 'Origin',
  'access-control-expose-headers': 'content-length, content-range, accept-ranges',
})

export const preflightHeaders = ({
  origin,
  wantsPrivateNetwork,
}: {
  origin: string
  wantsPrivateNetwork: boolean
}): Record<string, string> => ({
  'access-control-allow-origin': origin,
  vary: 'Origin',
  'access-control-allow-methods': 'GET, HEAD, OPTIONS',
  'access-control-allow-headers': 'range',
  'access-control-max-age': '600',
  ...(wantsPrivateNetwork ? { 'access-control-allow-private-network': 'true' } : {}),
})

const withOrigin = (existing: string | number | string[] | undefined): string => {
  const current = Array.isArray(existing) ? existing.join(', ') : String(existing ?? '')
  const names = current.split(',').map((name) => name.trim().toLowerCase())
  if (names.includes('origin')) return current
  return current === '' ? 'Origin' : `${current}, Origin`
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
}: {
  fastify: FastifyInstance
  isMediaPlanePath: (path: string) => boolean
  isAllowedOrigin: (origin: string | undefined) => boolean
}): void => {
  fastify.addHook('onRequest', async (request, reply) => {
    const { origin } = request.headers
    if (origin === undefined || !isAllowedOrigin(origin) || !isMediaPlanePath(request.url)) return
    if (request.method === 'OPTIONS') {
      const wantsPrivateNetwork =
        request.headers['access-control-request-private-network'] === 'true'
      return reply.headers(preflightHeaders({ origin, wantsPrivateNetwork })).code(204).send()
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') return
    reply.headers({ ...responseHeaders(origin), vary: withOrigin(reply.getHeader('vary')) })
  })
}
