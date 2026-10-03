import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    // The server runs on its own port in development (`nx run @weirwood/server:dev`);
    // in Docker it serves this app itself and nothing is proxied.
    proxy: {
      '/api': 'http://localhost:8484',
    },
  },
})
