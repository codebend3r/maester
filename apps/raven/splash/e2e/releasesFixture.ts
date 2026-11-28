import { CATALOGS, parseReleases } from '@/releases'

/** The repository the site's links and its releases lead to, as GitHub names it. */
export const REPO = 'codebend3r/maester'
export const REPO_URL = `https://github.com/${REPO}`

const DOWNLOADS = `${REPO_URL}/releases/download`

type AssetProps = { tag: string; name: string; size: number }

// One file of a release, as GitHub's API lists it.
const asset = ({ tag, name, size }: AssetProps) => ({
  name,
  browser_download_url: `${DOWNLOADS}/${tag}/${name}`,
  size,
})

/** The newest version's Mac disk image, which Raven's page offers a Mac's visitor first. */
export const MAC_DISK_IMAGE = {
  url: `${DOWNLOADS}/v1.2.0/raven-player-1.2.0-arm64.dmg`,
  size: '120 MB',
} as const

/** The newest version's Windows installer, which Raven's page offers a Windows visitor first. */
export const WINDOWS_INSTALLER = {
  url: `${DOWNLOADS}/v1.2.0/raven-player-1.2.0-x64-setup.exe`,
  size: '98 MB',
} as const

/** The newest version as the pages word it. */
export const LATEST = {
  version: '1.2.0',
  date: 'March 14, 2026',
  notesUrl: `${REPO_URL}/releases/tag/v1.2.0`,
} as const

/** The versions each page lists, newest first: the desktop's alone, and every catalog's. */
export const LISTED_VERSIONS = {
  desktop: ['1.2.0', '1.1.0'],
  all: ['1.2.0', '1.1.0', '1.0.5'],
} as const

/**
 * What GitHub's releases API answers in every test, newest first: a draft and one of CI's build
 * tags, which no page lists; a version with every catalog's files, Windows' before the Mac's and
 * a file no catalog names among them; a version for the Mac alone; and one with only an APK,
 * which the releases page leaves out and the dev builds page lists.
 */
export const GITHUB_RELEASES = [
  {
    tag_name: 'v1.3.0',
    published_at: '2026-04-01T12:00:00Z',
    draft: true,
    prerelease: false,
    assets: [asset({ tag: 'v1.3.0', name: 'raven-player-1.3.0-arm64.dmg', size: 121_000_000 })],
  },
  {
    tag_name: 'v1.2.0.7',
    published_at: '2026-03-20T12:00:00Z',
    draft: false,
    prerelease: false,
    assets: [asset({ tag: 'v1.2.0.7', name: 'raven-player-1.2.0-arm64.dmg', size: 120_500_000 })],
  },
  {
    tag_name: 'v1.2.0',
    published_at: '2026-03-14T12:00:00Z',
    draft: false,
    prerelease: false,
    assets: [
      asset({ tag: 'v1.2.0', name: 'raven-player-1.2.0-x64-setup.exe', size: 98_300_000 }),
      asset({ tag: 'v1.2.0', name: 'raven-player-1.2.0-x64.zip', size: 131_600_000 }),
      asset({ tag: 'v1.2.0', name: 'raven-player-1.2.0-arm64.dmg', size: 120_400_000 }),
      asset({ tag: 'v1.2.0', name: 'raven-player-1.2.0-arm64.zip', size: 116_200_000 }),
      asset({ tag: 'v1.2.0', name: 'latest-mac.yml', size: 512 }),
      asset({ tag: 'v1.2.0', name: 'raven-app-1.2.0-android-tv.apk', size: 64_700_000 }),
      asset({ tag: 'v1.2.0', name: 'raven-app-1.2.0-android.apk', size: 61_200_000 }),
      asset({ tag: 'v1.2.0', name: 'wren-1.2.0-android.apk', size: 48_900_000 }),
    ],
  },
  {
    tag_name: 'v1.1.0',
    published_at: '2026-01-05T12:00:00Z',
    draft: false,
    prerelease: false,
    assets: [asset({ tag: 'v1.1.0', name: 'raven-player-1.1.0-arm64.dmg', size: 118_000_000 })],
  },
  {
    tag_name: 'v1.0.5',
    published_at: '2025-12-02T12:00:00Z',
    draft: false,
    prerelease: false,
    assets: [asset({ tag: 'v1.0.5', name: 'raven-app-1.0.5-android-tv.apk', size: 63_000_000 })],
  },
] as const

/** The fixture as each page reads it, through the page's own parser. */
export const PARSED_RELEASES = {
  desktop: parseReleases({ releases: GITHUB_RELEASES, catalogs: [CATALOGS.desktop] }),
  all: parseReleases({ releases: GITHUB_RELEASES, catalogs: Object.values(CATALOGS) }),
} as const
