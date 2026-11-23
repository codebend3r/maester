import { AUTH_API_PREFIX } from '@raven/core'
import { HEADERS, HTTP_METHODS } from '@shared/server'
import type { FastifyInstance } from 'fastify'
import { type AllowedOriginCheck, type CorsPolicy, answerPreflight, responseHeaders } from '@/cors'

/** What a page on another origin may call the JSON API with: its methods, and its Bearer and a JSON body's type. */
const API_CORS = {
  methods: [
    HTTP_METHODS.get,
    HTTP_METHODS.head,
    HTTP_METHODS.post,
    HTTP_METHODS.put,
    HTTP_METHODS.delete,
  ],
  requestHeaders: [HEADERS.authorization, HEADERS.contentType],
  exposedHeaders: [],
} as const satisfies CorsPolicy

type RegisterApiCorsHookProps = {
  fastify: FastifyInstance
  /** The media plane's routes, which answer CORS on their own terms (`registerMediaPlaneHook`). */
  isMediaPlanePath: (path: string) => boolean
  isAllowedOrigin: AllowedOriginCheck
}

/**
 * Lets the web origins call the JSON API from another origin, so a page
 * served by one raven (or Netlify, or Vite in development) can reach another
 * with the account's Bearer. It answers their preflight and puts the CORS
 * headers on every reply, a refusal included. Credentials are never
 * allowed: no cookie crosses, so the Bearer is the only way in, and the
 * PIN's unlock cookie stays with the origin that set it. The headers go on
 * the raw response as well, since Nest writes the event stream's head
 * itself and never sends Fastify's. A same-origin request (no `Origin`), a
 * foreign origin and the media plane's routes are left alone.
 */
export const registerApiCorsHook = ({
  fastify,
  isMediaPlanePath,
  isAllowedOrigin,
}: RegisterApiCorsHookProps): void => {
  fastify.addHook('onRequest', async (request, reply) => {
    const { origin } = request.headers
    if (origin === undefined || !isAllowedOrigin(origin)) return
    if (!request.url.startsWith(AUTH_API_PREFIX) || isMediaPlanePath(request.url)) return
    if (request.method === HTTP_METHODS.options) {
      return answerPreflight({ request, reply, origin, policy: API_CORS })
    }
    const headers = responseHeaders({
      origin,
      policy: API_CORS,
      vary: reply.getHeader(HEADERS.vary),
    })
    Object.entries(headers).forEach(([name, value]) => reply.raw.setHeader(name, value))
    reply.headers(headers)
  })
}
