import { type Page, expect } from '@playwright/test'
import { SPLASH_COPY } from '@/copy'
import { LATEST, MAC_DISK_IMAGE, PARSED_RELEASES, WINDOWS_INSTALLER } from '@/e2e/releasesFixture'
import {
  ATTRIBUTES,
  LINKS,
  NAVS,
  PAGE_COPY,
  SITE_PAGES,
  dropReleases,
  expectFiles,
  expectPage,
  navLink,
  open,
  refuseReleases,
  test,
} from '@/e2e/site'
import { CATALOGS, PLATFORMS, downloadMenu, platformList } from '@/releases'

const [latest] = PARSED_RELEASES.desktop
if (latest === undefined) throw new Error('The fixture holds no desktop release')

const OFFERS = {
  mac: downloadMenu({ release: latest, platform: PLATFORMS.mac }),
  windows: downloadMenu({ release: latest, platform: PLATFORMS.windows }),
} as const

const VERSION_LINE = SPLASH_COPY.versionLine({
  version: LATEST.version,
  platforms: platformList({ release: latest }),
  date: LATEST.date,
}).trim()

const USER_AGENTS = {
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  windows:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
} as const

const KEYS = { escape: 'Escape' } as const

/** The page events a test waits for. */
const PAGE_EVENTS = { requestFailed: 'requestfailed' } as const

type MenuProps = { page: Page }

/** The download menu: the disclosure, the button that opens it and the links to its files. */
const downloadMenuOf = ({ page }: MenuProps) => {
  const menu = page.locator('details')
  return {
    menu,
    button: menu.locator('summary'),
    files: menu.getByRole('list').getByRole('link'),
  }
}

test.describe("Raven's page", () => {
  test.describe('on a Mac', () => {
    test.use({ userAgent: USER_AGENTS.mac })

    test('names the latest version and offers its files, the Mac ones first', async ({ page }) => {
      await open({ page, sitePage: SITE_PAGES.raven })
      const { button, files } = downloadMenuOf({ page })

      await expect(button).toHaveText(OFFERS.mac.title)
      await expect(page.getByText(VERSION_LINE)).toBeVisible()
      await expect(page.getByRole('link', { name: SPLASH_COPY.everyVersion })).toHaveAttribute(
        ATTRIBUTES.href,
        SITE_PAGES.releases.path,
      )

      await expect(files.first()).toBeHidden()
      await button.click()
      await expectFiles({ links: files, files: OFFERS.mac.files })
      await expect(files).toHaveCount(Object.keys(CATALOGS.desktop.downloads).length)
      await expect(files.first()).toBeVisible()
      await expect(files.first()).toContainText(CATALOGS.desktop.downloads['arm64.dmg'].label)
      await expect(files.first()).toContainText(MAC_DISK_IMAGE.size)
      await expect(files.first()).toHaveAttribute(ATTRIBUTES.href, MAC_DISK_IMAGE.url)
    })

    test('closes the open menu on Escape, and on a click outside it', async ({ page }) => {
      await open({ page, sitePage: SITE_PAGES.raven })
      const { button, files } = downloadMenuOf({ page })
      const firstFile = files.first()
      await expect(button).toHaveText(OFFERS.mac.title)

      await button.click()
      await expect(firstFile).toBeVisible()
      await page.keyboard.press(KEYS.escape)
      await expect(firstFile).toBeHidden()

      await button.click()
      await expect(firstFile).toBeVisible()
      await page.getByRole('heading', { level: 1 }).click()
      await expect(firstFile).toBeHidden()
    })
  })

  test.describe('on Windows', () => {
    test.use({ userAgent: USER_AGENTS.windows })

    test('offers the Windows installer first', async ({ page }) => {
      await open({ page, sitePage: SITE_PAGES.raven })
      const { button, files } = downloadMenuOf({ page })

      await expect(button).toHaveText(OFFERS.windows.title)
      await button.click()
      await expectFiles({ links: files, files: OFFERS.windows.files })
      await expect(files.first()).toContainText(CATALOGS.desktop.downloads['x64-setup.exe'].label)
      await expect(files.first()).toContainText(WINDOWS_INSTALLER.size)
      await expect(files.first()).toHaveAttribute(ATTRIBUTES.href, WINDOWS_INSTALLER.url)
    })
  })

  test('keeps the link to the latest release on GitHub when GitHub refuses the list', async ({
    page,
  }) => {
    await refuseReleases({ page })
    const asked = page.waitForResponse((response) => !response.ok())
    await open({ page, sitePage: SITE_PAGES.raven })
    await asked
    const { menu, button } = downloadMenuOf({ page })

    await expect(button).toHaveText(PAGE_COPY.downloadRaven)
    await button.click()
    await expect(menu.getByRole('link', { name: PAGE_COPY.latestOnGitHub })).toHaveAttribute(
      ATTRIBUTES.href,
      LINKS.latestRelease,
    )
    await expect(page.getByText(PAGE_COPY.forComputers)).toBeVisible()
    await expect(page.getByRole('link', { name: SPLASH_COPY.everyVersion })).toHaveAttribute(
      ATTRIBUTES.href,
      SITE_PAGES.releases.path,
    )
  })

  test('keeps the same link when GitHub cannot be reached', async ({ page }) => {
    await dropReleases({ page })
    const asked = page.waitForEvent(PAGE_EVENTS.requestFailed)
    await open({ page, sitePage: SITE_PAGES.raven })
    await asked
    const { menu, button } = downloadMenuOf({ page })

    await expect(button).toHaveText(PAGE_COPY.downloadRaven)
    await button.click()
    await expect(menu.getByRole('link', { name: PAGE_COPY.latestOnGitHub })).toHaveAttribute(
      ATTRIBUTES.href,
      LINKS.latestRelease,
    )
  })

  test('leads to the web app, the source, every version and the dev builds', async ({ page }) => {
    await open({ page, sitePage: SITE_PAGES.raven })
    await expect(page.getByRole('link', { name: PAGE_COPY.openTheWebApp })).toHaveAttribute(
      ATTRIBUTES.href,
      LINKS.webApp,
    )
    await expect(navLink({ page, nav: NAVS.project, name: PAGE_COPY.source })).toHaveAttribute(
      ATTRIBUTES.href,
      LINKS.source,
    )

    await navLink({ page, nav: NAVS.project, name: PAGE_COPY.releases }).click()
    await expectPage({ page, sitePage: SITE_PAGES.releases })

    await open({ page, sitePage: SITE_PAGES.raven })
    await navLink({ page, nav: NAVS.project, name: PAGE_COPY.devBuilds }).click()
    await expectPage({ page, sitePage: SITE_PAGES.devBuilds })

    await open({ page, sitePage: SITE_PAGES.raven })
    await page.getByRole('link', { name: SPLASH_COPY.everyVersion }).click()
    await expectPage({ page, sitePage: SITE_PAGES.releases })
  })
})
