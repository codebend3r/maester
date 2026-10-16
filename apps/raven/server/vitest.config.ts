import { defineConfig } from 'vitest/config'

export default defineConfig({
  // The `@/` alias from tsconfig.json; tsc-alias rewrites it for the
  // compiled output, and this resolves it for the tests.
  resolve: { tsconfigPaths: true },
  test: {
    include: ['src/**/*.test.ts'],
    setupFiles: ['src/test/quietLogs.ts'],
    // A fresh worker per file, the default, said outright: sharing them saves
    // half a second but lets one file's module state leak into the next.
    isolate: true,
    // The end-to-end suite encodes real clips with ffmpeg before it starts.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
})
