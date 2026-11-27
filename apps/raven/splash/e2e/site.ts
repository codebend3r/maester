import { type Locator, type Page, test as base, expect } from '@playwright/test'
import { HTTP_STATUSES } from '@shared/http'
import { SPLASH_COPY } from '@/copy'
import { GITHUB_RELEASES, REPO, REPO_URL } from '@/e2e/releasesFixture'
import { type ReleaseFile, formatBytes } from '@/releases'

/** Every page of the site: its address, its tab's title and its heading. */
export const SITE_PAGES = {
  home: {
    path: '/',
    title: 'Maester: your films, shows and music, from your own disk',
    heading: 'Your films, shows and music, from your own disk.',
  },
  raven: {
    path: '/raven/',
    title: 'Raven: your videos, from your own disk',
    heading: 'Your videos, played from your own disk.',
  },
  wren: {
    path: '/wren/',
    title: 'Wren: your music, from your own disk',
    heading: 'Your music, played from your own disk.',
  },
  releases: {
    path: '/releases/',
    title: 'Raven: every version',
    heading: 'Every version',
  },
  devBuilds: {
    path: '/dev-builds/',
    title: 'Raven: dev builds',
    heading: 'Dev builds',
  },
} as const

type SitePage = (typeof SITE_PAGES)[keyof typeof SITE_PAGES]

/** Where the pages' links off the site lead. */
export const LINKS = {
  source: REPO_URL,
  latestRelease: `${REPO_URL}/releases/latest`,
  releasesOnGitHub: `${REPO_URL}/releases`,
  webApp: 'https://raven.maester.tv',
} as const

/** What each page's navigation is called aloud. */
export const NAVS = { site: 'Site', project: 'Project', footer: 'Footer' } as const

/** The words the pages' own markup holds, which no script writes. */
export const PAGE_COPY = {
  raven: 'Raven',
  wren: 'Wren',
  releases: 'Releases',
  devBuilds: 'Dev builds',
  source: 'Source',
  releasesOnGitHub: 'Releases on GitHub',
  exploreRaven: 'Explore Raven',
  exploreWren: 'Explore Wren',
  readTheSource: 'Read the source',
  startWithRaven: 'Start with Raven',
  downloadRaven: 'Download Raven',
  openTheWebApp: 'Open the web app',
  latestOnGitHub: 'Latest release on GitHub',
  everyVersion: 'Every version',
  forComputers: 'For Macs with Apple silicon and Windows PCs.',
  wrenUnreleased: 'Wren is still being built and has no release yet',
  asking: 'Asking GitHub for the list.',
  installNotes: 'How to install',
  installOn: ['Android TV', 'Android phones', 'Apple TV, iPhone and iPad'],
  tvAddress: 'maester.tv/tv',
} as const

export const ATTRIBUTES = { href: 'href', current: 'aria-current' } as const

const GITHUB_API = { host: 'api.github.com', path: `/repos/${REPO}/releases` } as const

// The pages ask GitHub from another origin, so the browser reads only an answer that allows it.
const CORS_HEADERS = { 'access-control-allow-origin': '*' } as const

const isReleasesRequest = (url: URL): boolean =>
  url.host === GITHUB_API.host && url.pathname === GITHUB_API.path

type PageProps = { page: Page }

/** GitHub refuses the list, as it does past a visitor's 60 asks an hour. */
export const refuseReleases = async ({ page }: PageProps): Promise<void> => {
  await page.route(isReleasesRequest, (route) =>
    route.fulfill({ status: HTTP_STATUSES.forbidden, headers: CORS_HEADERS, json: {} }),
  )
}

/** GitHub cannot be reached at all. */
export const dropReleases = async ({ page }: PageProps): Promise<void> => {
  await page.route(isReleasesRequest, (route) => route.abort())
}

/**
 * Every test's page: GitHub's releases API answers the fixture, and no other request leaves the
 * site, so the suite never needs the internet. A test that wants another answer routes its own,
 * which wins over this one.
 */
export const test = base.extend({
  page: async ({ page, context, baseURL }, provide) => {
    const { origin } = new URL(baseURL ?? '')
    await context.route(
      (url) => url.origin !== origin,
      (route) => route.abort(),
    )
    await page.route(isReleasesRequest, (route) =>
      route.fulfill({ headers: CORS_HEADERS, json: GITHUB_RELEASES }),
    )
    await provide(page)
  },
})

type OpenProps = { page: Page; sitePage: SitePage }

/** Opens a page and waits for its heading. */
export const open = async ({ page, sitePage }: OpenProps): Promise<void> => {
  await page.goto(sitePage.path)
  await expectPage({ page, sitePage })
}

/** The browser is on the page: its address, its tab's title and its heading. */
export const expectPage = async ({ page, sitePage }: OpenProps): Promise<void> => {
  await expect(page).toHaveURL(sitePage.path)
  await expect(page).toHaveTitle(sitePage.title)
  await expect(page.getByRole('heading', { level: 1, name: sitePage.heading })).toBeVisible()
}

type NavProps = { page: Page; nav: (typeof NAVS)[keyof typeof NAVS] }

const navigation = ({ page, nav }: NavProps): Locator => page.getByRole('navigation', { name: nav })

type NavLinkProps = NavProps & { name: string }

export const navLink = ({ page, nav, name }: NavLinkProps): Locator =>
  navigation({ page, nav }).getByRole('link', { name, exact: true })

/** The list items that are versions: each ends in its link to the notes on GitHub. */
export const versionItems = ({ page }: PageProps): Locator =>
  page
    .getByRole('listitem')
    .filter({ has: page.getByRole('link', { name: SPLASH_COPY.whatsNew, exact: true }) })

type ExpectFilesProps = {
  /** The download links, in the order they are drawn. */
  links: Locator
  files: readonly ReleaseFile[]
}

/** The links are these files, in this order: each one's label, its size and its download. */
export const expectFiles = async ({ links, files }: ExpectFilesProps): Promise<void> => {
  await expect(links).toHaveText(
    files.map((file) => new RegExp(`^${file.label}\\s*${formatBytes({ bytes: file.bytes })}$`)),
  )
  await Promise.all(
    files.map((file, index) => expect(links.nth(index)).toHaveAttribute(ATTRIBUTES.href, file.url)),
  )
}
