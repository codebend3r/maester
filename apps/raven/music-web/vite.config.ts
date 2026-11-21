import { fileURLToPath } from 'node:url'
import { DEFAULT_SERVER_ORIGIN } from '@raven/core'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import {
  IS_NETLIFY,
  NETLIFY_IMAGE_CDN,
  devApiOrigin,
  vendorChunkGroups,
} from '@tooling/web/viteRaven'

/** raven's own folder, whose `.env` (beside the compose file) the dev server reads too. */
const RAVEN_DIR = fileURLToPath(new URL('..', import.meta.url))

/** The fixture server, the raven this app's developers point it at most. */
const DEV_API_ORIGIN_EXAMPLE = 'http://127.0.0.1:8490'

/**
 * The dependencies that change on their own schedule, each in a chunk of its own, so a release
 * of Wren leaves their cached chunks as they were.
 */
const VENDOR_CHUNKS = [
  { name: 'react', packages: ['react', 'react-dom', 'scheduler'] },
  { name: 'router', packages: ['react-router', 'react-router-dom'] },
  { name: 'query', packages: ['@tanstack/react-query', '@tanstack/query-core'] },
  { name: 'supabase', packages: ['@supabase'] },
] as const

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  define: {
    'import.meta.env.VITE_PICTURE_CDN': JSON.stringify(IS_NETLIFY ? NETLIFY_IMAGE_CDN : ''),
    /*
     * raven's origin on Netlify, where `netlify.toml` proxies /api to it, so music plays from
     * raven itself and never through the proxy; '' when /api is raven itself.
     */
    'import.meta.env.VITE_API_ORIGIN': JSON.stringify(IS_NETLIFY ? DEFAULT_SERVER_ORIGIN : ''),
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    // Its own port, beside raven's web app (5173) and sparrow's (5190).
    port: 5185,
    strictPort: true,
    /*
     * raven runs on its own port in development, or on another machine (`devApiOrigin`), so the
     * browser sees one origin and the session's cookie opens every cover and track.
     */
    proxy: {
      '/api': {
        target: devApiOrigin({ mode, ravenDir: RAVEN_DIR, example: DEV_API_ORIGIN_EXAMPLE }),
        changeOrigin: true,
      },
    },
  },
  build: {
    rolldownOptions: {
      // The build's time goes to sass over the SCSS modules; rolldown's note about it has nothing to act on.
      checks: { bundlerTimings: false },
      output: {
        codeSplitting: {
          groups: vendorChunkGroups(VENDOR_CHUNKS),
        },
      },
    },
  },
}))
