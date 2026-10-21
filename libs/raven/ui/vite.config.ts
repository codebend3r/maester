import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const peers = [
  'react',
  'react-dom',
  'react-router-dom',
  '@tanstack/react-query',
  'zustand',
  '@raven/core',
]

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  build: {
    // The clean target owns removal; watch rebuilds must keep emitted declarations.
    emptyOutDir: false,
    lib: {
      entry: {
        styles: fileURLToPath(new URL('./src/styles.ts', import.meta.url)),
        index: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
        headless: fileURLToPath(new URL('./src/headless.ts', import.meta.url)),
        canPlay: fileURLToPath(new URL('./src/lib/canPlay.ts', import.meta.url)),
        designTokens: fileURLToPath(new URL('./src/styles/designTokens.ts', import.meta.url)),
      },
      formats: ['es'],
      fileName: (_format, name) => `${name}.js`,
      cssFileName: 'styles',
    },
    rolldownOptions: {
      external: (id) => peers.some((peer) => id === peer || id.startsWith(`${peer}/`)),
    },
  },
})
