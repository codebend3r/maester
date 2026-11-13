import { expect, test } from '@playwright/test'
import { FIXTURE_SERVER } from '@raven/core/fixtureServer'
import { DOWNLOAD_DIALOG_COPY } from '@/desktop/DownloadDialog/copy'
import { DOWNLOAD_ROW_COPY, DOWNLOADS_PAGE_COPY } from '@/desktop/DownloadsPage/copy'
import { markWatchedAndBack, openFromShelf, sideLink } from '@/e2e/shell'
import { COMMON_COPY } from '@/lib/copy'
import { CACHE_NAMES } from '@/serviceWorker/fetchStrategy'

const { movie } = FIXTURE_SERVER

/** The player's own key for play and pause, which works wherever the focus is. */
const PLAY_PAUSE_KEY = 'k'

/** Long enough that the picture is really decoding from the file on disk. */
const PLAYED_SECONDS = 2

test.describe('Downloads in the browser', () => {
  test('keeps a film in the browser, across a reload, and plays it from there', async ({
    page,
  }) => {
    test.setTimeout(150_000)
    await openFromShelf({ page, library: movie.library, title: movie.title })
    await page.getByRole('button', { name: COMMON_COPY.download, exact: true }).click()
    const dialog = page.getByRole('dialog', { name: DOWNLOAD_DIALOG_COPY.title.browser })
    await dialog.getByRole('button', { name: COMMON_COPY.download, exact: true }).click()

    // The film is an MKV, so the server makes its MP4 copy first, then the browser fetches it.
    await sideLink({ page, name: COMMON_COPY.downloads }).click()
    const play = page.getByRole('button', {
      name: new RegExp(`^${COMMON_COPY.play} ${movie.title}`, 'u'),
    })
    await expect(play).toBeVisible({ timeout: 90_000 })

    // The file and the list outlive the page: both are read back from the browser's own disk.
    await page.reload()
    await expect(play).toBeVisible()
    await play.click()
    const video = page.locator('video')
    await expect(video).toHaveAttribute('src', /^blob:/u)
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
    await page
      .getByRole('button', {
        name: new RegExp(`^${DOWNLOAD_ROW_COPY.deleteLabel(movie.title)}`, 'u'),
      })
      .click()
    await page.getByRole('button', { name: COMMON_COPY.delete, exact: true }).click()
    await expect(page.getByText(DOWNLOADS_PAGE_COPY.empty.browser)).toBeVisible()

    // The play and its spot reached the server, as a watch page's do: leave it as it was found.
    await openFromShelf({ page, library: movie.library, title: movie.title })
    await markWatchedAndBack({ page })
  })
})

test.describe('Downloads in the installed app', () => {
  // The other suites block the worker so each reaches the fixture; here it is what is under test.
  test.use({ serviceWorkers: 'allow' })

  test('opens to Downloads with no network, and plays a film from the disk', async ({
    page,
    context,
  }) => {
    test.setTimeout(150_000)
    await openFromShelf({ page, library: movie.library, title: movie.title })
    await page.getByRole('button', { name: COMMON_COPY.download, exact: true }).click()
    const dialog = page.getByRole('dialog', { name: DOWNLOAD_DIALOG_COPY.title.browser })
    await dialog.getByRole('button', { name: COMMON_COPY.download, exact: true }).click()
    await sideLink({ page, name: COMMON_COPY.downloads }).click()
    const play = page.getByRole('button', {
      name: new RegExp(`^${COMMON_COPY.play} ${movie.title}`, 'u'),
    })
    await expect(play).toBeVisible({ timeout: 90_000 })

    // The worker keeps the build's files as it sees them fetched: wait until it has stopped adding.
    let seenFiles = 0
    await expect
      .poll(
        async () => {
          const files = await page.evaluate(
            async (name) => (await (await caches.open(name)).keys()).length,
            CACHE_NAMES.assets,
          )
          const isSettled = files > 0 && files === seenFiles
          seenFiles = files
          return isSettled
        },
        { intervals: [1000], timeout: 30_000 },
      )
      .toBe(true)

    await context.setOffline(true)
    // Any page but one that needs no server: the kept shell opens, and gives way to Downloads.
    await page.goto('/')
    await expect(page.getByRole('heading', { level: 1, name: COMMON_COPY.downloads })).toBeVisible()
    await play.click()
    const video = page.locator('video')
    await expect(video).toHaveAttribute('src', /^blob:/u)
    await expect
      .poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime), {
        timeout: 30_000,
      })
      .toBeGreaterThan(PLAYED_SECONDS)
    await context.setOffline(false)
  })
})
