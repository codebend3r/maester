import { expect, test } from '@playwright/test'
import { PAGE_ORIGIN, SERVER_METHODS } from '@raven/core'
import { makeClips, makeTrackClip } from '@/e2e/clips'
import { FIXTURE_MEDIA, FIXTURE_MOVIE_NAMES, FIXTURE_TITLES } from '@/e2e/fixtureLibrary'
import { type FixtureServer, isTicketOnly, MEDIA_PATHS, startWebFixture } from '@/e2e/fixtureServer'
import {
  closeApp,
  freshUserData,
  heading,
  type Launched,
  launchApp,
  removeDir,
  serverEnv,
  sideLink,
  signIn,
  withApp,
} from '@/e2e/harness'
import { expectPlayingNatively, wake } from '@/e2e/playerView'

/** The web's own sign-in, Home and title pages, and a title they play, all in the app's window. */
test.describe.serial('the raven web app in raven player', () => {
  let userData = ''
  let folders: string[] = []
  let started: FixtureServer | null = null
  let launched: Launched | null = null

  const server = (): FixtureServer => {
    if (started === null) throw new Error('The fixture server is not running.')
    return started
  }

  const running = (): Launched => {
    if (launched === null) throw new Error('raven player is not running.')
    return launched
  }

  test.beforeAll(async () => {
    userData = await freshUserData()
    const [clips, track] = await Promise.all([makeClips(), makeTrackClip()])
    folders = [clips.folder, track.folder]
    started = await startWebFixture({
      clips: { first: clips.first, second: clips.second, tracks: track.path },
    })
    launched = await launchApp({ userData, env: serverEnv({ origin: started.origin }) })
  })

  test.afterAll(async () => {
    const quit = launched === null ? Promise.resolve() : closeApp({ app: launched.app })
    await quit.finally(async () => {
      await Promise.all([
        started === null ? undefined : started.close(),
        removeDir(userData),
        ...folders.map((folder) => removeDir(folder)),
      ])
    })
  })

  test('signs in through the web sign-in page', async () => {
    const { page } = running()
    await expect(page).toHaveURL(new RegExp(`^${PAGE_ORIGIN}/sign-in`, 'u'))
    await signIn({ page })
    expect(page.url()).toBe(`${PAGE_ORIGIN}/`)
  })

  test('shows Home with the side menu, the app pages beside the web ones', async () => {
    const { page } = running()
    await Promise.all(
      ['Home', 'Favourites', 'Libraries', 'On this Mac', 'Downloads', 'Settings'].map((name) =>
        expect(sideLink({ page, name })).toBeVisible(),
      ),
    )
    const movies = page.getByRole('region', { name: 'Fixture Movies' })
    await expect(
      movies.getByRole('link', { name: FIXTURE_TITLES.first, exact: true }),
    ).toBeVisible()
    await expect(
      page.getByRole('region', { name: 'Fixture Shows' }).getByRole('link', {
        name: FIXTURE_TITLES.show,
        exact: true,
      }),
    ).toBeVisible()
  })

  test('plays a movie from its page in mpv, through the relay', async () => {
    const { page } = running()
    const fixture = server()
    await page.getByRole('link', { name: FIXTURE_TITLES.first, exact: true }).click()
    await expect(heading({ page, name: FIXTURE_TITLES.first })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Download', exact: true })).toBeVisible()
    await page.getByRole('link', { name: 'Play', exact: true }).click()

    await expectPlayingNatively({ page, title: FIXTURE_MOVIE_NAMES.first })
    const files = fixture.requests.filter(
      ({ method, path }) =>
        method === SERVER_METHODS.get && path === MEDIA_PATHS.file(FIXTURE_MEDIA.first),
    )
    expect(files.length).toBeGreaterThan(0)
    // mpv opens the relay, which sends the server an account ticket and nothing else.
    expect(files.every(isTicketOnly)).toBe(true)

    await wake(page)
    await page.getByRole('button', { name: 'Back', exact: true }).click()
    await expect(heading({ page, name: FIXTURE_TITLES.first })).toBeVisible()
    await expect(page.locator('html')).not.toHaveAttribute('data-surface', 'native')
  })

  test('keeps the account across a relaunch', async () => {
    const fixture = server()
    await closeApp({ app: running().app })
    launched = null
    await withApp({
      userData,
      env: serverEnv({ origin: fixture.origin }),
      run: async ({ page }) => {
        await expect(heading({ page, name: 'Home' })).toBeVisible()
        expect(page.url()).toBe(`${PAGE_ORIGIN}/`)
      },
    })
  })
})
