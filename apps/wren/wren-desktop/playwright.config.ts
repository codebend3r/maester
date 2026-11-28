import { defineConfig } from '@playwright/test'
import { SUITE_DEFAULTS, fixtureWebServer } from '@tooling/web/playwright'
import { FIXTURE_PORT } from '@/e2e/fixture'

/*
 * Wren for Mac against `@raven/server`'s fixture: a real accountless raven with one album, so
 * the page opens on Home with no sign-in. Every test launches the one built app, whose web host
 * holds a fixed port, so they run one at a time.
 */
export default defineConfig({
  ...SUITE_DEFAULTS,
  workers: 1,
  timeout: 60_000,
  use: { trace: 'retain-on-failure' },
  // No web folder: the app's own web host serves the page, and the fixture only answers `/api`.
  webServer: fixtureWebServer({ port: FIXTURE_PORT }),
})
