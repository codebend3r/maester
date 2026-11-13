import { expect, type Locator, type Page, test } from '@playwright/test'
import { ITEM_TYPES, REQUEST_STATUSES, UPCOMING_SHELVES } from '@raven/core'
import { FIXTURE_SERVER } from '@raven/core/fixtureServer'
import { COMMON_COPY } from '@/lib/copy'
import { comingSoonTitlePath } from '@/lib/appPaths'
import { COMING_SOON_COPY } from '@/pages/ComingSoonPage/copy'
import { REQUEST_COPY, REQUEST_STATUS_COPY } from '@/pages/ComingSoonPage/requestCopy'
import { SETTINGS_COPY } from '@/pages/SettingsPage/copy'
import { sideLink } from '@/e2e/shell'

const { held, open } = FIXTURE_SERVER.upcoming
const MOVIES = COMING_SOON_COPY.shelves[UPCOMING_SHELVES.movies].title
const OPEN_PAGE = comingSoonTitlePath({ type: ITEM_TYPES.movie, tmdbId: open.tmdbId })

type CardProps = { page: Page; title: string }

/** A title's card on Coming soon's movie shelf. */
const cardOf = ({ page, title }: CardProps): Locator =>
  page.getByRole('region', { name: MOVIES }).getByRole('listitem').filter({ hasText: title })

/** The green check a requested or held title wears on its poster, which says its word to a screen reader. */
const checkOn = (card: Locator): Locator =>
  card.getByText(REQUEST_COPY.requestedMark, { exact: true })

/*
 * One fixture serves the whole suite and a request can not be taken back, so these run in order:
 * `open` is requested once, here, and no other file reads Coming soon.
 */
test.describe.configure({ mode: 'serial' })

test.describe('Coming soon', () => {
  test('marks a title its downloader holds with a green check, and never offers to request it', async ({
    page,
  }) => {
    await page.goto('/')
    await sideLink({ page, name: COMING_SOON_COPY.title }).click()
    await expect(
      page.getByRole('heading', { level: 1, name: COMING_SOON_COPY.title }),
    ).toBeVisible()

    const heldCard = cardOf({ page, title: held.title })
    await expect(checkOn(heldCard)).toBeAttached()

    await heldCard.getByRole('link').click()
    await expect(page.getByRole('heading', { level: 1, name: held.title })).toBeVisible()
    await expect(page.getByRole('button', { name: REQUEST_COPY.requested })).toBeDisabled()
    await expect(page.getByRole('button', { name: REQUEST_COPY.request })).toHaveCount(0)
    await expect(page.getByText(REQUEST_COPY.requestedAlready)).toBeVisible()
  })

  test('requests a title for everyone, then greys its button out and lists it in Settings', async ({
    page,
  }) => {
    await page.goto(OPEN_PAGE)
    await expect(page.getByRole('heading', { level: 1, name: open.title })).toBeVisible()
    const request = page.getByRole('button', { name: REQUEST_COPY.request })
    const requested = page.getByRole('button', { name: REQUEST_COPY.requested })
    // A retry finds the request the first attempt made.
    await expect(request.or(requested)).toBeVisible()
    if (await request.isVisible()) await request.click()
    await expect(requested).toBeDisabled()
    await expect(page.getByText(REQUEST_COPY.requestedByYou)).toBeVisible()

    await page.goto('/')
    await sideLink({ page, name: COMING_SOON_COPY.title }).click()
    await expect(checkOn(cardOf({ page, title: open.title }))).toBeAttached()

    await sideLink({ page, name: COMMON_COPY.settings }).click()
    await page
      .getByRole('tab', { name: new RegExp(`^${SETTINGS_COPY.tabs.requests}`, 'u') })
      .click()
    const row = page
      .getByRole('table', { name: SETTINGS_COPY.requests.table })
      .getByRole('row')
      .filter({ hasText: open.title })
    await expect(row.getByRole('link', { name: open.title })).toHaveAttribute('href', OPEN_PAGE)
    await expect(row.getByText(COMING_SOON_COPY.kinds[ITEM_TYPES.movie])).toBeVisible()
    // Searching until the server next reads Radarr, then waiting in its queue.
    const standings = [REQUEST_STATUSES.searching, REQUEST_STATUSES.willDownload].map(
      (status) => REQUEST_STATUS_COPY[status].label,
    )
    await expect(row.getByText(new RegExp(`^(${standings.join('|')})$`, 'u'))).toBeVisible()
  })
})
