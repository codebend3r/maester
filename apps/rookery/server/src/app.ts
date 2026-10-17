import { NestFactory } from '@nestjs/core'
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'
import {
  CONTENT_TYPES,
  HEADERS,
  HTTP_METHODS,
  compressResponses,
  serveWebApp,
  CACHE_POLICIES,
} from '@shared/server'
import { AppModule } from '@/appModule'
import { type Clock, systemClock } from '@/clock'
import type { ServerConfig } from '@/config'
import { HttpPlexTv, type PlexTv } from '@/plex/plexTv'

/** The methods that never write, so they need no JSON body. */
const READ_METHODS = {
  get: HTTP_METHODS.get,
  head: HTTP_METHODS.head,
  options: HTTP_METHODS.options,
} as const
const READS = new Set<string>(Object.values(READ_METHODS))
// Where the server's own routes live: never cached, and a miss under one is a
// JSON 404 rather than the web app.
const SERVER_PREFIXES = ['/api/', '/internal/', '/auth/']

/** Why a write was refused before reaching its route. */
export const WRITE_ERRORS = { jsonRequired: 'json_required' } as const

/**
 * The configured application, not yet listening, so a test can drive it
 * through `inject` exactly as `main.ts` serves it.
 */
export const createApp = async ({
  config,
  plexTv = new HttpPlexTv(),
  clock = systemClock,
  quiet = false,
}: {
  config: ServerConfig
  plexTv?: PlexTv
  clock?: Clock
  quiet?: boolean
}): Promise<NestFastifyApplication> => {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule.register({ config, plexTv, clock }),
    new FastifyAdapter(),
    { logger: quiet ? false : ['log', 'warn', 'error'] },
  )

  const fastify = app.getHttpAdapter().getInstance()
  // Every write is JSON. A page on a sibling subdomain can only send a
  // credentialed JSON request after a CORS preflight, which rookery never
  // answers, so this is its CSRF protection along with SameSite=Lax.
  fastify.addHook('onRequest', async (request, reply) => {
    if (SERVER_PREFIXES.some((prefix) => request.url.startsWith(prefix))) {
      reply.header(HEADERS.cacheControl, CACHE_POLICIES.noStore)
    }
    const type = request.headers[HEADERS.contentType]?.toLowerCase() ?? ''
    // Returning the reply ends the request here instead of running the route.
    if (!READS.has(request.method) && !type.startsWith(CONTENT_TYPES.json)) {
      return reply.code(415).send({ reason: WRITE_ERRORS.jsonRequired })
    }
    return undefined
  })

  await compressResponses({ app })
  // In Docker the server hands out the built web app too, so there is one
  // port. In development Vite serves it and proxies the server's routes here.
  await serveWebApp({ app, webDir: config.webDir, serverPrefixes: SERVER_PREFIXES })
  app.enableShutdownHooks()
  return app
}
