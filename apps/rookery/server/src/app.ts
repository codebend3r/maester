import { NestFactory } from '@nestjs/core'
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'
import { serveWebApp } from '@shared/server'
import { AppModule } from '@/appModule'
import { type Clock, systemClock } from '@/clock'
import type { ServerConfig } from '@/config'
import { HttpPlexTv, type PlexTv } from '@/plex/plexTv'

const READS = new Set(['GET', 'HEAD', 'OPTIONS'])
// Where the server's own routes live: never cached, and a miss under one is a
// JSON 404 rather than the web app.
const SERVER_PREFIXES = ['/api/', '/internal/', '/auth/']

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
      reply.header('cache-control', 'no-store')
    }
    const type = request.headers['content-type']?.toLowerCase() ?? ''
    // Returning the reply ends the request here instead of running the route.
    if (!READS.has(request.method) && !type.startsWith('application/json')) {
      return reply.code(415).send({ reason: 'json_required' })
    }
    return undefined
  })

  // In Docker the server hands out the built web app too, so there is one
  // port. In development Vite serves it and proxies the server's routes here.
  await serveWebApp({ app, webDir: config.webDir, serverPrefixes: SERVER_PREFIXES })
  app.enableShutdownHooks()
  return app
}
