import { defineConfig } from '@playwright/test'

const HOST = '127.0.0.1'
// Its own port, beside the dev server's (5190) and the web apps' Lighthouse servers (4173 to 4176).
const PORT = 4190
const ORIGIN = `http://${HOST}:${PORT}`

/*
 * maester.tv in a real browser: the built site, served by `vite preview` as Netlify serves it.
 * The pages keep nothing, and each test answers GitHub itself, so the files run side by side.
 */
export default defineConfig({
  testDir: 'e2e',
  // Bun's test runner never picks these up.
  testMatch: '**/*.e2e.ts',
  fullyParallel: true,
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  forbidOnly: !!process.env.CI,
  reporter: 'list',
  outputDir: 'test-results',
  use: {
    baseURL: ORIGIN,
    // Google Chrome, as the web apps' suites run in. GitHub's Ubuntu runners have it installed.
    channel: 'chrome',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `bun run preview --host ${HOST} --port ${PORT} --strictPort`,
    url: ORIGIN,
    // This run's build, never a preview an earlier run left serving an older one.
    reuseExistingServer: false,
    stdout: 'ignore',
    stderr: 'pipe',
  },
})
