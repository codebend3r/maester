import { expect, test } from '@playwright/test'
import { FIXTURE_SERVER } from '@raven/core'
import { HOME_COPY } from '@/pages/HomePage/copy'
import { sideLink } from '@/e2e/shell'

const { movie, show } = FIXTURE_SERVER

test.describe('Home', () => {
  test('opens on the hero over a shelf for each pinned library', async ({ page }) => {
    await page.goto('/')
    const hero = page.getByRole('region', { name: HOME_COPY.featured })
    await expect(hero.getByText(HOME_COPY.featuredIn(movie.library))).toBeVisible()
    await expect(hero.getByRole('heading', { name: movie.title })).toBeVisible()

    const films = page.getByRole('region', { name: movie.library })
    await expect(films.getByRole('link', { name: movie.title, exact: true })).toBeVisible()
    const series = page.getByRole('region', { name: show.library })
    await expect(series.getByRole('link', { name: show.title, exact: true })).toBeVisible()

    await expect(sideLink({ page, name: movie.library })).toBeVisible()
    await expect(sideLink({ page, name: show.library })).toBeVisible()
  })

  test('steps the hero on to the next featured title and opens its page', async ({ page }) => {
    await page.goto('/')
    const hero = page.getByRole('region', { name: HOME_COPY.featured })
    await hero.getByRole('button', { name: HOME_COPY.next }).click()
    await expect(hero.getByText(HOME_COPY.featuredIn(show.library))).toBeVisible()
    await expect(hero.getByRole('heading', { name: show.title })).toBeVisible()

    await hero.getByRole('link', { name: HOME_COPY.details }).click()
    await expect(page.getByRole('heading', { level: 1, name: show.title })).toBeVisible()
  })
})
