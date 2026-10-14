import { NestFactory } from '@nestjs/core'
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'
import { compressResponses, serveWebApp } from '@shared/server'
import { AppModule } from '@/appModule'
import type { ServerConfig } from '@/config'
import type { AiFetch } from '@/metadata/aiClient'
import type { MetadataFetch } from '@/metadata/tmdbClient'
import type { WatchOptions } from '@/scanner/libraryWatcher'

/**
 * The configured application, not yet listening, so a test can drive it
 * through `inject` exactly as `main.ts` serves it.
 */
export const createApp = async ({
  config,
  quiet = false,
  metadataFetch,
  aiFetch,
  watch,
}: {
  config: ServerConfig
  quiet?: boolean
  /** Stands in for TMDB in tests; left out, metadata calls go to the network. */
  metadataFetch?: MetadataFetch
  /** Stands in for Claude in tests; left out, AI lookups go to the network. */
  aiFetch?: AiFetch
  /** Shorter waits for the folder watcher in tests. */
  watch?: Partial<WatchOptions>
}): Promise<NestFastifyApplication> => {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule.register({ config, metadataFetch, aiFetch, watch }),
    new FastifyAdapter(),
    { logger: quiet ? false : ['log', 'warn', 'error'] },
  )

  await compressResponses({ app })
  // In Docker the server hands out the built web app too, so there is one
  // port and no CORS. In development Vite serves it and proxies /api here.
  await serveWebApp({ app, webDir: config.webDir, serverPrefixes: ['/api/'] })
  app.enableShutdownHooks()
  return app
}
