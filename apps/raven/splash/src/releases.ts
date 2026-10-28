const REPO_URL = 'https://github.com/codebend3r/maester'

/** The splash's own pages. */
export const PATHS = { versions: '/releases/' } as const

/** GitHub's releases, newest first; a page of 100 covers every version so far. */
const RELEASES_URL = 'https://api.github.com/repos/codebend3r/maester/releases?per_page=100'

const ARCHES = { arm64: 'arm64', x64: 'x64' } as const
type Arch = (typeof ARCHES)[keyof typeof ARCHES]

const KINDS = { dmg: 'dmg', zip: 'zip' } as const
type Kind = (typeof KINDS)[keyof typeof KINDS]

/** What the page calls each architecture and file kind. */
const ARCH_NAMES = { arm64: 'Apple silicon', x64: 'Intel' } as const satisfies Record<Arch, string>
const KIND_NAMES = { dmg: 'Disk image', zip: 'Zip archive' } as const satisfies Record<Kind, string>

const isArch = (value: string): value is Arch =>
  Object.values(ARCHES).some((arch) => arch === value)
const isKind = (value: string): value is Kind => Object.values(KINDS).some((kind) => kind === value)

// The release workflow names Raven's files raven-player-<version>-<arch>.<kind>.
const FILE_NAME = /^raven-player-\d+\.\d+\.\d+-([a-z0-9]+)\.([a-z]+)$/

export type ReleaseFile = {
  arch: Arch
  kind: Kind
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
  const match = FILE_NAME.exec(name)
  if (match === null) return null
  const [, arch, kind] = match
  if (arch === undefined || kind === undefined || !isArch(arch) || !isKind(kind)) return null
  return { arch, kind, url, bytes: size }
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

type FileLabelProps = {
  file: ReleaseFile
}

export const fileLabel = ({ file }: FileLabelProps): string =>
  `${ARCH_NAMES[file.arch]}, ${KIND_NAMES[file.kind].toLowerCase()}`

/** Reads the releases from GitHub; no network, an outage or a rate limit answers an empty list. */
export const fetchReleases = async (): Promise<readonly Release[]> => {
  try {
    const response = await fetch(RELEASES_URL)
    return response.ok ? parseReleases({ releases: await response.json() }) : []
  } catch {
    return []
  }
}
