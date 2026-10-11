import { join } from 'node:path'
import fastifyStatic from '@fastify/static'
import { NestFactory } from '@nestjs/core'
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'
import { AppModule } from '@/appModule.js'
import { type Clock, systemClock } from '@/clock.js'
import type { ServerConfig } from '@/config.js'
import { HttpPlexTv, type PlexTv } from '@/plex/plexTv.js'
import { SpaFallbackFilter } from '@/spa/spaFallbackFilter.js'

const READS = new Set(['GET', 'HEAD', 'OPTIONS'])
const PRIVATE_PREFIXES = ['/api/', '/internal/', '/auth/']

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
    if (PRIVATE_PREFIXES.some((prefix) => request.url.startsWith(prefix))) {
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
  // port. In development Vite serves it and proxies the API here.
  if (config.webDir) {
    // Registered straight on Fastify and awaited: Nest's own useStaticAssets
    // imports the plugin lazily and drops the promise, so the plugin lands
    // after Fastify has started booting and `ready()` never resolves.
    await app.register(fastifyStatic, {
      root: config.webDir,
      prefix: '/',
      // Vite fingerprints everything under /assets, so it never goes stale.
      setHeaders: (reply, path) => {
        reply.header(
          'cache-control',
          path.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
        )
      },
    })
  }
  app.useGlobalFilters(
    new SpaFallbackFilter(config.webDir ? join(config.webDir, 'index.html') : null),
  )
  app.enableShutdownHooks()
  return app
}
