import { readFile } from 'node:fs/promises'
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
 * On Netlify the app is served apart from raven, and `netlify.toml` proxies
 * /api, signed, to raven's public origin, so the app still calls its own
 * origin and the PIN and admin lock cookies stay first party. RAVEN_API_ORIGIN
 * names that origin to the build (`VITE_API_ORIGIN`) and the functions, so a
 * Netlify build without a valid one fails here.
 */
const netlifyApiOrigin = (): Plugin => ({
  name: 'raven-netlify-api-origin',
  apply: 'build',
  generateBundle() {
    const origin = process.env[ENV.apiOrigin]
    // Netlify sets NETLIFY; without the proxy every /api call would get index.html.
    if (!origin && process.env[ENV.netlify] === NETLIFY_VALUES.on) {
      return this.error("Set RAVEN_API_ORIGIN in the Netlify site, to raven's public origin.")
    }
    if (!origin) return
    const url = URL.canParse(origin) ? new URL(origin) : null
    if (url?.protocol !== URL_PROTOCOLS.https || url.origin !== origin.replace(/\/+$/, '')) {
      return this.error(
        `RAVEN_API_ORIGIN must be an https origin with no path, such as https://raven.example.synology.me:8443, not ${origin}`,
      )
    }
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

/** Where index.html's loader takes the mark's path, filled in from the brand file below. */
const MARK_PLACEHOLDER = '__RAVEN_MARK_PATH__'

/** raven's mark, the file the player's own preloader copies its path from too. */
const MARK_FILE = fileURLToPath(new URL('./public/brand/raven-mark-mono.svg', import.meta.url))

const MARK_PATH_PATTERN = /\sd="([^"]+)"/

const ravenMarkPath = async (): Promise<string> => {
  const path = MARK_PATH_PATTERN.exec(await readFile(MARK_FILE, 'utf8'))?.[1]
  if (!path) throw new Error(`No path in ${MARK_FILE}`)
  return path
}

/** Draws raven's mark in the loader index.html shows before the app runs. */
const inlineRavenMark = (): Plugin => ({
  name: 'raven-inline-mark',
  transformIndexHtml: {
    order: 'pre',
    handler: async (html) => {
      if (!html.includes(MARK_PLACEHOLDER)) {
        throw new Error(`index.html has no ${MARK_PLACEHOLDER} for the loader's mark`)
      }
      return html.replace(MARK_PLACEHOLDER, await ravenMarkPath())
    },
  },
})

const STYLESHEET_LINK = /<link rel="stylesheet"([^>]*)>/g

/**
 * Turns the stylesheet Vite links in the head into a preload, so it stops
 * holding back the first paint and index.html's loader shows as soon as the
 * page arrives. The download still starts at once; `applyStylesheets`
 * (main.tsx) makes it a stylesheet and waits for it before the app renders,
 * so nothing draws unstyled.
 */
const preloadStylesheets = (): Plugin => ({
  name: 'raven-preload-stylesheets',
  apply: 'build',
  transformIndexHtml: {
    order: 'post',
    handler: (html) => html.replace(STYLESHEET_LINK, '<link rel="preload" as="style"$1>'),
  },
})

/**
 * The latin files of the two fonts every page sets its words in (`main.tsx`'s
 * `@fontsource` imports): Instrument Sans for the body, Young Serif for the
 * headings. The monospace font is the system's.
 */
const PRELOADED_FONTS = [
  /^assets\/instrument-sans-latin-wdth-normal-[\w-]+\.woff2$/,
  /^assets\/young-serif-latin-400-normal-[\w-]+\.woff2$/,
] as const

/**
 * Names the page's fonts in the head, so the browser fetches them with the
 * code rather than after the stylesheet has arrived and the first words are
 * laid out, and the words never draw in a fallback font first.
 */
const preloadFonts = (): Plugin => ({
  name: 'raven-preload-fonts',
  apply: 'build',
  transformIndexHtml: {
    order: 'post',
    handler: (html, { bundle }) => {
      const files = Object.keys(bundle ?? {})
      const fonts = PRELOADED_FONTS.map((pattern) => {
        const file = files.find((name) => pattern.test(name))
        if (!file) throw new Error(`No font in the bundle matches ${pattern}`)
        return file
      })
      return {
        html,
        tags: fonts.map((file) => ({
          tag: 'link',
          attrs: {
            rel: 'preload',
            as: 'font',
            type: 'font/woff2',
            crossorigin: '',
            href: `/${file}`,
          },
          injectTo: 'head',
        })),
      }
    },
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
 * chunk nears Vite's 500 kB warning. Everything else, raven's own libraries
 * included, is rolldown's to split, so the sign-in page a first visit lands on
 * brings none of the pages behind it.
 */
const VENDOR_CHUNKS = [
  { name: 'react', packages: ['react', 'react-dom', 'scheduler'] },
  { name: 'router', packages: ['react-router', 'react-router-dom'] },
  { name: 'query', packages: ['@tanstack/react-query', '@tanstack/query-core'] },
  { name: 'supabase', packages: ['@supabase'] },
] as const

/** Above rolldown's own chunking, which decides what is left. */
const VENDOR_PRIORITY = 10

/** A module's id with `/` between folders, whatever the build machine writes. */
const posixId = (id: string) => id.replaceAll('\\', '/')

const vendorChunkTest = (packages: readonly string[]) => (id: string) =>
  packages.some((name) => posixId(id).includes(`/node_modules/${name}/`))

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    netlifyApiOrigin(),
    restartOnRavenEnv(),
    inlineRavenMark(),
    preloadStylesheets(),
    preloadFonts(),
  ],
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
    // Each page's styles load with its chunk, after the first stylesheet, which holds the shared
    // primitives, so a page's overrides still come after what they override in the cascade;
    // `main.styles.test.ts` checks that order.
    cssCodeSplit: true,
    rolldownOptions: {
      // The build's time goes to sass over the SCSS modules; rolldown's note about it has nothing to act on.
      checks: { bundlerTimings: false },
      output: {
        codeSplitting: {
          groups: VENDOR_CHUNKS.map(({ name, packages }) => ({
            name,
            test: vendorChunkTest(packages),
            priority: VENDOR_PRIORITY,
          })),
        },
      },
    },
  },
}))
