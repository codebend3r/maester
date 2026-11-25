import { expect, test } from '@playwright/test'
import { FIXTURE_SERVER } from '@raven/core/fixtureServer'
import { SEARCH_COPY } from '@raven/wren'
import { ALBUM_TILE, nowPlayingButton } from '@/e2e/shell'
import { WREN_ROUTES } from '@/routes'

const { album } = FIXTURE_SERVER
const [, secondTrack] = album.tracks

/** A word only the second track's title holds, and one only the album's does. */
const [SONG_WORD] = secondTrack.split(' ')
const [ALBUM_WORD] = album.title.split(' ')
const NO_MATCH = 'zzzz'

test.describe('Search', () => {
  test('finds a song by a word of its title and plays it', async ({ page }) => {
    await page.goto(WREN_ROUTES.search)
    await expect(page.getByRole('heading', { level: 2, name: SEARCH_COPY.browse })).toBeVisible()

    await page.getByRole('searchbox', { name: SEARCH_COPY.label }).fill(SONG_WORD)
    await expect(page.getByRole('radio', { name: SEARCH_COPY.all })).toBeChecked()
    const song = page.getByRole('main').getByRole('button', { name: secondTrack, exact: true })
    await expect(song).toBeVisible()

    await song.click()
    await expect(nowPlayingButton({ page, title: secondTrack })).toBeVisible()
  })

  test('finds the album and opens its page', async ({ page }) => {
    await page.goto(WREN_ROUTES.search)
    await page.getByRole('searchbox', { name: SEARCH_COPY.label }).fill(ALBUM_WORD)
    await page.getByRole('radio', { name: SEARCH_COPY.albums }).check()

    await page.getByRole('link', { name: ALBUM_TILE }).first().click()
    await expect(page.getByRole('heading', { level: 1, name: album.title })).toBeVisible()
  })

  test('says so when nothing matches, and Clear search goes back to Browse', async ({ page }) => {
    await page.goto(WREN_ROUTES.search)
    await page.getByRole('searchbox', { name: SEARCH_COPY.label }).fill(NO_MATCH)
    await expect(page.getByRole('heading', { name: SEARCH_COPY.noMatches(NO_MATCH) })).toBeVisible()

    await page
      .getByRole('main')
      .getByRole('button', { name: SEARCH_COPY.clearSearch })
      .last()
      .click()
    await expect(page.getByRole('searchbox', { name: SEARCH_COPY.label })).toHaveValue('')
    await expect(page.getByRole('heading', { level: 2, name: SEARCH_COPY.browse })).toBeVisible()
  })
})
