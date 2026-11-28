import { expect, test } from '@playwright/test'
import { FIXTURE_SERVER } from '@raven/core/fixtureServer'
import {
  HOME_COPY,
  NOW_PLAYING_COPY,
  PLAYER_COPY,
  SETTINGS_COPY,
  WREN_HOST_META,
  WREN_PAGE_ORIGIN,
} from '@raven/wren'
import { HTTP_STATUSES } from '@shared/http'
import { audioTime } from '@tooling/web/playwright'
import { FIXTURE_ADDRESS, FIXTURE_ORIGIN } from '@/e2e/fixture'
import { appForSuite, heading, homeTile, sideLink } from '@/e2e/harness'

const { album } = FIXTURE_SERVER
const [firstTrack] = album.tracks

// Wren's web app in the app's one window: its page from the web host, its `/api` from the fixture.
test.describe.serial('Wren for Mac', () => {
  const running = appForSuite()

  test('opens one window on Home, served from the loopback web host', async () => {
    const { app, page, userData } = running()
    await expect(
      heading({ page, name: new RegExp(Object.values(HOME_COPY.greeting).join('|'), 'u') }),
    ).toBeVisible()
    expect(page.url()).toBe(`${WREN_PAGE_ORIGIN}/`)
    expect(app.windows()).toHaveLength(1)

    const facts = await app.evaluate(({ app: electronApp, BrowserWindow }) => {
      const windows = BrowserWindow.getAllWindows()
      return {
        count: windows.length,
        isVisible: windows.every((window) => window.isVisible()),
        isPackaged: electronApp.isPackaged,
        userData: electronApp.getPath('userData'),
      }
    })
    expect(facts).toEqual({ count: 1, isVisible: true, isPackaged: false, userData })
  })

  test("reaches the fixture through the web host's /api", async () => {
    const { page } = running()
    const status = await page.evaluate(
      async (path) => (await fetch(path)).status,
      FIXTURE_SERVER.readyPath,
    )
    expect(status).toBe(HTTP_STATUSES.ok)
    // The album is the fixture's, so Home drew it from an answer that crossed the host.
    await expect(homeTile({ page })).toBeVisible()
  })

  test('tells the page which raven it plays from, which Settings shows', async () => {
    const { page } = running()
    const named = await page.evaluate(
      (name) => document.querySelector(`meta[name="${name}"]`)?.getAttribute('content') ?? null,
      WREN_HOST_META.serverAddress,
    )
    expect(named).toBe(FIXTURE_ORIGIN)

    await sideLink({ page, name: SETTINGS_COPY.title }).click()
    await expect(heading({ page, name: SETTINGS_COPY.title })).toBeVisible()
    await expect(page.getByRole('main').getByText(FIXTURE_ADDRESS)).toBeVisible()
    await sideLink({ page, name: HOME_COPY.title }).click()
  })

  test('opens the album and plays its first track, on this Mac', async () => {
    const { page } = running()
    await homeTile({ page }).click()
    await expect(heading({ page, name: album.title })).toBeVisible()
    await page
      .getByRole('main')
      .getByRole('button', { name: PLAYER_COPY.play, exact: true })
      .click()

    const bar = page.getByRole('contentinfo')
    const nowPlaying = bar.getByRole('button', {
      name: PLAYER_COPY.open({ title: firstTrack, artists: album.artist }),
    })
    await expect(nowPlaying).toBeVisible()
    await expect(bar.getByRole('button', { name: PLAYER_COPY.pause, exact: true })).toBeVisible()
    // The track's bytes come through the host's `/api` too, and the page's own `<audio>` plays them.
    await expect.poll(() => audioTime({ page })).toBeGreaterThan(1)

    await nowPlaying.click()
    await expect(heading({ page, name: firstTrack })).toBeVisible()
    await expect(
      page.getByText(NOW_PLAYING_COPY.playingOn(NOW_PLAYING_COPY.devices.mac)),
    ).toBeVisible()
  })
})
