import { join } from 'node:path'
import fastifyStatic from '@fastify/static'
import { NestFactory } from '@nestjs/core'
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'
import { AppModule } from '@/appModule'
import type { ServerConfig } from '@/config'
import { SpaFallbackFilter } from '@/spa/spaFallbackFilter'

/**
 * The configured application, not yet listening, so a test can drive it
 * through `inject` exactly as `main.ts` serves it.
 */
export const createApp = async ({
  config,
  quiet = false,
}: {
  config: ServerConfig
  quiet?: boolean
}): Promise<NestFastifyApplication> => {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule.register(config),
    new FastifyAdapter(),
    { logger: quiet ? false : ['log', 'warn', 'error'] },
  )

  // In Docker the server hands out the built web app too, so there is one
  // port and no CORS. In development Vite serves it and proxies /api here.
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
