import { expect, test } from '@playwright/test'
import { FIXTURE_SERVER } from '@raven/core/fixtureServer'
import {
  HOME_COPY,
  LIBRARY_PAGE_COPY,
  SEARCH_COPY,
  SETTINGS_COPY,
  SIDEBAR_COPY,
  SIDEBAR_KEY,
} from '@raven/wren'
import { sideLink, sidebar } from '@/e2e/shell'
import { WREN_ROUTES } from '@/routes'

const { album } = FIXTURE_SERVER

/** Home's tile says when its album was added after its name, so it is found by how it starts. */
const HOME_TILE = new RegExp(`^${album.title}, ${album.artist}`, 'u')

test.describe('Home', () => {
  test('opens with no sign-in on the greeting over the album just added', async ({ page }) => {
    await page.goto(WREN_ROUTES.home)
    await expect(
      page.getByRole('heading', {
        level: 1,
        name: new RegExp(Object.values(HOME_COPY.greeting).join('|'), 'u'),
      }),
    ).toBeVisible()
    await expect(
      page.getByRole('heading', { level: 2, name: LIBRARY_PAGE_COPY.recent }),
    ).toBeVisible()
    await expect(page.getByRole('radio', { name: HOME_COPY.sorts.added })).toBeChecked()

    await page.getByRole('link', { name: HOME_TILE }).click()
    await expect(page.getByRole('heading', { level: 1, name: album.title })).toBeVisible()
  })

  test('sends sign-in and an address that leads nowhere Home', async ({ page }) => {
    await page.goto(WREN_ROUTES.signIn)
    await expect(page).toHaveURL(WREN_ROUTES.home)
    await expect(page.getByRole('link', { name: HOME_TILE })).toBeVisible()

    await page.goto('/nowhere/at/all')
    await expect(page).toHaveURL(WREN_ROUTES.home)
    await expect(page.getByRole('link', { name: HOME_TILE })).toBeVisible()
  })

  test('reaches Search, Albums and Settings from the sidebar', async ({ page }) => {
    await page.goto(WREN_ROUTES.home)
    await sideLink({ page, name: SEARCH_COPY.title }).click()
    await expect(page.getByRole('heading', { level: 1, name: SEARCH_COPY.title })).toBeVisible()

    await sideLink({ page, name: LIBRARY_PAGE_COPY.albums }).click()
    await expect(
      page.getByRole('heading', { level: 1, name: LIBRARY_PAGE_COPY.albums }),
    ).toBeVisible()

    await sideLink({ page, name: SETTINGS_COPY.title }).click()
    await expect(page.getByRole('heading', { level: 1, name: SETTINGS_COPY.title })).toBeVisible()

    await sideLink({ page, name: HOME_COPY.title }).click()
    await expect(page.getByRole('link', { name: HOME_TILE })).toBeVisible()
  })

  test('folds the sidebar to its icons with B, and keeps it folded across a reload', async ({
    page,
  }) => {
    await page.goto(WREN_ROUTES.home)
    const toggle = sidebar({ page }).getByRole('button', { name: SIDEBAR_COPY.name })
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')

    await page.keyboard.press(SIDEBAR_KEY)
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')

    await page.reload()
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  })
})
