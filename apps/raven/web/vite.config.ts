import { fileURLToPath } from 'node:url'
import { URL_PROTOCOLS } from '@raven/core'
import { type Plugin, defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/** The environment variables the build reads. */
const ENV = { apiOrigin: 'RAVEN_API_ORIGIN', netlify: 'NETLIFY' } as const

/** What Netlify sets `NETLIFY` to in its builds. */
const NETLIFY_VALUES = { on: 'true' } as const

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

export default defineConfig({
  plugins: [react(), netlifyApiProxy()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    // The server runs on its own port in development (`nx run @raven/server:dev`);
    // in Docker it serves this app itself and nothing is proxied.
    proxy: {
      '/api': 'http://localhost:8484',
    },
  },
})
