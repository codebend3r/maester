import { NestFactory } from '@nestjs/core'
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'
import { compressResponses, serveWebApp } from '@shared/server'
import { AppModule, CONTROLLERS } from '@/appModule'
import type { ServerConfig } from '@/config'
import type { AiFetch } from '@/metadata/aiClient'
import type { MetadataFetch } from '@/metadata/tmdbClient'
import { isAllowedWebOrigin } from '@/media/mediaPlaneConfig'
import { mediaPlanePaths, pathMatcher, registerMediaPlaneCors } from '@/media/mediaPlaneCors'
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
  registerMediaPlaneCors({
    fastify: app.getHttpAdapter().getInstance(),
    isMediaPlanePath: pathMatcher(mediaPlanePaths(CONTROLLERS)),
    isAllowedOrigin: (origin) =>
      isAllowedWebOrigin({ origin, allowed: config.mediaPlane.webOrigins }),
  })
  // In Docker the server hands out the built web app too, so it and the API
  // share one port. Only the media plane routes answer CORS, for the web
  // origins in RAVEN_WEB_ORIGINS. In development Vite serves the app and
  // proxies /api here.
  await serveWebApp({ app, webDir: config.webDir, serverPrefixes: ['/api/'] })
  app.enableShutdownHooks()
  return app
}
