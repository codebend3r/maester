import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { _electron, type ElectronApplication, expect, type Page } from '@playwright/test'
import {
  DESKTOP_PLATFORMS,
  DESKTOP_REPLIES,
  DESKTOP_REQUESTS,
  type DesktopPlatform,
  type DesktopReply,
  isDesktopReply,
} from '@raven/core'
import { quitWithin, removeFolder, withLaunched } from '@tooling/web/electron'
import { DESKTOP_ENV } from '@/shared/platform'
import { FIXTURE_ACCOUNT } from '@/e2e/fixtureAuth'
import { E2E_PLATFORM, E2E_SYSTEM, makeTempDir } from '@/e2e/platform'
import { withoutTestHooks } from '@/build/smokeVerdict'
import { LOG_FILE } from '@/main/log/log'
import { ENGINE_MODES } from '@/main/player/engine'
import { ERROR_CODES } from '@/main/stateStore'
import { AUTH_ORIGIN_HOOK } from '@/main/origins'

export { browserOpens, hasExited, processHasExited, stubBrowser } from '@tooling/web/electron'

// `cwd` with `args: ['.']` runs the built app the way `electron .` does: package.json's `main`.
const PROJECT_DIR = join(import.meta.dirname, '..')
// A quit that hangs is a bug (the quit gate gives up flushing after a second), not a slow test.
export const QUIT_MS = 10_000
// Every budget mark main prints on stdout (Ruling 14): `raven-<name> <n>` on a line of its own.
const MARK_LINE = /^raven-([a-z][a-z0-9-]*) (\d+(?:\.\d+)?)$/

/**
 * The server a launch without a fixture points at: the discard port, where nothing listens, so
 * the page finds no server and opens the offline frame. Never the build's default, which on a
 * developer's Mac may be a real raven.
 */
export const NO_SERVER = 'http://127.0.0.1:9'

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

export const freshUserData = (): Promise<string> => makeTempDir('raven-e2e-user-')

/** Removes a folder a test made, trying again as often as the system needs. */
export const removeDir = (path: string): Promise<void> =>
  removeFolder({ path, maxRetries: E2E_SYSTEM.removeRetries })

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

/*
 * Listens from the moment launch returns: Playwright holds `ready` until it has connected,
 * so the window, and every mark printed from then on, come after.
 */
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
export const closeApp = ({ app }: CloseAppProps): Promise<void> =>
  quitWithin({ app, ms: QUIT_MS, name: 'Raven', forceEnd: E2E_SYSTEM.forceEnd })

/** Headless mpv (`vo=null`, `ao=null`), or none, which is the html fallback's run (Ruling 15). */
export type MpvMode = typeof ENGINE_MODES.headless | typeof ENGINE_MODES.off

type LaunchAppProps = {
  userData: string
  mpv?: MpvMode
  /** Extra variables for main, such as a test hook, merged last. */
  env?: Readonly<Record<string, string>>
  /** Another Electron to run the app on, such as `hardenedElectron`'s; the checkout's by default. */
  executable?: string
  /** What the launch is handed after the app itself, as Windows hands over a `raven://` link. */
  args?: readonly string[]
}

/*
 * Chromium's fake audio sink: playback is clocked by the audio output, so a real device
 * whose clock has stalled (an asleep USB interface) would freeze `currentTime` at 0.
 */
const APP_ARGS = ['--disable-audio-output', '.'] as const

type AppEnvProps = Required<Pick<LaunchAppProps, 'userData' | 'mpv' | 'env'>>

/*
 * e2e never drives the window surface (Ruling 15). A hook exported in the developer's
 * shell is dropped, so only the hooks a test names reach the app.
 */
const appEnv = ({ userData, mpv, env }: AppEnvProps): Record<string, string> => ({
  ...withoutTestHooks({ env: process.env }),
  RAVEN_DESKTOP_USER_DATA: userData,
  RAVEN_DESKTOP_MPV: mpv,
  [DESKTOP_ENV.serverOrigin]: NO_SERVER,
  ...env,
})

export const launchApp = async ({
  userData,
  mpv = ENGINE_MODES.headless,
  env = {},
  executable,
  args = [],
}: LaunchAppProps): Promise<Launched> => {
  const app = await _electron.launch({
    executablePath: executable,
    args: [...APP_ARGS, ...args],
    cwd: PROJECT_DIR,
    env: appEnv({ userData, mpv, env }),
  })
  const marks = readMarks(app)
  const output = readOutput(app)
  const page = await app.firstWindow().catch(async (error: unknown) => {
    await closeApp({ app }).catch(() => undefined)
    throw error
  })
  return { app, page, marks, output }
}

type WithAppProps<T> = LaunchAppProps & { run: (launched: Launched) => Promise<T> }

/** Launches the app, runs `run` against it and always quits it after, so no process outlives a test. */
export const withApp = <T>({ run, ...launch }: WithAppProps<T>): Promise<T> =>
  withLaunched({ launch: () => launchApp(launch), close: closeApp, run })

// `require('electron')` outside Electron is the path of the executable Playwright launches.
export const electronExecutable = (): string => {
  const path: unknown = createRequire(import.meta.url)('electron')
  if (typeof path !== 'string') throw new Error('The electron package named no executable.')
  return path
}

type LaunchAgainProps = Pick<LaunchAppProps, 'userData' | 'mpv' | 'env'> & {
  /** What the second launch is handed after the app itself: the links it should open. */
  args: readonly string[]
}

/**
 * Launches Raven a second time on a profile a running Raven holds, as clicking a `raven://`
 * link does on Windows, and waits for it to end: it finds the first holding the profile, hands
 * its arguments over and quits. Fails when it does not end within the quit deadline.
 */
export const launchAgain = ({
  userData,
  mpv = ENGINE_MODES.headless,
  env = {},
  args,
}: LaunchAgainProps): Promise<void> =>
  new Promise((resolve, reject) => {
    execFile(
      electronExecutable(),
      [...APP_ARGS, ...args],
      { cwd: PROJECT_DIR, env: appEnv({ userData, mpv, env }), timeout: QUIT_MS },
      (error) => {
        if (error === null) return resolve()
        reject(new Error(`The second Raven did not hand over and quit: ${error.message}`))
      },
    )
  })

type OpenUrlProps = { app: ElectronApplication; url: string }

/*
 * How a `raven://` link reaches the running app from outside. macOS sends `open-url`. Windows
 * launches the app again with the link as an argument, and the running app hears that launch's
 * arguments as `second-instance`: the executable first, as `linksFromArgv` expects.
 */
const LINK_EVENTS = { openUrl: 'open-url', secondInstance: 'second-instance' } as const

const LINK_DELIVERIES = {
  [DESKTOP_PLATFORMS.mac]: async ({ app, url }: OpenUrlProps) => {
    await app.evaluate(
      ({ app: electronApp }, { event, link }) => {
        electronApp.emit(event, { preventDefault: () => undefined }, link)
      },
      { event: LINK_EVENTS.openUrl, link: url },
    )
  },
  [DESKTOP_PLATFORMS.windows]: async ({ app, url }: OpenUrlProps) => {
    await app.evaluate(
      ({ app: electronApp }, { event, link }) => {
        electronApp.emit(event, {}, [process.execPath, link], process.cwd())
      },
      { event: LINK_EVENTS.secondInstance, link: url },
    )
  },
} as const satisfies Record<DesktopPlatform, (input: OpenUrlProps) => Promise<void>>

/** Hands the running app a `raven://` link the way its system does, by the event main listens for. */
export const openUrl = (input: OpenUrlProps): Promise<void> => LINK_DELIVERIES[E2E_PLATFORM](input)

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

/**
 * The share of the download named `label` main has stored as watched, in whole percent, as its
 * row on Downloads shows it; null until main has read its file.
 */
export const watchedPercent = async ({
  page,
  label,
}: WatchedPercentProps): Promise<number | null> => {
  const reply = await requestFromPage({ page, request: { type: DESKTOP_REQUESTS.listDownloads } })
  if (reply === null || reply.type !== DESKTOP_REPLIES.downloads) return null
  const watched = reply.downloads.find((download) => download.label === label)?.watched ?? null
  return watched === null ? null : Math.round(watched * 100)
}

type HeadingProps = { page: Page; name: string }

/** A page's main heading, by its exact name. */
export const heading = ({ page, name }: HeadingProps) =>
  page.getByRole('heading', { name, exact: true, level: 1 })

type SideLinkProps = { page: Page; name: string }

/** A link in the side menu, by its exact name. */
export const sideLink = ({ page, name }: SideLinkProps) =>
  page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name, exact: true })

type ReadySideMenuProps = { page: Page }

/**
 * Makes the side menu's lower links reachable, as a person would. Its first-visit tip rises
 * over them, so that is put away; and Manage, which holds Libraries to Settings, starts folded,
 * so that is opened. Both are remembered, so a later launch on the same profile finds the tip
 * gone and Manage open.
 */
const readySideMenu = async ({ page }: ReadySideMenuProps): Promise<void> => {
  const menu = page.getByRole('navigation', { name: 'Main' })
  await expect(menu).toBeVisible()
  const tip = page.getByRole('complementary', { name: 'Tip' })
  if ((await tip.count()) > 0) {
    await tip.getByRole('button', { name: 'Got it' }).click()
    await expect(tip).toHaveCount(0)
  }
  const manage = menu.getByRole('button', { name: 'Manage', exact: true })
  if ((await manage.getAttribute('aria-expanded')) !== 'true') await manage.click()
  await expect(manage).toHaveAttribute('aria-expanded', 'true')
}

type ExpectOfflineProps = { page: Page }

/**
 * The frame Raven opens with no server to reach: Downloads, with only the pages that need
 * none in the side menu.
 */
export const expectOffline = async ({ page }: ExpectOfflineProps): Promise<void> => {
  await expect(heading({ page, name: 'Downloads' })).toBeVisible()
  await expect(sideLink({ page, name: 'Home' })).toHaveCount(0)
  await readySideMenu({ page })
}

type SignInProps = { page: Page }

/** Signs the fixture's account in through the web's own sign-in page and waits for Home. */
export const signIn = async ({ page }: SignInProps): Promise<void> => {
  await expect(heading({ page, name: 'Sign in to watch' })).toBeVisible()
  await page.getByRole('textbox', { name: 'Email' }).fill(FIXTURE_ACCOUNT.email)
  await page.getByRole('textbox', { name: 'Password' }).fill(FIXTURE_ACCOUNT.password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(heading({ page, name: 'Home' })).toBeVisible()
  await readySideMenu({ page })
}

type GoHomeProps = { page: Page }

/** Home, from the side menu. */
export const goHome = async ({ page }: GoHomeProps) => {
  await sideLink({ page, name: 'Home' }).click()
  await expect(heading({ page, name: 'Home' })).toBeVisible()
}
