import { join } from 'node:path'
import { type Page, defineConfig } from '@playwright/test'
import { FIXTURE_SERVER } from '@raven/core/fixtureServer'

const SERVER_DIR = join(import.meta.dirname, '..', '..', 'apps', 'raven', 'server')

/** The files each suite runs: the flows, and the accessibility scan of every page. */
export const SUITE_MATCHES = {
  e2e: '**/*.e2e.ts',
  axe: '**/*.axe.ts',
} as const

/** What every suite's config starts from: where its files are and how a run reports. */
export const SUITE_DEFAULTS = {
  testDir: 'e2e',
  // Bun's test runner never picks these up.
  testMatch: SUITE_MATCHES.e2e,
  retries: process.env.CI ? 1 : 0,
  forbidOnly: !!process.env.CI,
  reporter: 'list',
  outputDir: 'test-results',
} as const

type FixtureWebServerProps = {
  /** The fixture's port, one per suite so the suites can run side by side. */
  port: number
  /** The built web app the fixture serves beside its API; none when the suite's app serves its own page. */
  webDir?: string
}

/** Playwright's `webServer` for a suite: `@raven/server`'s fixture, a real accountless raven. */
export const fixtureWebServer = ({ port, webDir }: FixtureWebServerProps) =>
  ({
    command: 'bun run serve:fixture',
    cwd: SERVER_DIR,
    env: {
      ...(webDir === undefined ? {} : { [FIXTURE_SERVER.env.webDir]: webDir }),
      [FIXTURE_SERVER.env.port]: String(port),
    },
    url: `http://${FIXTURE_SERVER.host}:${port}${FIXTURE_SERVER.readyPath}`,
    // A fresh fixture each run, so nothing an earlier run left behind decides this one.
    reuseExistingServer: false,
    // It encodes its clips and scans them before it listens.
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
  }) as const

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
export const fixtureSuiteConfig = ({ projectDir, port, suite }: FixtureSuiteProps) =>
  defineConfig({
    ...SUITE_DEFAULTS,
    testMatch: SUITE_MATCHES[suite ?? 'e2e'],
    workers: 1,
    timeout: 60_000,
    use: {
      baseURL: `http://${FIXTURE_SERVER.host}:${port}`,
      /*
       * Google Chrome, not Playwright's Chromium, which has no H.264 or AAC to play the fixture's
       * films and transcodes with. GitHub's Ubuntu runners have it installed.
       */
      channel: 'chrome',
      trace: 'retain-on-failure',
      // An app's offline worker would answer navigations itself; each test reaches the fixture.
      serviceWorkers: 'block',
    },
    webServer: fixtureWebServer({ port, webDir: join(projectDir, 'dist') }),
  })

type AudioTimeProps = { page: Page }

/** How far the page's audio has played, in seconds: the furthest of its elements. */
export const audioTime = ({ page }: AudioTimeProps): Promise<number> =>
  page.evaluate(() =>
    Math.max(0, ...[...document.querySelectorAll('audio')].map((audio) => audio.currentTime)),
  )
