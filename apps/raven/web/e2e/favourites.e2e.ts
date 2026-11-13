import { expect, test } from '@playwright/test'
import { FIXTURE_SERVER } from '@raven/core/fixtureServer'
import { COMMON_COPY } from '@/lib/copy'
import { FAVOURITES_COPY } from '@/pages/FavouritesPage/copy'
import { openFromShelf, sideLink } from '@/e2e/shell'

const { movie } = FIXTURE_SERVER

test.describe('Favourites', () => {
  test('lists a film once its heart is pressed, and lets it go again', async ({ page }) => {
    await openFromShelf({ page, library: movie.library, title: movie.title })
    const heart = page.getByRole('button', { name: COMMON_COPY.favourite, exact: true })
    await expect(heart).toHaveAttribute('aria-pressed', 'false')
    await heart.click()
    await expect(heart).toHaveAttribute('aria-pressed', 'true')

    await sideLink({ page, name: COMMON_COPY.favourites }).click()
    await expect(
      page.getByRole('heading', { level: 1, name: COMMON_COPY.favourites }),
    ).toBeVisible()
    await expect(page.getByRole('link', { name: movie.title, exact: true })).toBeVisible()

    // Left as it was found: the next run starts with no favourites.
    await openFromShelf({ page, library: movie.library, title: movie.title })
    await heart.click()
    await expect(heart).toHaveAttribute('aria-pressed', 'false')
    await sideLink({ page, name: COMMON_COPY.favourites }).click()
    await expect(page.getByText(FAVOURITES_COPY.empty)).toBeVisible()
    await expect(page.getByRole('link', { name: movie.title, exact: true })).toHaveCount(0)
  })
})
