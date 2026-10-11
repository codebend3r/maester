import { join } from 'node:path'
import fastifyStatic from '@fastify/static'
import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import { SpaFallbackFilter } from '@/spaFallbackFilter'

/**
 * Hands out the built web app from `webDir` beside the server's own routes,
 * so in Docker there is one port and no CORS. With no `webDir` (in
 * development, where Vite serves the app and proxies to the server) a miss is
 * a plain 404. `serverPrefixes` name where the server's routes live, so a miss
 * under one stays JSON instead of becoming the app's page.
 */
export const serveWebApp = async ({
  app,
  webDir,
  serverPrefixes,
}: {
  app: NestFastifyApplication
  webDir: string | null
  serverPrefixes: readonly string[]
}): Promise<void> => {
  if (webDir) {
    // Registered straight on Fastify and awaited: Nest's own useStaticAssets
    // imports the plugin lazily and drops the promise, so the plugin lands
    // after Fastify has started booting and `ready()` never resolves.
    await app.register(fastifyStatic, {
      root: webDir,
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
    new SpaFallbackFilter({
      indexPath: webDir ? join(webDir, 'index.html') : null,
      serverPrefixes,
    }),
  )
}
