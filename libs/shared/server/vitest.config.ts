import { defineConfig } from 'vitest/config'

export default defineConfig({
  // The `@/` alias from tsconfig.json; tsc-alias rewrites it for the build.
  resolve: { tsconfigPaths: true },
  test: {
    include: ['src/**/*.test.ts'],
  },
})
