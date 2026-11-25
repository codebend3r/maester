import { expect, test } from '@playwright/test'
import { FIXTURE_SERVER } from '@raven/core/fixtureServer'
import {
  HOME_COPY,
  LIBRARY_PAGE_COPY,
  NOW_PLAYING_COPY,
  PLAYER_COPY,
  SEARCH_COPY,
  SETTINGS_COPY,
  TAB_COPY,
} from '@raven/wren'
import { nowPlayingButton, playAlbum, playerBar } from '@/e2e/shell'
import { WREN_ROUTES } from '@/routes'

const { album } = FIXTURE_SERVER
const [firstTrack, secondTrack] = album.tracks

/** The tab bar's tabs, in its order. */
const TAB_LABELS = [
  HOME_COPY.title,
  LIBRARY_PAGE_COPY.title,
  SEARCH_COPY.title,
  SETTINGS_COPY.title,
] as const

/** A tab as the bar reads it out: "Library, tab, 2 of 4". */
const tabName = (label: (typeof TAB_LABELS)[number]): string =>
  TAB_COPY.label({ label, at: TAB_LABELS.indexOf(label), count: TAB_LABELS.length })

test.describe('On a phone', () => {
  // Narrower than 48rem, where the shell is the apps' phone layout.
  test.use({ viewport: { width: 390, height: 844 } })

  test('the tab bar opens each of the four tabs', async ({ page }) => {
    await page.goto(WREN_ROUTES.home)
    const tabs = playerBar({ page }).getByRole('navigation')

    await tabs.getByRole('link', { name: tabName(LIBRARY_PAGE_COPY.title) }).click()
    await expect(
      page.getByRole('heading', { level: 1, name: LIBRARY_PAGE_COPY.title }),
    ).toBeVisible()

    await tabs.getByRole('link', { name: tabName(SEARCH_COPY.title) }).click()
    await expect(page.getByRole('heading', { level: 1, name: SEARCH_COPY.title })).toBeVisible()

    await tabs.getByRole('link', { name: tabName(SETTINGS_COPY.title) }).click()
    await expect(page.getByRole('heading', { level: 1, name: SETTINGS_COPY.title })).toBeVisible()

    await tabs.getByRole('link', { name: tabName(HOME_COPY.title) }).click()
    await expect(
      page.getByRole('heading', { level: 2, name: LIBRARY_PAGE_COPY.recent }),
    ).toBeVisible()
  })

  test('the mini player steps on with Next and opens Now Playing, which Close puts away', async ({
    page,
  }) => {
    await playAlbum({ page })
    const bar = playerBar({ page })
    await bar.getByRole('button', { name: PLAYER_COPY.next, exact: true }).click()
    await expect(nowPlayingButton({ page, title: secondTrack })).toBeVisible()

    await nowPlayingButton({ page, title: secondTrack }).click()
    await expect(page).toHaveURL(WREN_ROUTES.nowPlaying)
    await expect(page.getByRole('heading', { level: 1, name: secondTrack })).toBeVisible()

    await page.getByRole('button', { name: PLAYER_COPY.previous, exact: true }).click()
    await expect(page.getByRole('heading', { level: 1, name: firstTrack })).toBeVisible()

    await page.getByRole('button', { name: NOW_PLAYING_COPY.close }).click()
    await expect(page.getByRole('heading', { level: 1, name: album.title })).toBeVisible()
    await expect(nowPlayingButton({ page, title: firstTrack })).toBeVisible()
  })
})
