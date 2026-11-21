import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { SERVICE_WORKER } from '@raven/core'
import { type Plugin, defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { NETLIFY_DEFINES, VENDOR_GROUPS, apiProxy } from '@tooling/web/viteRaven'

/** The environment variables only this build and its dev server read. */
const ENV = {
  homeContinueCount: 'RAVEN_HOME_CONTINUE_COUNT',
} as const

/** raven's own folder, whose `.env` (beside the compose file) the dev server reads too. */
const RAVEN_DIR = fileURLToPath(new URL('..', import.meta.url))

/** Vhagar, the raven this app's developers point it at most. */
const DEV_API_ORIGIN_EXAMPLE = 'http://192.168.50.6:8484'

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

/**
 * RAVEN_HOME_CONTINUE_COUNT from the shell, else from raven's `.env`, as given: empty for
 * none, which leaves the count to `homeContinueCountOf`'s default. A given one must be a
 * whole number of tiles, at least 1.
 */
const homeContinueCount = (mode: string): string => {
  const given =
    process.env[ENV.homeContinueCount] ?? loadEnv(mode, RAVEN_DIR, '')[ENV.homeContinueCount] ?? ''
  if (given.trim() === '') return ''
  const count = Number(given)
  if (!Number.isInteger(count) || count < 1) {
    throw new Error(`RAVEN_HOME_CONTINUE_COUNT must be a whole number of at least 1, not ${given}`)
  }
  return given
}

/**
 * The build's two entries: the page, and the service worker (`src/serviceWorker/sw.ts`), which
 * nothing on the page imports, so it bundles alone into one classic script with no imports.
 */
const BUILD_INPUT = {
  index: fileURLToPath(new URL('./index.html', import.meta.url)),
  [SERVICE_WORKER.entry]: fileURLToPath(new URL('./src/serviceWorker/sw.ts', import.meta.url)),
} as const

/** Where Vite writes an entry's script, which it hashes like every other build file. */
const HASHED_ENTRY = 'assets/[name]-[hash].js'

/**
 * The worker keeps one fixed name at the site's root, where the page registers it and where its
 * scope covers every page; the page's own entry stays hashed under assets/.
 */
type EntryChunk = { name: string }

const entryFileName = ({ name }: EntryChunk) =>
  name === SERVICE_WORKER.entry ? SERVICE_WORKER.file : HASHED_ENTRY

export default defineConfig(({ mode }) => ({
  plugins: [react(), restartOnRavenEnv(), inlineRavenMark(), preloadStylesheets(), preloadFonts()],
  define: {
    'import.meta.env.VITE_HOME_CONTINUE_COUNT': JSON.stringify(homeContinueCount(mode)),
    ...NETLIFY_DEFINES,
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    // In Docker the server serves this app itself and nothing is proxied.
    proxy: apiProxy({ mode, ravenDir: RAVEN_DIR, example: DEV_API_ORIGIN_EXAMPLE }),
  },
  build: {
    /*
     * Each page's styles load with its chunk, after the first stylesheet, which holds the shared
     * primitives, so a page's overrides still come after what they override in the cascade;
     * `main.styles.test.ts` checks that order.
     */
    cssCodeSplit: true,
    rolldownOptions: {
      // The build's time goes to sass over the SCSS modules; rolldown's note about it has nothing to act on.
      checks: { bundlerTimings: false },
      input: BUILD_INPUT,
      output: {
        entryFileNames: entryFileName,
        codeSplitting: {
          groups: VENDOR_GROUPS,
        },
      },
    },
  },
}))
