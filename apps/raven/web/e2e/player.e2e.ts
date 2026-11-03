import { expect, test } from '@playwright/test'
import { FIXTURE_SERVER } from '@raven/core'
import { PLAYABLE_ITEM_VIEW_COPY } from '@/components/PlayableItemView/copy'
import { COMMON_COPY } from '@/lib/copy'
import { HOME_COPY } from '@/pages/HomePage/copy'
import { markWatchedAndBack, openFromShelf } from '@/e2e/shell'

const { movie } = FIXTURE_SERVER

/** The player's own key for play and pause, which works wherever the focus is. */
const PLAY_PAUSE_KEY = 'k'

/** Long enough into the film that the server has saved a spot to resume from. */
const PLAYED_SECONDS = 12

test.describe('The player', () => {
  test('plays a film from its page, and the page and Home offer to resume it', async ({ page }) => {
    test.setTimeout(90_000)
    await openFromShelf({ page, library: movie.library, title: movie.title })
    await page.getByRole('link', { name: COMMON_COPY.play, exact: true }).click()

    // The film is an MKV, which Chrome plays through the server's remux; it starts by itself.
    const video = page.locator('video')
    await expect
      .poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime), {
        timeout: 30_000,
      })
      .toBeGreaterThan(PLAYED_SECONDS)
    await page.keyboard.press(PLAY_PAUSE_KEY)
    await expect
      .poll(() => video.evaluate((element: HTMLVideoElement) => element.paused))
      .toBe(true)

    await page.goBack()
    await expect(page.getByRole('heading', { level: 1, name: movie.title })).toBeVisible()
    const resume = page.getByRole('link', {
      name: new RegExp(`^${PLAYABLE_ITEM_VIEW_COPY.resumeFrom('')}`, 'u'),
    })
    await expect(resume).toBeVisible()

    await page.goto('/')
    const continueWatching = page.getByRole('region', { name: HOME_COPY.continueWatching })
    await expect(continueWatching.getByRole('link', { name: movie.title }).first()).toBeVisible()

    await page.goBack()
    await markWatchedAndBack({ page })
    await expect(page.getByRole('link', { name: COMMON_COPY.play, exact: true })).toBeVisible()
  })
})
