import { isRecord } from '@shared/http'
import { SPLASH_COPY } from '@/copy'

const REPO_URL = 'https://github.com/codebend3r/maester'

/** The splash's own pages. */
export const PATHS = { versions: '/releases/' } as const

/*
 * GitHub's releases, newest first, a page at a time. CI tags every merge as a build
 * (vX.Y.Z.N), so a version's release can sit pages down; the cap bounds the asks against
 * GitHub's 60 an hour for a visitor.
 */
const RELEASES_PAGE_SIZE = 100
const RELEASES_MAX_PAGES = 10

type ReleasesUrlProps = { page: number }

const releasesUrl = ({ page }: ReleasesUrlProps): string =>
  `https://api.github.com/repos/codebend3r/maester/releases?per_page=${RELEASES_PAGE_SIZE}&page=${page}`

// A version's tag, vX.Y.Z; the build tags CI puts on each merge have a fourth number.
const VERSION_TAG = /^v\d+\.\d+\.\d+$/

export const PLATFORMS = { mac: 'mac', windows: 'windows', androidTv: 'androidTv' } as const
type Platform = (typeof PLATFORMS)[keyof typeof PLATFORMS]

/** What the button calls each platform, and what the line under it calls its computers. */
const PLATFORM_COPY = {
  mac: { name: 'Mac', computers: 'Macs with Apple silicon' },
  windows: { name: 'Windows', computers: 'Windows PCs' },
  androidTv: { name: 'Android TV', computers: 'Android TV' },
} as const satisfies Record<Platform, { name: string; computers: string }>

type Download = { platform: Platform; label: string }

/** How one workflow names its files, `<prefix>-<version>-<download>`, and the downloads it ships. */
export type Catalog = { fileName: RegExp; downloads: Readonly<Record<string, Download>> }

/**
 * The files each release workflow ships, one row per download. desktop-release.yml names
 * Raven's raven-player-<version>-<download>; Intel Macs are not built, so x64 is always
 * Windows. device-release.yml names the device app's raven-app-<version>-<download>.
 */
export const CATALOGS = {
  desktop: {
    fileName: /^raven-player-\d+\.\d+\.\d+-(.+)$/,
    downloads: {
      'arm64.dmg': { platform: PLATFORMS.mac, label: 'Mac, disk image' },
      'arm64.zip': { platform: PLATFORMS.mac, label: 'Mac, zip archive' },
      'x64-setup.exe': { platform: PLATFORMS.windows, label: 'Windows, installer' },
      'x64.zip': { platform: PLATFORMS.windows, label: 'Windows, zip archive' },
    },
  },
  devices: {
    fileName: /^raven-app-\d+\.\d+\.\d+-(.+)$/,
    downloads: {
      'android-tv.apk': { platform: PLATFORMS.androidTv, label: 'Android TV, APK' },
    },
  },
} as const satisfies Record<string, Catalog>

type CatalogDownloadProps = { catalog: Catalog; name: string }

const catalogDownload = ({ catalog, name }: CatalogDownloadProps): Download | null => {
  const suffix = catalog.fileName.exec(name)?.[1] ?? ''
  return Object.entries(catalog.downloads).find(([key]) => key === suffix)?.[1] ?? null
}

type DownloadOfProps = { catalogs: readonly Catalog[]; name: string }

const downloadOf = ({ catalogs, name }: DownloadOfProps): Download | null =>
  catalogs
    .map((catalog) => catalogDownload({ catalog, name }))
    .find((download) => download !== null) ?? null

export type ReleaseFile = Download & {
  url: string
  bytes: number
}

export type Release = {
  version: string
  date: string
  notesUrl: string
  files: readonly ReleaseFile[]
}

type FileOfProps = { catalogs: readonly Catalog[]; asset: unknown }

const fileOf = ({ catalogs, asset }: FileOfProps): ReleaseFile | null => {
  if (!isRecord(asset)) return null
  const { name, browser_download_url: url, size } = asset
  if (typeof name !== 'string' || typeof url !== 'string' || typeof size !== 'number') return null
  const download = downloadOf({ catalogs, name })
  if (download === null) return null
  return { ...download, url, bytes: size }
}

type ReleaseOfProps = { catalogs: readonly Catalog[]; release: unknown }

const releaseOf = ({ catalogs, release }: ReleaseOfProps): Release | null => {
  if (!isRecord(release)) return null
  const { tag_name: tag, published_at: date, assets, draft, prerelease } = release
  if (typeof tag !== 'string' || typeof date !== 'string' || !Array.isArray(assets)) return null
  if (!!draft || !!prerelease || !VERSION_TAG.test(tag)) return null
  const files = assets.map((asset) => fileOf({ catalogs, asset })).filter((file) => file !== null)
  if (files.length === 0) return null
  return {
    version: tag.replace(/^v/, ''),
    date,
    notesUrl: `${REPO_URL}/releases/tag/${tag}`,
    files,
  }
}

type ParseReleasesProps = {
  releases: unknown
  catalogs: readonly Catalog[]
}

/**
 * The published versions (never a build tag) that carry a file of the catalogs, newest
 * first, as GitHub lists them.
 */
export const parseReleases = ({ releases, catalogs }: ParseReleasesProps): readonly Release[] =>
  Array.isArray(releases)
    ? releases
        .map((release) => releaseOf({ catalogs, release }))
        .filter((release) => release !== null)
    : []

type FormatBytesProps = {
  bytes: number
}

export const formatBytes = ({ bytes }: FormatBytesProps): string =>
  `${Math.round(bytes / 1_000_000)} MB`

type FormatDateProps = {
  date: string
}

const dateFormat = new Intl.DateTimeFormat('en', { day: 'numeric', month: 'long', year: 'numeric' })

export const formatDate = ({ date }: FormatDateProps): string => dateFormat.format(new Date(date))

// Every Windows browser names the system in its user agent.
const WINDOWS_USER_AGENT = 'Windows'

type PlatformOfProps = {
  userAgent: string
}

/** The visitor's platform, from the browser's user agent; anything but Windows is offered the Mac app. */
export const platformOf = ({ userAgent }: PlatformOfProps): Platform =>
  userAgent.includes(WINDOWS_USER_AGENT) ? PLATFORMS.windows : PLATFORMS.mac

/** The download button's title and the files under it. */
type DownloadMenu = { title: string; files: readonly ReleaseFile[] }

type DownloadMenuProps = {
  release: Release
  platform: Platform
}

/**
 * The button's title and the release's files, the visitor's own first. A release with no
 * file for the visitor's platform offers the platform it does have.
 */
export const downloadMenu = ({ release, platform }: DownloadMenuProps): DownloadMenu => {
  const offered = release.files.some((file) => file.platform === platform)
    ? platform
    : (release.files[0]?.platform ?? platform)
  return {
    title: SPLASH_COPY.downloadFor(PLATFORM_COPY[offered].name),
    files: release.files.toSorted(
      (a, b) => Number(b.platform === offered) - Number(a.platform === offered),
    ),
  }
}

type PlatformListProps = {
  release: Release
}

/** The computers a release has files for: "Macs with Apple silicon and Windows PCs". */
export const platformList = ({ release }: PlatformListProps): string =>
  Object.values(PLATFORMS)
    .filter((platform) => release.files.some((file) => file.platform === platform))
    .map((platform) => PLATFORM_COPY[platform].computers)
    .join(SPLASH_COPY.platformsJoiner)

type FetchPageProps = { page: number }

// One page of GitHub's releases; a refusal or anything but a list reads as an empty page.
const fetchPage = async ({ page }: FetchPageProps): Promise<readonly unknown[]> => {
  const response = await fetch(releasesUrl({ page }))
  if (!response.ok) return []
  const body: unknown = await response.json()
  return Array.isArray(body) ? body : []
}

type CollectReleasesProps = {
  catalogs: readonly Catalog[]
  limit: number
  page: number
  found: readonly Release[]
}

const collectReleases = async ({
  catalogs,
  limit,
  page,
  found,
}: CollectReleasesProps): Promise<readonly Release[]> => {
  const raw = await fetchPage({ page })
  const releases = [...found, ...parseReleases({ releases: raw, catalogs })]
  const isLastPage = raw.length < RELEASES_PAGE_SIZE || page >= RELEASES_MAX_PAGES
  if (isLastPage || releases.length >= limit) return releases.slice(0, limit)
  return collectReleases({ catalogs, limit, page: page + 1, found: releases })
}

type FetchReleasesProps = {
  catalogs: readonly Catalog[]
  /** Stops asking GitHub for pages once this many releases are found. */
  limit?: number
}

/** Reads the releases from GitHub; no network, an outage or a rate limit answers an empty list. */
export const fetchReleases = async ({
  catalogs,
  limit = Number.POSITIVE_INFINITY,
}: FetchReleasesProps): Promise<readonly Release[]> => {
  try {
    return await collectReleases({ catalogs, limit, page: 1, found: [] })
  } catch {
    return []
  }
}
