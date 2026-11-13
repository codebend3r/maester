import { expect, test } from '@playwright/test'
import { FIXTURE_SERVER } from '@raven/core/fixtureServer'
import { SITE_SEARCH_COPY } from '@/components/SiteSearch/copy'
import { LIBRARY_COPY } from '@/pages/LibraryPage/copy'
import { HOME_COPY } from '@/pages/HomePage/copy'
import { sideLink } from '@/e2e/shell'

const { movie, show } = FIXTURE_SERVER

/** A word no fixture title holds. */
const NO_TITLE = 'quokka'

test.describe('Search', () => {
  test('searches every library from Home and keeps the search in the address', async ({ page }) => {
    await page.goto('/')
    const query = show.title.split(' ')[0] ?? show.title
    await page.getByRole('combobox', { name: SITE_SEARCH_COPY.searchEveryLibrary }).fill(query)
    await page.keyboard.press('Enter')

    const results = page.getByRole('region', { name: HOME_COPY.searchResultsFor(query) })
    await expect(results.getByRole('link', { name: show.title, exact: true })).toBeVisible()
    await expect(results.getByRole('link', { name: movie.title, exact: true })).toHaveCount(0)
    await expect(page).toHaveURL(new RegExp(`\\?q=${query}$`, 'u'))
  })

  test('says so when nothing matches', async ({ page }) => {
    await page.goto(`/?q=${NO_TITLE}`)
    await expect(page.getByText(HOME_COPY.noMatches(NO_TITLE))).toBeVisible()
  })

  test('searches one library from its own box', async ({ page }) => {
    await page.goto('/')
    await sideLink({ page, name: movie.library }).click()
    const box = page.getByRole('searchbox', { name: LIBRARY_COPY.searchLibrary(movie.library) })
    await box.fill(movie.title)
    await expect(page.getByRole('link', { name: movie.title, exact: true })).toBeVisible()
    await box.fill(NO_TITLE)
    await expect(page.getByRole('link', { name: movie.title, exact: true })).toHaveCount(0)
  })
})
