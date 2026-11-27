import { expect } from '@playwright/test'
import {
  ATTRIBUTES,
  LINKS,
  NAVS,
  PAGE_COPY,
  SITE_PAGES,
  expectPage,
  navLink,
  open,
  test,
} from '@/e2e/site'

test.describe("Wren's page", () => {
  test('opens on its pitch, says it has no release yet and offers no download', async ({
    page,
  }) => {
    await open({ page, sitePage: SITE_PAGES.wren })

    await expect(page.getByText(PAGE_COPY.wrenUnreleased)).toBeVisible()
    await expect(page.getByRole('link', { name: PAGE_COPY.startWithRaven })).toHaveAttribute(
      ATTRIBUTES.href,
      SITE_PAGES.raven.path,
    )
    await expect(navLink({ page, nav: NAVS.project, name: PAGE_COPY.source })).toHaveAttribute(
      ATTRIBUTES.href,
      LINKS.source,
    )
    await expect(page.locator(`a[href*="${LINKS.releasesOnGitHub}"]`)).toHaveCount(0)
  })

  test('leads to Raven from its hero, its masthead and its footer', async ({ page }) => {
    await open({ page, sitePage: SITE_PAGES.wren })
    await page.getByRole('link', { name: PAGE_COPY.startWithRaven }).click()
    await expectPage({ page, sitePage: SITE_PAGES.raven })

    await open({ page, sitePage: SITE_PAGES.wren })
    await navLink({ page, nav: NAVS.project, name: PAGE_COPY.raven }).click()
    await expectPage({ page, sitePage: SITE_PAGES.raven })

    await open({ page, sitePage: SITE_PAGES.wren })
    await navLink({ page, nav: NAVS.footer, name: PAGE_COPY.raven }).click()
    await expectPage({ page, sitePage: SITE_PAGES.raven })
  })
})
