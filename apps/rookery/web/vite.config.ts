import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The server's routes, proxied in development so the browser sees one
// origin, as it does in Docker where the server serves this app itself.
const server = 'http://localhost:8030'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    // Its own port, so it runs beside raven's web app (5173). Set rookery's
    // PUBLIC_URL to this address in development: Plex sends the browser back here.
    port: 5180,
    strictPort: true,
    proxy: {
      '/api': server,
      '/auth': server,
      '/health': server,
    },
  },
})
