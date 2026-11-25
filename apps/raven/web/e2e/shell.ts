import { expect, type Locator, type Page } from '@playwright/test'
import { APP_SHELL_COPY } from '@/components/AppShell/copy'
import { COMMON_COPY } from '@/lib/copy'

type SideLinkProps = { page: Page; name: string }

const sideMenu = ({ page }: PageProps): Locator =>
  page.getByRole('navigation', { name: APP_SHELL_COPY.main })

/** A link in the side menu, which every page but the player draws. */
const sideLink = ({ page, name }: SideLinkProps): Locator =>
  sideMenu({ page }).getByRole('link', { name, exact: true })

/** Opens one of the browsing places in the row along the top of the page. */
export const openFromBrowse = async ({ page, name }: SideLinkProps) => {
  await page
    .getByRole('navigation', { name: APP_SHELL_COPY.browse })
    .getByRole('link', { name, exact: true })
    .click()
}

/**
 * Opens a place under the side menu's Manage button, which starts folded, unfolding it first. On
 * a first visit the tip about the B key rises over the folded button, so it is put away as a
 * viewer would.
 */
export const openFromManage = async ({ page, name }: SideLinkProps) => {
  const menu = sideMenu({ page })
  const manage = menu.getByRole('button', { name: APP_SHELL_COPY.manage, exact: true })
  if ((await manage.getAttribute('aria-expanded')) !== 'true') {
    const gotIt = menu.getByRole('button', { name: APP_SHELL_COPY.gotIt, exact: true })
    if (await gotIt.isVisible()) await gotIt.click()
    await manage.click()
  }
  await sideLink({ page, name }).click()
}

/** Opens a library from its shelf's heading on Home, which shelves every library while none is pinned. */
export const openLibraryFromHome = async ({ page, name }: SideLinkProps) => {
  await page.goto('/')
  await page.getByRole('region', { name }).getByRole('link', { name, exact: true }).click()
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible()
}

type OpenFromShelfProps = { page: Page; library: string; title: string }

/** Opens a title's page from its library's shelf on Home. */
export const openFromShelf = async ({ page, library, title }: OpenFromShelfProps) => {
  await page.goto('/')
  await page
    .getByRole('region', { name: library })
    .getByRole('link', { name: title, exact: true })
    .click()
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible()
}

type PageProps = { page: Page }

/**
 * Marks the open title watched and then not, which also clears any spot saved for it, so the
 * fixture is left as it was found.
 */
export const markWatchedAndBack = async ({ page }: PageProps) => {
  const watched = page.getByRole('button', { name: COMMON_COPY.watched, exact: true })
  await watched.click()
  await expect(watched).toHaveAttribute('aria-pressed', 'true')
  await watched.click()
  await expect(watched).toHaveAttribute('aria-pressed', 'false')
}
