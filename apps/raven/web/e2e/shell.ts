import { expect, type Locator, type Page } from '@playwright/test'
import { APP_SHELL_COPY } from '@/components/AppShell/copy'
import { COMMON_COPY } from '@/lib/copy'

type SideLinkProps = { page: Page; name: string }

/** A link in the side menu, which every page but the player draws. */
export const sideLink = ({ page, name }: SideLinkProps): Locator =>
  page
    .getByRole('navigation', { name: APP_SHELL_COPY.main })
    .getByRole('link', { name, exact: true })

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
