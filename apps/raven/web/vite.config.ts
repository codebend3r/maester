import { fileURLToPath } from 'node:url'
import { URL_PROTOCOLS } from '@raven/core'
import { type Plugin, defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

/** The environment variables the build and the dev server read. */
const ENV = {
  apiOrigin: 'RAVEN_API_ORIGIN',
  devApiOrigin: 'RAVEN_DEV_API_ORIGIN',
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

export default defineConfig(({ mode }) => ({
  plugins: [react(), netlifyApiProxy(), restartOnRavenEnv()],
  define: {
    'import.meta.env.VITE_PICTURE_CDN': JSON.stringify(
      process.env[ENV.netlify] === NETLIFY_VALUES.on ? NETLIFY_IMAGE_CDN : '',
    ),
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
}))
