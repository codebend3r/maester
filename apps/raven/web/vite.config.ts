import { fileURLToPath } from 'node:url'
import { URL_PROTOCOLS } from '@raven/core'
import { type Plugin, defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

/** The environment variables the build and the dev server read. */
const ENV = {
  apiOrigin: 'RAVEN_API_ORIGIN',
  devApiOrigin: 'RAVEN_DEV_API_ORIGIN',
  homeContinueCount: 'RAVEN_HOME_CONTINUE_COUNT',
  netlify: 'NETLIFY',
} as const

/** raven's own folder, whose `.env` (beside the compose file) the dev server reads too. */
const RAVEN_DIR = fileURLToPath(new URL('..', import.meta.url))

/** Where the dev server proxies /api without RAVEN_DEV_API_ORIGIN: the local server (`nx run @raven/server:dev`). */
const LOCAL_API_ORIGIN = 'http://localhost:8484'

/** What Netlify sets `NETLIFY` to in its builds. */
const NETLIFY_VALUES = { on: 'true' } as const

/**
 * Netlify's Image CDN on the site's own origin. It fetches a relative
 * picture through the `/api` proxy below, with no cookie or token, so only
 * raven's capability pictures (`/api/pictures`) go through it.
 */
const NETLIFY_IMAGE_CDN = '/.netlify/images'

/**
 * On Netlify (netlify.toml) the app is served apart from raven, so the build
 * writes a `_redirects` that proxies /api to RAVEN_API_ORIGIN, raven's public
 * address. The app still calls its own origin, which keeps the PIN and admin
 * lock cookies first party. Netlify reads no environment variables in
 * netlify.toml's redirects, hence a file written here.
 */
const netlifyApiProxy = (): Plugin => ({
  name: 'raven-netlify-api-proxy',
  apply: 'build',
  generateBundle() {
    const origin = process.env[ENV.apiOrigin]
    // Netlify sets NETLIFY; without the proxy every /api call would get index.html.
    if (!origin && process.env[ENV.netlify] === NETLIFY_VALUES.on) {
      return this.error('Set RAVEN_API_ORIGIN in the Netlify site, to raven on Vhagar.')
    }
    if (!origin) return
    const url = URL.canParse(origin) ? new URL(origin) : null
    if (url?.protocol !== URL_PROTOCOLS.https || url.origin !== origin.replace(/\/+$/, '')) {
      return this.error(
        `RAVEN_API_ORIGIN must be an https origin with no path, such as https://raven.example.ts.net, not ${origin}`,
      )
    }
    this.emitFile({
      type: 'asset',
      fileName: '_redirects',
      source: `/api/*  ${url.origin}/api/:splat  200\n`,
    })
  },
})

/**
 * The raven the dev server proxies /api to: RAVEN_DEV_API_ORIGIN from the
 * shell, else from raven's `.env`, else the local server. An http or https
 * origin with no path, such as http://192.168.50.6:8484 for Vhagar.
 */
const devApiOrigin = (mode: string): string => {
  const origin =
    process.env[ENV.devApiOrigin] ?? loadEnv(mode, RAVEN_DIR, '')[ENV.devApiOrigin] ?? ''
  if (!origin) return LOCAL_API_ORIGIN
  const url = URL.canParse(origin) ? new URL(origin) : null
  const isWeb = url?.protocol === URL_PROTOCOLS.http || url?.protocol === URL_PROTOCOLS.https
  if (!url || !isWeb || url.origin !== origin.replace(/\/+$/, '')) {
    throw new Error(
      `RAVEN_DEV_API_ORIGIN must be an http or https origin with no path, such as http://192.168.50.6:8484, not ${origin}`,
    )
  }
  return url.origin
}

/**
 * Restarts the dev server when raven's `.env` changes, so editing
 * RAVEN_DEV_API_ORIGIN there switches the backend without a manual restart.
 */
const restartOnRavenEnv = (): Plugin => ({
  name: 'raven-restart-on-env',
  apply: 'serve',
  configureServer(server) {
    const envFile = `${RAVEN_DIR}.env`
    server.watcher.add(envFile)
    server.watcher.on('change', (file) => {
      if (file === envFile) void server.restart()
    })
  },
})

/** How many Continue watching tiles the home page shows before its See all link, when the env does not say. */
const DEFAULT_HOME_CONTINUE_COUNT = 6

/**
 * RAVEN_HOME_CONTINUE_COUNT from the shell, else from raven's `.env`, else 6:
 * a whole number of tiles, at least 1.
 */
const homeContinueCount = (mode: string): number => {
  const given =
    process.env[ENV.homeContinueCount] ?? loadEnv(mode, RAVEN_DIR, '')[ENV.homeContinueCount] ?? ''
  if (given.trim() === '') return DEFAULT_HOME_CONTINUE_COUNT
  const count = Number(given)
  if (!Number.isInteger(count) || count < 1) {
    throw new Error(`RAVEN_HOME_CONTINUE_COUNT must be a whole number of at least 1, not ${given}`)
  }
  return count
}

/**
 * The dependencies that change on their own schedule, each in a chunk of its
 * own, so a release of the app leaves their cached chunks as they were and no
 * chunk nears Vite's 500 kB warning. raven's own libraries make one more, and
 * what two or more pages share a last one, so a page the browser fetches on
 * its first visit (`AppRoutes`) brings no slivers of shared code with it.
 */
const VENDOR_CHUNKS = [
  { name: 'react', packages: ['react', 'react-dom', 'scheduler'] },
  { name: 'router', packages: ['react-router', 'react-router-dom'] },
  { name: 'query', packages: ['@tanstack/react-query', '@tanstack/query-core'] },
  { name: 'supabase', packages: ['@supabase'] },
] as const

/** Above rolldown's own chunking, which decides what is left. */
const CHUNK_PRIORITIES = { vendor: 10, raven: 9, shared: 8 } as const

/** A module's id with `/` between folders, whatever the build machine writes. */
const posixId = (id: string) => id.replaceAll('\\', '/')

const vendorChunkTest = (packages: readonly string[]) => (id: string) =>
  packages.some((name) => posixId(id).includes(`/node_modules/${name}/`))

const isRavenLib = (id: string) => posixId(id).includes('/libs/raven/')

const isAppModule = (id: string) => !posixId(id).includes('/node_modules/')

export default defineConfig(({ mode }) => ({
  plugins: [react(), netlifyApiProxy(), restartOnRavenEnv()],
  define: {
    'import.meta.env.VITE_HOME_CONTINUE_COUNT': JSON.stringify(String(homeContinueCount(mode))),
    'import.meta.env.VITE_PICTURE_CDN': JSON.stringify(
      process.env[ENV.netlify] === NETLIFY_VALUES.on ? NETLIFY_IMAGE_CDN : '',
    ),
    // Where /api goes when it is the proxy above; '' when /api is raven itself.
    'import.meta.env.VITE_API_ORIGIN': JSON.stringify(process.env[ENV.apiOrigin] ?? ''),
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    // The server runs on its own port in development, or on another machine
    // (`devApiOrigin`); in Docker it serves this app itself and nothing is proxied.
    // The Host header follows the target, as a raven behind a name expects.
    proxy: {
      '/api': { target: devApiOrigin(mode), changeOrigin: true },
    },
  },
  build: {
    // One stylesheet, so the cascade keeps the shared primitives before the host's overrides
    // whichever chunk loads first; `main.styles.test.ts` checks that order.
    cssCodeSplit: false,
    rolldownOptions: {
      // The build's time goes to sass over the SCSS modules; rolldown's note about it has nothing to act on.
      checks: { bundlerTimings: false },
      output: {
        codeSplitting: {
          groups: [
            ...VENDOR_CHUNKS.map(({ name, packages }) => ({
              name,
              test: vendorChunkTest(packages),
              priority: CHUNK_PRIORITIES.vendor,
            })),
            { name: 'raven', test: isRavenLib, priority: CHUNK_PRIORITIES.raven },
            {
              name: 'shared',
              test: isAppModule,
              minShareCount: 2,
              priority: CHUNK_PRIORITIES.shared,
            },
          ],
        },
      },
    },
  },
}))
