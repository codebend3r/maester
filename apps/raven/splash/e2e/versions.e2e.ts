import { type Page, expect } from '@playwright/test'
import { SPLASH_COPY } from '@/copy'
import { LATEST, LISTED_VERSIONS, PARSED_RELEASES } from '@/e2e/releasesFixture'
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
  versionItems,
} from '@/e2e/site'
import { CATALOGS, type Release } from '@/releases'

const CURRENT_PAGE = 'page'

type ExpectVersionsProps = { page: Page; releases: readonly Release[] }

// Every version is drawn as the release reads: its number, its files in order and its notes.
const expectVersions = async ({ page, releases }: ExpectVersionsProps): Promise<void> => {
  const items = versionItems({ page })
  await expect(items.getByRole('heading', { level: 2 })).toHaveText(
    releases.map((release) => release.version),
  )
  await Promise.all(
    releases.map(async (release, index) => {
      const item = items.nth(index)
      await expectFiles({ links: item.getByRole('list').getByRole('link'), files: release.files })
      await expect(
        item.getByRole('link', { name: SPLASH_COPY.whatsNew, exact: true }),
      ).toHaveAttribute(ATTRIBUTES.href, release.notesUrl)
    }),
  )
}

test.describe('Every version', () => {
  test("lists Raven's versions for Mac and Windows, newest first, with their files", async ({
    page,
  }) => {
    await open({ page, sitePage: SITE_PAGES.releases })
    const items = versionItems({ page })

    await expect(items.getByRole('heading', { level: 2 })).toHaveText(LISTED_VERSIONS.desktop)
    await expectVersions({ page, releases: PARSED_RELEASES.desktop })
    await expect(page.getByText(PAGE_COPY.asking)).toHaveCount(0)

    const newest = items.first()
    await expect(newest.getByText(LATEST.date)).toBeVisible()
    await expect(newest.getByRole('list').getByRole('link')).toHaveCount(
      Object.keys(CATALOGS.desktop.downloads).length,
    )
    await expect(newest.getByRole('link', { name: SPLASH_COPY.whatsNew })).toHaveAttribute(
      ATTRIBUTES.href,
      LATEST.notesUrl,
    )
    await expect(
      page.getByRole('link', { name: CATALOGS.devices.downloads['android-tv.apk'].label }),
    ).toHaveCount(0)
  })

  test('says so when GitHub refuses the list', async ({ page }) => {
    await refuseReleases({ page })
    await open({ page, sitePage: SITE_PAGES.releases })

    await expect(page.getByText(SPLASH_COPY.versionsFailed)).toBeVisible()
    await expect(versionItems({ page })).toHaveCount(0)
  })

  test('marks itself in the masthead and leads to GitHub and the dev builds', async ({ page }) => {
    await open({ page, sitePage: SITE_PAGES.releases })
    await expect(navLink({ page, nav: NAVS.project, name: PAGE_COPY.releases })).toHaveAttribute(
      ATTRIBUTES.current,
      CURRENT_PAGE,
    )
    await expect(
      navLink({ page, nav: NAVS.footer, name: PAGE_COPY.releasesOnGitHub }),
    ).toHaveAttribute(ATTRIBUTES.href, LINKS.releasesOnGitHub)

    await navLink({ page, nav: NAVS.project, name: PAGE_COPY.devBuilds }).click()
    await expectPage({ page, sitePage: SITE_PAGES.devBuilds })
  })
})

test.describe('Dev builds', () => {
  test('lists every release that ships a file, the APKs beside the desktop apps', async ({
    page,
  }) => {
    await open({ page, sitePage: SITE_PAGES.devBuilds })
    const items = versionItems({ page })

    await expect(items.getByRole('heading', { level: 2 })).toHaveText(LISTED_VERSIONS.all)
    await expectVersions({ page, releases: PARSED_RELEASES.all })
    await expect(page.getByText(PAGE_COPY.asking)).toHaveCount(0)

    const newestFiles = items.first().getByRole('list').getByRole('link')
    await expect(newestFiles).toHaveCount(
      [CATALOGS.desktop, CATALOGS.devices, CATALOGS.wren].flatMap((catalog) =>
        Object.keys(catalog.downloads),
      ).length,
    )
    await expect(
      newestFiles.filter({ hasText: CATALOGS.wren.downloads['android.apk'].label }),
    ).toHaveCount(1)
  })

  test('says how to install on each device', async ({ page }) => {
    await open({ page, sitePage: SITE_PAGES.devBuilds })
    const notes = page.getByRole('list', { name: PAGE_COPY.installNotes })

    await expect(notes.getByRole('heading', { level: 2 })).toHaveText(PAGE_COPY.installOn)
    await expect(notes.getByText(PAGE_COPY.tvAddress)).toBeVisible()
  })

  test('says so when GitHub cannot be reached', async ({ page }) => {
    await dropReleases({ page })
    await open({ page, sitePage: SITE_PAGES.devBuilds })

    await expect(page.getByText(SPLASH_COPY.devBuildsFailed)).toBeVisible()
    await expect(versionItems({ page })).toHaveCount(0)
  })

  test('marks itself in the masthead and leads back to every version', async ({ page }) => {
    await open({ page, sitePage: SITE_PAGES.devBuilds })
    await expect(navLink({ page, nav: NAVS.project, name: PAGE_COPY.devBuilds })).toHaveAttribute(
      ATTRIBUTES.current,
      CURRENT_PAGE,
    )

    await navLink({ page, nav: NAVS.project, name: PAGE_COPY.releases }).click()
    await expectPage({ page, sitePage: SITE_PAGES.releases })
  })
})
