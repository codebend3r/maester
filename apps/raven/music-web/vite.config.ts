import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { NETLIFY_DEFINES, VENDOR_GROUPS, apiProxy } from '@tooling/web/viteRaven'

/** raven's own folder, whose `.env` (beside the compose file) the dev server reads too. */
const RAVEN_DIR = fileURLToPath(new URL('..', import.meta.url))

/** The fixture server, the raven this app's developers point it at most. */
const DEV_API_ORIGIN_EXAMPLE = 'http://127.0.0.1:8490'

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  define: NETLIFY_DEFINES,
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    // Its own port, beside raven's web app (5173) and sparrow's (5190).
    port: 5185,
    strictPort: true,
    proxy: apiProxy({ mode, ravenDir: RAVEN_DIR, example: DEV_API_ORIGIN_EXAMPLE }),
  },
  build: {
    rolldownOptions: {
      // The build's time goes to sass over the SCSS modules; rolldown's note about it has nothing to act on.
      checks: { bundlerTimings: false },
      output: {
        codeSplitting: {
          groups: VENDOR_GROUPS,
        },
      },
    },
  },
}))
