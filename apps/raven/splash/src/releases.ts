const REPO_URL = 'https://github.com/codebend3r/maester'

/** The splash's own pages. */
export const PATHS = { versions: '/releases/' } as const

/** GitHub's releases, newest first; a page of 100 covers every version so far. */
const RELEASES_URL = 'https://api.github.com/repos/codebend3r/maester/releases?per_page=100'

export const PLATFORMS = { mac: 'mac', windows: 'windows' } as const
type Platform = (typeof PLATFORMS)[keyof typeof PLATFORMS]

/** What the button calls each platform, and what the line under it calls its computers. */
const PLATFORM_COPY = {
  mac: { name: 'Mac', computers: 'Macs with Apple silicon' },
  windows: { name: 'Windows', computers: 'Windows PCs' },
} as const satisfies Record<Platform, { name: string; computers: string }>

type Download = { platform: Platform; label: string }

// The release workflow names Raven's files raven-player-<version>-<download>, one row
// here per download it ships. Intel Macs are not built, so x64 is always Windows.
const DOWNLOADS = {
  'arm64.dmg': { platform: PLATFORMS.mac, label: 'Mac, disk image' },
  'arm64.zip': { platform: PLATFORMS.mac, label: 'Mac, zip archive' },
  'x64-setup.exe': { platform: PLATFORMS.windows, label: 'Windows, installer' },
  'x64.zip': { platform: PLATFORMS.windows, label: 'Windows, zip archive' },
} as const satisfies Record<string, Download>

const FILE_NAME = /^raven-player-\d+\.\d+\.\d+-(.+)$/

const downloadOf = (suffix: string): Download | null =>
  Object.entries(DOWNLOADS).find(([name]) => name === suffix)?.[1] ?? null

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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const fileOf = (asset: unknown): ReleaseFile | null => {
  if (!isRecord(asset)) return null
  const { name, browser_download_url: url, size } = asset
  if (typeof name !== 'string' || typeof url !== 'string' || typeof size !== 'number') return null
  const download = downloadOf(FILE_NAME.exec(name)?.[1] ?? '')
  if (download === null) return null
  return { ...download, url, bytes: size }
}

const releaseOf = (release: unknown): Release | null => {
  if (!isRecord(release)) return null
  const { tag_name: tag, published_at: date, assets, draft, prerelease } = release
  if (typeof tag !== 'string' || typeof date !== 'string' || !Array.isArray(assets)) return null
  if (draft === true || prerelease === true) return null
  const files = assets.map(fileOf).filter((file) => file !== null)
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
}

/** The published releases that carry a Raven download, newest first, as GitHub lists them. */
export const parseReleases = ({ releases }: ParseReleasesProps): readonly Release[] =>
  Array.isArray(releases) ? releases.map(releaseOf).filter((release) => release !== null) : []

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

type DownloadMenuProps = {
  release: Release
  platform: Platform
}

/**
 * The button's title and the release's files, the visitor's own first. A release with no
 * file for the visitor's platform offers the platform it does have.
 */
export const downloadMenu = ({ release, platform }: DownloadMenuProps) => {
  const offered = release.files.some((file) => file.platform === platform)
    ? platform
    : (release.files[0]?.platform ?? platform)
  return {
    title: `Download for ${PLATFORM_COPY[offered].name}`,
    files: release.files.toSorted(
      (a, b) => Number(b.platform === offered) - Number(a.platform === offered),
    ),
  } as const
}

type PlatformListProps = {
  release: Release
}

/** The computers a release has files for: "Macs with Apple silicon and Windows PCs". */
export const platformList = ({ release }: PlatformListProps): string =>
  Object.values(PLATFORMS)
    .filter((platform) => release.files.some((file) => file.platform === platform))
    .map((platform) => PLATFORM_COPY[platform].computers)
    .join(' and ')

/** Reads the releases from GitHub; no network, an outage or a rate limit answers an empty list. */
export const fetchReleases = async (): Promise<readonly Release[]> => {
  try {
    const response = await fetch(RELEASES_URL)
    return response.ok ? parseReleases({ releases: await response.json() }) : []
  } catch {
    return []
  }
}
