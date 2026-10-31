import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// sparrow's API, proxied in development so the browser sees one origin. The
// sandbox (`sparrow-sandbox`) listens on the same port as the real server, so
// this one config serves either.
const server = 'http://localhost:8020'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    // Its own port, beside raven's web app (5173) and rookery's (5180).
    port: 5190,
    strictPort: true,
    proxy: {
      '/api': server,
      '/health': server,
    },
  },
})
