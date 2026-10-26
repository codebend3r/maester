import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { setTimeout as delay } from 'node:timers/promises'
import { _electron, type ElectronApplication, expect, type Page } from '@playwright/test'
import {
  DESKTOP_ENV,
  DESKTOP_REPLIES,
  DESKTOP_REQUESTS,
  type DesktopReply,
  isDesktopReply,
} from '@raven/core'
import { FIXTURE_ACCOUNT } from '@/e2e/fixtureAuth'
import { withoutTestHooks } from '@/build/smokeVerdict'
import { LOG_FILE } from '@/main/log/log'
import { ENGINE_MODES } from '@/main/player/engine'
import { ERROR_CODES } from '@/main/stateStore'
import { AUTH_ORIGIN_HOOK } from '@/main/origins'

// `cwd` with `args: ['.']` runs the built app the way `electron .` does: package.json's `main`.
const PROJECT_DIR = join(import.meta.dirname, '..')
// A quit that hangs is a bug (the quit gate gives up flushing after a second), not a slow test.
const QUIT_MS = 10_000
// Every budget mark main prints on stdout (Ruling 14): `raven-<name> <n>` on a line of its own.
const MARK_LINE = /^raven-([a-z][a-z0-9-]*) (\d+(?:\.\d+)?)$/
const QUIT_OUTCOMES = { closed: 'closed', timeout: 'timeout' } as const

/**
 * The server a launch without a fixture points at: the discard port, where nothing listens, so
 * the page finds no server and opens the offline frame. Never the build's default, which on a
 * developer's Mac may be a real raven.
 */
const NO_SERVER = 'http://127.0.0.1:9'

type ServerEnvProps = { origin: string }

/** What points main's `/api` at a fixture, and lets the page sign in at its stand-in Auth. */
export const serverEnv = ({ origin }: ServerEnvProps): Record<string, string> => ({
  [DESKTOP_ENV.serverOrigin]: origin,
  [AUTH_ORIGIN_HOOK]: origin,
})

/** The marks main has printed so far, in order, and whether its stdout has closed. */
type Marks = {
  seen: ReadonlyArray<{ name: string; value: number }>
  isClosed: boolean
  /** Calls `listener` on every mark and on close, until the returned function is called. */
  watch: (listener: () => void) => () => void
}

/** Every line main printed so far, on stdout and on stderr, in the order each arrived. */
type Output = { lines: () => readonly string[] }

export type Launched = {
  app: ElectronApplication
  page: Page
  marks: Marks
  output: Output
}

export const freshUserData = (): Promise<string> => mkdtemp(join(tmpdir(), 'raven-e2e-user-'))

// A hook that failed before it made its folder leaves the path empty, which is not a folder to remove.
export const removeDir = async (path: string): Promise<void> => {
  if (path === '') return
  await rm(path, { recursive: true, force: true })
}

const isMissing = (error: unknown): boolean =>
  error instanceof Error && 'code' in error && error.code === ERROR_CODES.enoent

type LogPathForProps = { userData: string }

/** main's log under the test hook's userData (Ruling 11). */
export const logPathFor = ({ userData }: LogPathForProps): string =>
  join(userData, 'logs', LOG_FILE)

type ReadLogProps = { userData: string }

/** The lines main has written to its log so far; none before it has made the file. */
export const readLog = async ({ userData }: ReadLogProps): Promise<string[]> => {
  const text = await readFile(logPathFor({ userData }), 'utf8').catch((error: unknown) => {
    if (isMissing(error)) return ''
    throw error
  })
  return text.split('\n').filter((line) => line !== '')
}

const hasExited = (app: ElectronApplication): boolean => {
  const child = app.process()
  return child.exitCode !== null || child.signalCode !== null
}

// Listens from the moment launch returns: Playwright holds `ready` until it has connected,
// so the window, and every mark printed from then on, come after.
const readMarks = (app: ElectronApplication): Marks => {
  const listeners = new Set<() => void>()
  const marks = {
    seen: new Array<{ name: string; value: number }>(),
    isClosed: false,
    watch: (listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
  const tell = () => [...listeners].forEach((listener) => listener())
  const { stdout } = app.process()
  if (stdout === null) {
    marks.isClosed = true
    return marks
  }
  const lines = createInterface({ input: stdout })
  lines.on('line', (line) => {
    const match = MARK_LINE.exec(line)
    if (match === null) return
    const [, name = '', value = ''] = match
    marks.seen.push({ name, value: Number(value) })
    tell()
  })
  lines.once('close', () => {
    marks.isClosed = true
    tell()
  })
  return marks
}

// Read beside the marks from launch on, so a test can check what main wrote to its logs.
const readOutput = (app: ElectronApplication): Output => {
  const lines: string[] = []
  const { stdout, stderr } = app.process()
  const streams = [stdout, stderr]
  streams.forEach((stream) => {
    if (stream === null) return
    createInterface({ input: stream }).on('line', (line) => {
      lines.push(line)
    })
  })
  return { lines: () => [...lines] }
}

type MarkWithinProps = {
  launched: Launched
  name: string
  ms: number
}

/**
 * The first `raven-<name>` mark main printed in this run, waiting up to `ms` for it, and
 * failing with a clear error when it has not come or the app quit first.
 */
export const markWithin = ({ launched: { marks }, name, ms }: MarkWithinProps): Promise<number> =>
  new Promise((resolve, reject) => {
    const settle = (finish: () => void) => {
      clearTimeout(timer)
      unwatch()
      finish()
    }
    const check = () => {
      const found = marks.seen.find((mark) => mark.name === name)
      if (found !== undefined) return settle(() => resolve(found.value))
      if (!marks.isClosed) return
      settle(() => reject(new Error(`Raven quit before printing its ${name} mark.`)))
    }
    const timer = setTimeout(() => {
      settle(() => reject(new Error(`Raven's ${name} mark was not seen within ${ms} ms.`)))
    }, ms)
    const unwatch = marks.watch(check)
    check()
  })

type LaunchMarkWithinProps = { launched: Launched; ms: number }

/** main's launch mark, printed at ready-to-show, so it is never far behind the window. */
export const launchMarkWithin = ({ launched, ms }: LaunchMarkWithinProps) =>
  markWithin({ launched, name: 'launch-ms', ms })

type CloseAppProps = { app: ElectronApplication }

/** Quits the app as a person would and waits for its process to end, killing it past the deadline. */
export const closeApp = async ({ app }: CloseAppProps): Promise<void> => {
  if (hasExited(app)) return
  const deadline = new AbortController()
  const outcome = await Promise.race([
    app.close().then(() => QUIT_OUTCOMES.closed),
    delay(QUIT_MS, QUIT_OUTCOMES.timeout, { signal: deadline.signal }),
  ])
  deadline.abort()
  if (outcome === QUIT_OUTCOMES.closed) return
  app.process().kill('SIGKILL')
  throw new Error(`Raven did not quit within ${QUIT_MS} ms.`)
}

/** Headless mpv (`vo=null`, `ao=null`), or none, which is the html fallback's run (Ruling 15). */
export type MpvMode = typeof ENGINE_MODES.headless | typeof ENGINE_MODES.off

type LaunchAppProps = {
  userData: string
  mpv?: MpvMode
  /** Extra variables for main, such as a test hook, merged last. */
  env?: Readonly<Record<string, string>>
}

export const launchApp = async ({
  userData,
  mpv = ENGINE_MODES.headless,
  env = {},
}: LaunchAppProps): Promise<Launched> => {
  const app = await _electron.launch({
    // Chromium's fake audio sink: playback is clocked by the audio output, so a real device
    // whose clock has stalled (an asleep USB interface) would freeze `currentTime` at 0.
    args: ['--disable-audio-output', '.'],
    cwd: PROJECT_DIR,
    // e2e never drives the window surface (Ruling 15). A hook exported in the developer's
    // shell is dropped, so only the hooks a test names reach the app.
    env: {
      ...withoutTestHooks({ env: process.env }),
      RAVEN_DESKTOP_USER_DATA: userData,
      RAVEN_DESKTOP_MPV: mpv,
      [DESKTOP_ENV.serverOrigin]: NO_SERVER,
      ...env,
    },
  })
  const marks = readMarks(app)
  const output = readOutput(app)
  const page = await app.firstWindow().catch(async (error: unknown) => {
    await closeApp({ app }).catch(() => undefined)
    throw error
  })
  return { app, page, marks, output }
}

type WithAppProps<T> = {
  userData: string
  mpv?: MpvMode
  env?: Readonly<Record<string, string>>
  run: (launched: Launched) => Promise<T>
}

/** Launches the app, runs `run` against it and always quits it after, so no process outlives a test. */
export const withApp = async <T>({ userData, mpv, env, run }: WithAppProps<T>): Promise<T> => {
  const launched = await launchApp({ userData, mpv, env })
  const result = await run(launched).catch(async (error: unknown) => {
    await closeApp({ app: launched.app }).catch(() => undefined)
    throw error
  })
  await closeApp({ app: launched.app })
  return result
}

type OpenFileProps = {
  app: ElectronApplication
  path: string
}

/** The event Finder sends for "Open With" and a double-click, emitted on the running app. */
export const openFile = async ({ app, path }: OpenFileProps): Promise<void> => {
  await app.evaluate(({ app: electronApp }, file) => {
    electronApp.emit('open-file', { preventDefault: () => undefined }, file)
  }, path)
}

type OpenUrlProps = { app: ElectronApplication; url: string }

/** The event macOS sends for a `raven://` link, emitted on the running app. */
export const openUrl = async ({ app, url }: OpenUrlProps) => {
  await app.evaluate(({ app: electronApp }, link) => {
    electronApp.emit('open-url', { preventDefault: () => undefined }, link)
  }, url)
}

const BROWSER_OPENS_KEY = 'ravenE2eBrowserOpens'

type StubBrowserProps = { app: ElectronApplication }

/**
 * Records what main hands the browser instead of opening it. main reads
 * `shell.openExternal` at each call, so the stand-in takes its place.
 */
export const stubBrowser = async ({ app }: StubBrowserProps): Promise<void> => {
  await app.evaluate(({ shell }, key) => {
    Reflect.set(globalThis, key, [])
    const open = async (...args: unknown[]) => {
      const [url] = args
      const opened: unknown = Reflect.get(globalThis, key)
      const earlier = Array.isArray(opened)
        ? opened.filter((item): item is string => typeof item === 'string')
        : []
      Reflect.set(globalThis, key, [...earlier, typeof url === 'string' ? url : ''])
    }
    Reflect.set(shell, 'openExternal', open)
  }, BROWSER_OPENS_KEY)
}

type BrowserOpensProps = { app: ElectronApplication }

/** What main handed the browser since `stubBrowser`, in order. */
export const browserOpens = async ({ app }: BrowserOpensProps): Promise<string[]> => {
  const opened = await app.evaluate((_modules, key) => {
    const value: unknown = Reflect.get(globalThis, key)
    return value
  }, BROWSER_OPENS_KEY)
  return Array.isArray(opened)
    ? opened.filter((item): item is string => typeof item === 'string')
    : []
}

type RequestFromPageProps = {
  page: Page
  request: Record<string, string | null>
}

/**
 * A request sent from the page through the preload's bridge, as the renderer sends it,
 * and main's reply narrowed here. null when the page has no bridge or main answered
 * something that is not a reply.
 */
export const requestFromPage = async ({
  page,
  request,
}: RequestFromPageProps): Promise<DesktopReply | null> => {
  const reply = await page.evaluate(async (sent) => {
    if (!('ravenDesktop' in window)) return null
    const bridge = window.ravenDesktop
    if (typeof bridge !== 'object' || bridge === null || !('request' in bridge)) return null
    if (typeof bridge.request !== 'function') return null
    const answer: unknown = await bridge.request(sent)
    return answer
  }, request)
  return isDesktopReply(reply) ? reply : null
}

type WatchedPercentProps = {
  page: Page
  label: string
}

/** The share of `label` main has stored as watched, in whole percent, as On this Mac labels it. */
export const watchedPercent = async ({
  page,
  label,
}: WatchedPercentProps): Promise<number | null> => {
  const reply = await requestFromPage({ page, request: { type: DESKTOP_REQUESTS.listRecents } })
  if (reply === null || reply.type !== DESKTOP_REPLIES.recents) return null
  const recent = reply.recents.find((entry) => entry.label === label)
  if (recent === undefined || recent.watched === null) return null
  return Math.round(recent.watched * 100)
}

type HeadingProps = { page: Page; name: string }

/** A page's main heading, by its exact name. */
export const heading = ({ page, name }: HeadingProps) =>
  page.getByRole('heading', { name, exact: true, level: 1 })

type SideLinkProps = { page: Page; name: string }

/** A link in the side menu, by its exact name. */
export const sideLink = ({ page, name }: SideLinkProps) =>
  page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name, exact: true })

type DismissMenuTipProps = { page: Page }

/**
 * The side menu's first-visit tip rises over its lower links on a window as short as CI's, so a
 * test puts it away before it clicks them, as a person would. Once put away it stays away, so a
 * later launch on the same profile has none.
 */
const dismissMenuTip = async ({ page }: DismissMenuTipProps): Promise<void> => {
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible()
  const tip = page.getByRole('complementary', { name: 'Tip' })
  if ((await tip.count()) === 0) return
  await tip.getByRole('button', { name: 'Got it' }).click()
  await expect(tip).toHaveCount(0)
}

type ExpectOfflineProps = { page: Page }

/**
 * The frame Raven opens with no server to reach: Downloads, with only the pages that need
 * none in the side menu.
 */
export const expectOffline = async ({ page }: ExpectOfflineProps): Promise<void> => {
  await expect(heading({ page, name: 'Downloads' })).toBeVisible()
  await expect(sideLink({ page, name: 'Home' })).toHaveCount(0)
  await dismissMenuTip({ page })
}

type SignInProps = { page: Page }

/** Signs the fixture's account in through the web's own sign-in page and waits for Home. */
export const signIn = async ({ page }: SignInProps): Promise<void> => {
  await expect(heading({ page, name: 'Welcome back' })).toBeVisible()
  await page.getByRole('textbox', { name: 'Email' }).fill(FIXTURE_ACCOUNT.email)
  await page.getByRole('textbox', { name: 'Password' }).fill(FIXTURE_ACCOUNT.password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(heading({ page, name: 'Home' })).toBeVisible()
  await dismissMenuTip({ page })
}
