import { expect, test } from '@playwright/test'
import { NOT_FOUND_COPY } from '@/pages/NotFoundPage/copy'
import { HOME_COPY } from '@/pages/HomePage/copy'

/** An address no route of the app answers. */
const NOWHERE = '/nowhere/at/all'

test.describe('An address that leads nowhere', () => {
  test('says so, and offers the way home', async ({ page }) => {
    await page.goto(NOWHERE)
    await expect(page.getByRole('heading', { name: NOT_FOUND_COPY.title })).toBeVisible()
    await page.getByRole('link', { name: NOT_FOUND_COPY.goHome }).click()
    await expect(page).toHaveURL(/\/$/u)
    await expect(page.getByRole('region', { name: HOME_COPY.featured })).toBeVisible()
  })
})
