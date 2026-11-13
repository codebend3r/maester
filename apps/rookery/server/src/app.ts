import { NestFactory } from '@nestjs/core'
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'
import { SERVER_PATHS, WRITE_ERRORS } from '@rookery/core'
import {
  CACHE_POLICIES,
  CONTENT_TYPES,
  HEADERS,
  HTTP_METHODS,
  HTTP_STATUSES,
  compressResponses,
  serveWebApp,
} from '@shared/server'
import { AppModule } from '@/appModule'
import { DEFAULT_PIN_CHECK, type PinCheck } from '@/auth/signInService'
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

/** Nest's log levels the server prints when it is not quiet. */
const LOG_LEVELS = { log: 'log', warn: 'warn', error: 'error' } as const

type CreateAppProps = {
  config: ServerConfig
  plexTv?: PlexTv
  clock?: Clock
  pinCheck?: PinCheck
  isQuiet?: boolean
}

/**
 * The configured application, not yet listening, so a test can drive it
 * through `inject` exactly as `main.ts` serves it.
 */
export const createApp = async ({
  config,
  plexTv = new HttpPlexTv(),
  clock = systemClock,
  pinCheck = DEFAULT_PIN_CHECK,
  isQuiet = false,
}: CreateAppProps): Promise<NestFastifyApplication> => {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule.register({ config, plexTv, clock, pinCheck }),
    new FastifyAdapter(),
    { logger: isQuiet ? false : Object.values(LOG_LEVELS) },
  )

  const fastify = app.getHttpAdapter().getInstance()
  /*
   * Every write is JSON. A page on a sibling subdomain can only send a
   * credentialed JSON request after a CORS preflight, which rookery never
   * answers, so this is its CSRF protection along with SameSite=Lax.
   */
  fastify.addHook('onRequest', async (request, reply) => {
    if (SERVER_PATHS.some((path) => request.url.startsWith(path))) {
      reply.header(HEADERS.cacheControl, CACHE_POLICIES.noStore)
    }
    const type = request.headers[HEADERS.contentType]?.toLowerCase() ?? ''
    // Returning the reply ends the request here instead of running the route.
    if (!READS.has(request.method) && !type.startsWith(CONTENT_TYPES.json)) {
      return reply
        .code(HTTP_STATUSES.unsupportedMediaType)
        .send({ reason: WRITE_ERRORS.jsonRequired })
    }
    return undefined
  })

  await compressResponses({ app })
  /*
   * In Docker the server hands out the built web app too, so there is one
   * port. In development Vite serves it and proxies the server's routes here.
   */
  await serveWebApp({ app, webDir: config.webDir, serverPrefixes: SERVER_PATHS })
  app.enableShutdownHooks()
  return app
}
