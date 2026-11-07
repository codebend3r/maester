import { Logger } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'
import { compressResponses, serveWebApp } from '@shared/server'
import { AppModule, CONTROLLERS } from '@/appModule'
import type { JWTVerifyGetKey } from 'jose'
import type { AuthFetch } from '@/auth/tokenVerifier'
import { type Clock, SYSTEM_CLOCK } from '@/clock'
import type { ServerConfig } from '@/config'
import type { AiFetch } from '@/metadata/aiClient'
import type { MetadataFetch } from '@/metadata/tmdbClient'
import type { ReachabilityFetch } from '@/remoteAccess/reachability'
import { isAllowedWebOrigin } from '@/media/mediaPlaneConfig'
import { mediaPlanePaths, pathMatcher, registerMediaPlaneHook } from '@/media/mediaPlaneCors'
import { proxiedMediaWarner } from '@/media/mediaPlaneFallback'
import { limitRavenRequests } from '@/rateLimits/limitRavenRequests'
import { registerRequestLog } from '@/requestLog'
import type { WatchOptions } from '@/scanner/libraryWatcher'

type CreateAppProps = {
  config: ServerConfig
  quiet?: boolean
  /** Stands in for TMDB in tests; left out, metadata calls go to the network. */
  metadataFetch?: MetadataFetch
  /** Stands in for Claude in tests; left out, AI lookups go to the network. */
  aiFetch?: AiFetch
  /** Shorter waits for the folder watcher in tests. */
  watch?: Partial<WatchOptions>
  authFetch?: AuthFetch
  authKeys?: JWTVerifyGetKey
  /** Stands in for the web app's reachability function in tests. */
  reachabilityFetch?: ReachabilityFetch
  /** How often open SSE and media responses check their account again; a minute when left out. */
  accessRecheckMs?: number
  /** How long a membership answer is reused; 5 s when left out. A test that changes an account under a token already used asks for 0. */
  membershipTtlMs?: number
  /** Holds the work on boot until `StartupWork.release`, which `main.ts` calls once listening. */
  shouldHoldStartupWork?: boolean
  /** The clock the HLS sessions, the account passes and the rate limits run on; the system's when left out. */
  clock?: Clock
}

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
  authFetch,
  authKeys,
  reachabilityFetch,
  accessRecheckMs,
  membershipTtlMs,
  shouldHoldStartupWork,
  clock = SYSTEM_CLOCK,
}: CreateAppProps): Promise<NestFastifyApplication> => {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule.register({
      config,
      metadataFetch,
      aiFetch,
      watch,
      authFetch,
      authKeys,
      reachabilityFetch,
      accessRecheckMs,
      membershipTtlMs,
      shouldHoldStartupWork,
      clock,
    }),
    // Only the listed proxies' X-Forwarded-For moves `request.ip` off the socket.
    new FastifyAdapter({ trustProxy: [...config.remoteAccess.trustedProxies] }),
    { logger: quiet ? false : ['log', 'warn', 'error'] },
  )

  await compressResponses({ app })
  const fastify = app.getHttpAdapter().getInstance()
  if (config.shouldLogRequests && !quiet) {
    const requestLogger = new Logger(registerRequestLog.name)
    registerRequestLog({
      fastify,
      log: (line) => requestLogger.log(line),
    })
  }
  const mediaPlaneLogger = new Logger(proxiedMediaWarner.name)
  registerMediaPlaneHook({
    fastify,
    isMediaPlanePath: pathMatcher(mediaPlanePaths(CONTROLLERS)),
    isAllowedOrigin: (origin) =>
      isAllowedWebOrigin({ origin, allowed: config.mediaPlane.webOrigins }),
    onProxied: proxiedMediaWarner({
      hasMediaOrigins: config.mediaPlane.origins.length > 0,
      warn: (message) => mediaPlaneLogger.warn(message),
    }),
  })
  // After the media plane's hook, so a refused media request still carries its CORS headers.
  limitRavenRequests({
    fastify,
    controllers: CONTROLLERS,
    now: () => clock.now(),
    proxySecret: config.remoteAccess.proxySecret,
  })
  /*
   * In Docker the server hands out the built web app too, so it and the API
   * share one port. Only the media plane routes answer CORS, for the web
   * origins in RAVEN_WEB_ORIGINS. In development Vite serves the app and
   * proxies /api here.
   */
  await serveWebApp({ app, webDir: config.webDir, serverPrefixes: ['/api/'] })
  app.enableShutdownHooks()
  return app
}
