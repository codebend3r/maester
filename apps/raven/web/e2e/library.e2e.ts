import { expect, test } from '@playwright/test'
import { SORT_FIELD_LABELS } from '@raven/core'
import { FIXTURE_SERVER } from '@raven/core/fixtureServer'
import { COMMON_COPY } from '@/lib/copy'
import { sideLink } from '@/e2e/shell'

const { movie, show } = FIXTURE_SERVER

test.describe('A library', () => {
  test("opens from its shelf on Home and sorts by the library's own fields", async ({ page }) => {
    await page.goto('/')
    await page
      .getByRole('region', { name: movie.library })
      .getByRole('link', { name: movie.library, exact: true })
      .click()
    await expect(page.getByRole('heading', { level: 1, name: movie.library })).toBeVisible()
    await expect(page.getByRole('link', { name: movie.title, exact: true })).toBeVisible()

    const sort = page.getByRole('combobox', { name: COMMON_COPY.sort })
    await sort.selectOption({ label: SORT_FIELD_LABELS.added })
    await expect(sort.locator('option:checked')).toHaveText(SORT_FIELD_LABELS.added)
    await expect(page.getByRole('link', { name: movie.title, exact: true })).toBeVisible()
    // Sorting a movie library by size is the movie library's alone.
    await expect(sort.getByRole('option', { name: SORT_FIELD_LABELS.size })).toHaveCount(1)
  })

  test('offers a series no sort by file size', async ({ page }) => {
    await page.goto('/')
    await sideLink({ page, name: show.library }).click()
    await expect(page.getByRole('heading', { level: 1, name: show.library })).toBeVisible()
    const sort = page.getByRole('combobox', { name: COMMON_COPY.sort })
    await expect(sort.getByRole('option', { name: SORT_FIELD_LABELS.added })).toHaveCount(1)
    await expect(sort.getByRole('option', { name: SORT_FIELD_LABELS.size })).toHaveCount(0)
  })
})
