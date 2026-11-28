import { type ElectronApplication, expect, type Page, test } from '@playwright/test'
import {
  COMPUTER_NAMES,
  DESKTOP_PLATFORMS,
  DESKTOP_REPLIES,
  DESKTOP_REQUESTS,
  playLinkFor,
  RAVEN_DESKTOP_BRIDGE_KEY,
  WINDOW_ACTIONS,
  WINDOW_CHROMES,
} from '@raven/core'
import { makeClips, makeTrackClip } from '@/e2e/clips'
import { FIXTURE_MEDIA, FIXTURE_MOVIE_NAMES } from '@/e2e/fixtureLibrary'
import { type FixtureServer, startWebFixture } from '@/e2e/fixtureServer'
import {
  closeApp,
  expectOffline,
  freshUserData,
  hasExited,
  launchAgain,
  launchApp,
  processHasExited,
  QUIT_MS,
  removeDir,
  requestFromPage,
  serverEnv,
  sideLink,
  signIn,
  withApp,
} from '@/e2e/harness'
import { expectPlayingNatively } from '@/e2e/playerView'

/*
 * Only Windows runs this file (`platformSpecs.ts`): its window has no frame, so the page draws
 * the controls macOS's traffic lights are, and a `raven://` link reaches the app as an argument.
 */

/** Where the page says who draws the window's controls. */
const CHROME = { attribute: 'data-desktop' } as const

/** The landmark that holds the controls, by its label. */
const CONTROLS_LANDMARK = 'Window'

/** The page's three controls, by the label each carries, in the order they are drawn. */
const CONTROL_LABELS = {
  minimize: 'Minimize',
  maximize: 'Maximize or restore',
  close: 'Close',
} as const

type ControlLabel = (typeof CONTROL_LABELS)[keyof typeof CONTROL_LABELS]

/*
 * Settings' line under "This computer", as `THIS_COMPUTER_COPY.help` words it. Written out,
 * since that module imports the web app's own `@/` modules, which this project cannot resolve;
 * the computer's name is core's.
 */
const soundHelpFor = (computer: string) => `How Raven sends sound from this ${computer}.`

type ControlProps = { page: Page; label: ControlLabel }

/** One of the window controls the page draws, by its label. */
const control = ({ page, label }: ControlProps) =>
  page
    .getByRole('navigation', { name: CONTROLS_LANDMARK })
    .getByRole('button', { name: label, exact: true })

type WindowState = { isMaximized: boolean; isMinimized: boolean }

/** How Electron says the app's one window stands; null when it has none. */
const windowState = (app: ElectronApplication): Promise<WindowState | null> =>
  app.evaluate(({ BrowserWindow }) => {
    const [window] = BrowserWindow.getAllWindows()
    if (window === undefined) return null
    return { isMaximized: window.isMaximized(), isMinimized: window.isMinimized() }
  })

/** Brings a minimized window back, as a click on its taskbar button would. */
const restoreWindow = (app: ElectronApplication): Promise<void> =>
  app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows().forEach((window) => window.restore())
  })

type OfflineApp = { app: ElectronApplication; page: Page }

type WithOfflineAppProps = { run: (input: OfflineApp) => Promise<void> }

/** A launch on a throwaway profile with no server, open on the offline frame. */
const withOfflineApp = async ({ run }: WithOfflineAppProps): Promise<void> => {
  const userData = await freshUserData()
  try {
    await withApp({
      userData,
      run: async ({ app, page }) => {
        await expectOffline({ page })
        await run({ app, page })
      },
    })
  } finally {
    await removeDir(userData)
  }
}

test.describe('the window Raven draws on Windows', () => {
  test('says it runs on Windows and draws its own window controls', async () => {
    await withOfflineApp({
      run: async ({ page }) => {
        const platform = await page.evaluate((key) => {
          const bridge: unknown = Reflect.get(window, key)
          if (typeof bridge !== 'object' || bridge === null || !('platform' in bridge)) return null
          return bridge.platform
        }, RAVEN_DESKTOP_BRIDGE_KEY)
        expect(platform).toBe(DESKTOP_PLATFORMS.windows)
        await expect(page.locator(':root')).toHaveAttribute(CHROME.attribute, WINDOW_CHROMES.drawn)
        await Promise.all(
          Object.values(CONTROL_LABELS).map((label) =>
            expect(control({ page, label })).toBeVisible(),
          ),
        )
      },
    })
  })

  test('maximizes, restores and minimizes from the controls the page draws', async () => {
    await withOfflineApp({
      run: async ({ app, page }) => {
        expect(await windowState(app)).toEqual({ isMaximized: false, isMinimized: false })

        await control({ page, label: CONTROL_LABELS.maximize }).click()
        await expect.poll(() => windowState(app)).toMatchObject({ isMaximized: true })
        await control({ page, label: CONTROL_LABELS.maximize }).click()
        await expect.poll(() => windowState(app)).toMatchObject({ isMaximized: false })

        await control({ page, label: CONTROL_LABELS.minimize }).click()
        await expect.poll(() => windowState(app)).toMatchObject({ isMinimized: true })
        await restoreWindow(app)
        await expect.poll(() => windowState(app)).toMatchObject({ isMinimized: false })
      },
    })
  })

  test('takes a window control as a request on the bridge', async () => {
    await withOfflineApp({
      run: async ({ app, page }) => {
        const reply = await requestFromPage({
          page,
          request: { type: DESKTOP_REQUESTS.windowControl, action: WINDOW_ACTIONS.maximize },
        })
        expect(reply?.type ?? null).toBe(DESKTOP_REPLIES.done)
        await expect.poll(() => windowState(app)).toMatchObject({ isMaximized: true })
      },
    })
  })

  test('quits when the Close the page draws is pressed', async () => {
    const userData = await freshUserData()
    const { app, page } = await launchApp({ userData })
    try {
      await expectOffline({ page })
      // Held before the click: once the app has quit, Playwright can no longer hand it over.
      const child = app.process()
      /*
       * The window may be gone before Playwright hears its click land, which it reports as a
       * failed click; the app ending is what the test reads.
       */
      await control({ page, label: CONTROL_LABELS.close })
        .click()
        .catch(() => undefined)
      await expect.poll(() => processHasExited(child), { timeout: QUIT_MS }).toBe(true)
    } finally {
      await closeApp({ app }).catch(() => undefined)
      await removeDir(userData)
    }
  })

  test('calls the computer a PC', async () => {
    await withOfflineApp({
      run: async ({ page }) => {
        await sideLink({ page, name: 'Settings' }).click()
        const section = page.getByRole('region', { name: 'This computer' })
        await expect(section).toBeVisible()
        await expect(
          section.getByText(soundHelpFor(COMPUTER_NAMES[DESKTOP_PLATFORMS.windows]), {
            exact: true,
          }),
        ).toBeVisible()
        await expect(page.getByText(`this ${COMPUTER_NAMES[DESKTOP_PLATFORMS.mac]}`)).toHaveCount(0)
      },
    })
  })
})

// Windows hands a link over as an argument: to the running app from a second launch, or at launch.
test.describe.serial('a raven:// link passed as an argument', () => {
  let userData = ''
  let folders: string[] = []
  let started: FixtureServer | null = null

  const server = (): FixtureServer => {
    if (started === null) throw new Error('The fixture server is not running.')
    return started
  }

  /** A link to the fixture's first movie, as the web's watch page writes one. */
  const movieLink = (): string =>
    playLinkFor({ origin: server().origin, mediaId: FIXTURE_MEDIA.first, at: 0, next: [] })

  test.beforeAll(async () => {
    userData = await freshUserData()
    const [clips, track] = await Promise.all([makeClips(), makeTrackClip()])
    folders = [clips.folder, track.folder]
    started = await startWebFixture({
      clips: { first: clips.first, second: clips.second, tracks: track.path },
    })
  })

  test.afterAll(async () => {
    const closing = started === null ? Promise.resolve() : started.close()
    await closing.finally(() =>
      Promise.all([removeDir(userData), ...folders.map((folder) => removeDir(folder))]),
    )
  })

  test('opens the link a second launch was given, in the Raven already running', async () => {
    const env = serverEnv({ origin: server().origin })
    await withApp({
      userData,
      env,
      run: async ({ app, page }) => {
        await signIn({ page })
        // The second Raven finds the first holding the profile, hands it its arguments and quits.
        await launchAgain({ userData, env, args: [movieLink()] })
        await expectPlayingNatively({ page, title: FIXTURE_MOVIE_NAMES.first })
        expect(hasExited(app)).toBe(false)
      },
    })
  })

  test('opens the link it was launched with', async () => {
    // Signed in by the test before, on the same profile.
    await withApp({
      userData,
      env: serverEnv({ origin: server().origin }),
      args: [movieLink()],
      run: async ({ page }) => {
        await expectPlayingNatively({ page, title: FIXTURE_MOVIE_NAMES.first })
      },
    })
  })
})
