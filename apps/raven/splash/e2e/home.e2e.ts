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

test.describe("Maester's home", () => {
  test('opens on its pitch, with the way to each app and to the source', async ({ page }) => {
    await open({ page, sitePage: SITE_PAGES.home })

    await expect(page.getByRole('link', { name: PAGE_COPY.exploreRaven })).toHaveAttribute(
      ATTRIBUTES.href,
      SITE_PAGES.raven.path,
    )
    await expect(page.getByRole('link', { name: PAGE_COPY.exploreWren })).toHaveAttribute(
      ATTRIBUTES.href,
      SITE_PAGES.wren.path,
    )
    await expect(page.getByRole('link', { name: PAGE_COPY.readTheSource })).toHaveAttribute(
      ATTRIBUTES.href,
      LINKS.source,
    )
    await expect(
      page.getByRole('heading', { level: 3, name: PAGE_COPY.raven, exact: true }),
    ).toBeVisible()
    await expect(
      page.getByRole('heading', { level: 3, name: PAGE_COPY.wren, exact: true }),
    ).toBeVisible()
  })

  test('offers Raven at its foot: the latest release, the web app and every version', async ({
    page,
  }) => {
    await open({ page, sitePage: SITE_PAGES.home })
    const start = page
      .getByRole('region')
      .filter({ has: page.getByRole('heading', { level: 2, name: PAGE_COPY.startWithRaven }) })

    await expect(start.getByRole('link', { name: PAGE_COPY.downloadRaven })).toHaveAttribute(
      ATTRIBUTES.href,
      LINKS.latestRelease,
    )
    await expect(start.getByRole('link', { name: PAGE_COPY.openTheWebApp })).toHaveAttribute(
      ATTRIBUTES.href,
      LINKS.webApp,
    )
    await expect(start.getByText(PAGE_COPY.forComputers)).toBeVisible()
    await expect(start.getByRole('link', { name: PAGE_COPY.everyVersion })).toHaveAttribute(
      ATTRIBUTES.href,
      SITE_PAGES.releases.path,
    )
  })

  test('leads to every page from its masthead and its footer', async ({ page }) => {
    await open({ page, sitePage: SITE_PAGES.home })
    await expect(navLink({ page, nav: NAVS.site, name: PAGE_COPY.source })).toHaveAttribute(
      ATTRIBUTES.href,
      LINKS.source,
    )

    await navLink({ page, nav: NAVS.site, name: PAGE_COPY.raven }).click()
    await expectPage({ page, sitePage: SITE_PAGES.raven })

    await open({ page, sitePage: SITE_PAGES.home })
    await navLink({ page, nav: NAVS.site, name: PAGE_COPY.wren }).click()
    await expectPage({ page, sitePage: SITE_PAGES.wren })

    await open({ page, sitePage: SITE_PAGES.home })
    await navLink({ page, nav: NAVS.site, name: PAGE_COPY.releases }).click()
    await expectPage({ page, sitePage: SITE_PAGES.releases })

    await open({ page, sitePage: SITE_PAGES.home })
    await navLink({ page, nav: NAVS.footer, name: PAGE_COPY.devBuilds }).click()
    await expectPage({ page, sitePage: SITE_PAGES.devBuilds })
  })

  test('opens Raven from its hero, and Wren from its card', async ({ page }) => {
    await open({ page, sitePage: SITE_PAGES.home })
    await page.getByRole('link', { name: PAGE_COPY.exploreRaven }).click()
    await expectPage({ page, sitePage: SITE_PAGES.raven })

    await open({ page, sitePage: SITE_PAGES.home })
    await page.getByRole('link', { name: PAGE_COPY.exploreWren }).click()
    await expectPage({ page, sitePage: SITE_PAGES.wren })
  })
})
