import { join } from 'node:path'
import { defineConfig } from '@playwright/test'
import { FIXTURE_SERVER } from '@raven/core'

const origin = `http://${FIXTURE_SERVER.host}:${FIXTURE_SERVER.webPort}`

/**
 * raven's web app in a real browser, against `@raven/server`'s fixture: a real accountless server
 * with a film, a series and an album, serving this project's build beside its API as raven's
 * image does. Every file shares the one server, so they run one at a time and each test leaves
 * the fixture as it found it.
 */
export default defineConfig({
  testDir: 'e2e',
  // Bun's test runner never picks these up.
  testMatch: '**/*.e2e.ts',
  workers: 1,
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  forbidOnly: !!process.env.CI,
  reporter: 'list',
  outputDir: 'test-results',
  use: {
    baseURL: origin,
    /*
     * Google Chrome, not Playwright's Chromium, which has no H.264 or AAC to play the fixture's
     * films with. GitHub's Ubuntu runners have it installed.
     */
    channel: 'chrome',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'bun run serve:fixture',
    cwd: join(import.meta.dirname, '..', 'server'),
    env: {
      [FIXTURE_SERVER.env.webDir]: join(import.meta.dirname, 'dist'),
      [FIXTURE_SERVER.env.port]: String(FIXTURE_SERVER.webPort),
    },
    url: `${origin}${FIXTURE_SERVER.readyPath}`,
    // A fresh fixture each run, so nothing an earlier run left behind decides this one.
    reuseExistingServer: false,
    // It encodes its clips and scans them before it listens.
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
})
