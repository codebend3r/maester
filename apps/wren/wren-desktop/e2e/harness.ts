import { mkdtemp } from 'node:fs/promises'
import { connect } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  _electron,
  type ElectronApplication,
  type Locator,
  type Page,
  test,
} from '@playwright/test'
import { FIXTURE_SERVER } from '@raven/core/fixtureServer'
import { HOME_COPY, WREN_HOST_PORT } from '@raven/wren'
import { hasExited, quitWithin, removeFolder, withLaunched } from '@tooling/web/electron'
import { FIXTURE_ORIGIN } from '@/e2e/fixture'
import { EVENTS } from '@/main/events'
import { SERVER_ORIGIN_ENV } from '@/main/origins'
import { USER_DATA_ENV } from '@/main/userData'

export { browserOpens, removeFolder, stubBrowser } from '@tooling/web/electron'

// `cwd` with `args: ['.']` runs the built app the way `electron .` does: package.json's `main`.
const PROJECT_DIR = join(import.meta.dirname, '..')
// Quit ends Wren at once; one that hangs is a bug, not a slow test.
const QUIT_MS = 10_000
// How long the first quit is put off. Without the wait, `app.close()` hung on Wren.
const QUIT_AFTER_MS = 250

const { album } = FIXTURE_SERVER

type Launched = { app: ElectronApplication; page: Page }

/** A throwaway profile, so no test reads or writes the data of a Wren installed on this Mac. */
export const freshUserData = (): Promise<string> => mkdtemp(join(tmpdir(), 'wren-e2e-user-'))

/** What a socket says of a connection it was asked to make. */
export const SOCKET_EVENTS = { connect: 'connect', error: 'error' } as const

/** Whether something on this Mac already listens on the web host's fixed port. */
const isHostPortTaken = (): Promise<boolean> =>
  new Promise((resolve) => {
    const socket = connect({ host: 'localhost', port: WREN_HOST_PORT })
    socket.once(SOCKET_EVENTS.connect, () => {
      socket.destroy()
      resolve(true)
    })
    socket.once(SOCKET_EVENTS.error, () => resolve(false))
  })

type CloseAppProps = { app: ElectronApplication }

/*
 * Quits the app as Quit does and waits for its process to end, killing it past the deadline.
 * The first quit Playwright asks for is cancelled and made again from inside the app
 * `QUIT_AFTER_MS` later: quitting at once, `app.close()` never returned on Wren.
 */
const closeApp = async ({ app }: CloseAppProps): Promise<void> => {
  if (hasExited(app)) return
  await app.evaluate(
    ({ app: electronApp }, { beforeQuit, ms }) => {
      electronApp.once(beforeQuit, (event) => {
        event.preventDefault()
        setTimeout(() => electronApp.quit(), ms)
      })
    },
    { beforeQuit: EVENTS.beforeQuit, ms: QUIT_AFTER_MS },
  )
  await quitWithin({ app, ms: QUIT_MS, name: 'Wren' })
}

type LaunchAppProps = { userData: string }

/*
 * Launches the built app unpackaged, on a throwaway profile, with `/api` sent to the fixture.
 * Both hooks are always set, so a variable exported in the developer's shell, the build's own
 * server and the real Wren's data are never used.
 */
const launchApp = async ({ userData }: LaunchAppProps): Promise<Launched> => {
  if (await isHostPortTaken()) {
    /*
     * The app would open a dialog about the port and quit. Wren serves its page from one fixed
     * port, so the suite cannot run beside another Wren.
     */
    throw new Error(`Port ${WREN_HOST_PORT} is in use. Quit Wren, then run the suite again.`)
  }
  const app = await _electron.launch({
    /*
     * Chromium's fake audio sink: playback is clocked by the audio output, so a real device
     * whose clock has stalled (an asleep USB interface) would freeze `currentTime` at 0.
     */
    args: ['--disable-audio-output', '.'],
    cwd: PROJECT_DIR,
    env: {
      ...process.env,
      [USER_DATA_ENV]: userData,
      [SERVER_ORIGIN_ENV]: FIXTURE_ORIGIN,
    },
  })
  const page = await app.firstWindow().catch(async (error: unknown) => {
    await closeApp({ app }).catch(() => undefined)
    throw error
  })
  return { app, page }
}

type WithAppProps<T> = LaunchAppProps & { run: (launched: Launched) => Promise<T> }

/** Launches the app, runs `run` against it and always quits it after, so no process outlives a test. */
export const withApp = <T>({ run, ...launch }: WithAppProps<T>): Promise<T> =>
  withLaunched({ launch: () => launchApp(launch), close: closeApp, run })

/** The suite's one Wren, and the throwaway profile it runs on. */
type Running = Launched & { userData: string }

/**
 * One Wren for all of a describe's tests: launched on a throwaway profile before the first and
 * quit after the last. Returns what reads it, which throws before the launch.
 */
export const appForSuite = (): (() => Running) => {
  let userData = ''
  let launched: Launched | null = null

  test.beforeAll(async () => {
    userData = await freshUserData()
    launched = await launchApp({ userData })
  })

  test.afterAll(async () => {
    const quit = launched === null ? Promise.resolve() : closeApp({ app: launched.app })
    await quit.finally(() => removeFolder({ path: userData }))
  })

  return () => {
    if (launched === null) throw new Error('Wren is not running.')
    return { ...launched, userData }
  }
}

type PageProps = { page: Page }

type NamedProps = { page: Page; name: string }

/** Home's tile says when its album was added after its name, so it is found by how it starts. */
export const homeTile = ({ page }: PageProps): Locator =>
  page.getByRole('link', { name: new RegExp(`^${album.title}, ${album.artist}`, 'u') })

/** A place in the sidebar, the navigation whose Home link is named Home alone. */
export const sideLink = ({ page, name }: NamedProps): Locator =>
  page
    .getByRole('navigation')
    .filter({ has: page.getByRole('link', { name: HOME_COPY.title, exact: true }) })
    .getByRole('link', { name, exact: true })

type HeadingProps = { page: Page; name: string | RegExp }

/** A page's main heading, by its name. */
export const heading = ({ page, name }: HeadingProps): Locator =>
  page.getByRole('heading', { level: 1, name })
