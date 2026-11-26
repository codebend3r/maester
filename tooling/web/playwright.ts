import { join } from 'node:path'
import { type Page, defineConfig } from '@playwright/test'
import { FIXTURE_SERVER } from '@raven/core/fixtureServer'

const SERVER_DIR = join(import.meta.dirname, '..', '..', 'apps', 'raven', 'server')

/** The files each suite runs: the flows, and the accessibility scan of every page. */
export const SUITE_MATCHES = {
  e2e: '**/*.e2e.ts',
  axe: '**/*.axe.ts',
} as const

type FixtureSuiteProps = {
  /** The web app's folder, which holds its `e2e` suite and its `dist` build. */
  projectDir: string
  /** The fixture's port, one per suite so the browser suites can run side by side. */
  port: number
  /** Which files run, the flows by default. */
  suite?: keyof typeof SUITE_MATCHES
}

/**
 * A web app's Playwright suite in a real browser, against `@raven/server`'s fixture: a real
 * accountless server serving the app's build beside its API, as raven's image does. Every file
 * shares the one server, so they run one at a time and each test leaves the fixture as it found
 * it.
 */
export const fixtureSuiteConfig = ({ projectDir, port, suite }: FixtureSuiteProps) => {
  const origin = `http://${FIXTURE_SERVER.host}:${port}`
  return defineConfig({
    testDir: 'e2e',
    // Bun's test runner never picks these up.
    testMatch: SUITE_MATCHES[suite ?? 'e2e'],
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
       * films and transcodes with. GitHub's Ubuntu runners have it installed.
       */
      channel: 'chrome',
      trace: 'retain-on-failure',
      // An app's offline worker would answer navigations itself; each test reaches the fixture.
      serviceWorkers: 'block',
    },
    webServer: {
      command: 'bun run serve:fixture',
      cwd: SERVER_DIR,
      env: {
        [FIXTURE_SERVER.env.webDir]: join(projectDir, 'dist'),
        [FIXTURE_SERVER.env.port]: String(port),
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
}

type AudioTimeProps = { page: Page }

/** How far the page's audio has played, in seconds: the furthest of its elements. */
export const audioTime = ({ page }: AudioTimeProps): Promise<number> =>
  page.evaluate(() =>
    Math.max(0, ...[...document.querySelectorAll('audio')].map((audio) => audio.currentTime)),
  )
