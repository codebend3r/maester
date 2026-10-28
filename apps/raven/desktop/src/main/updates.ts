import { isBoolean, isString, listOf, object } from '@raven/core'
import { NATIVE_TARGETS, type NativeTarget } from '@raven/mpv'
import { parseJson } from '@/main/parseJson'
import { HTTP_HEADERS } from '@/shared/httpHeaders'

export const RELEASES_URL = 'https://api.github.com/repos/codebend3r/maester/releases?per_page=100'
const GITHUB_API_ORIGIN = 'https://api.github.com'
// GitHub's `Link: rel="next"` names the repository by its id, not its owner and name.
const RELEASE_LIST_PATHS = [
  '/repos/codebend3r/maester/releases',
  '/repositories/1388607730/releases',
] as const
const RELEASE_PAGE_PREFIX = 'https://github.com/codebend3r/maester/releases/tag/'
export const CHECK_INTERVAL_MS = 86_400_000
const UPDATE_TIMEOUT_MS = 10_000
/** Across every page read. */
export const MAX_RELEASES_CHARS = 2_097_152
export const MAX_RELEASE_PAGES = 5

type AppAssetNameForProps = {
  version: string
  target: NativeTarget
}

/**
 * The app the release workflow attaches for a target: the dmg for Apple silicon, the installer
 * for Windows. A release without it has no app to offer that target yet.
 */
export const appAssetNameFor = ({ version, target }: AppAssetNameForProps): string => {
  switch (target) {
    case NATIVE_TARGETS.darwinArm64:
      return `raven-player-${version}-arm64.dmg`
    case NATIVE_TARGETS.win32X64:
      return `raven-player-${version}-x64-setup.exe`
    default: {
      const unreachable: never = target
      return unreachable
    }
  }
}

/** The build a check looks for in each release; null where raven has none, which no release carries. */
type UpdateTarget = NativeTarget | null

export const isGithubRelease = object({
  tag_name: isString,
  draft: isBoolean,
  prerelease: isBoolean,
  assets: listOf(object({ name: isString })),
})

export type ReleaseVersion = { major: number; minor: number; patch: number }

// No leading zeros, so `v01.2.3` cannot be offered as a twin of `v1.2.3` under another name.
const VERSION_PATTERN = /^v?(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/

const ZERO_VERSION: ReleaseVersion = { major: 0, minor: 0, patch: 0 }

/** Exactly three numbers, so a build tag (`v0.5.4.9`) or a prerelease tag is null. */
export const parseVersion = (text: string): ReleaseVersion | null => {
  const match = VERSION_PATTERN.exec(text)
  if (!match) return null
  const [major = 0, minor = 0, patch = 0] = match.slice(1).map(Number)
  return { major, minor, patch }
}

type CompareVersionsProps = { a: ReleaseVersion; b: ReleaseVersion }

export const compareVersions = ({ a, b }: CompareVersionsProps): number =>
  [a.major - b.major, a.minor - b.minor, a.patch - b.patch].find(
    (difference) => difference !== 0,
  ) ?? 0

export const UPDATE_FINDING_KINDS = { current: 'current', newer: 'newer' } as const

export type UpdateFinding =
  | { kind: typeof UPDATE_FINDING_KINDS.current }
  | { kind: typeof UPDATE_FINDING_KINDS.newer; version: string; pageUrl: string }

export const UPDATE_PROBLEMS = {
  unreachable: 'GitHub did not answer.',
  busy: 'GitHub is busy. Try again later.',
  unreadable: 'GitHub sent something Raven could not read.',
  // Nothing read carried the app, so there is no evidence this copy is the newest.
  unlisted: 'GitHub listed no Raven release.',
} as const

export type UpdateCheck = { ok: true; finding: UpdateFinding } | { ok: false; problem: string }

const failed = (problem: string): UpdateCheck => ({ ok: false, problem })

type Candidate = { version: ReleaseVersion; text: string }

export type RunningVersion = { version: ReleaseVersion; isPrerelease: boolean }

const PRERELEASE_PATTERN = /^[0-9A-Za-z.-]+$/

/** The running version's own release, and whether it is a prerelease of it (`0.6.0-rc.1`). */
export const parseRunning = (text: string): RunningVersion | null => {
  const dash = text.indexOf('-')
  const core = dash === -1 ? text : text.slice(0, dash)
  const suffix = dash === -1 ? null : text.slice(dash + 1)
  const version = parseVersion(core)
  if (!version) return null
  if (suffix === null) return { version, isPrerelease: false }
  return PRERELEASE_PATTERN.test(suffix) ? { version, isPrerelease: true } : null
}

type IsNewerProps = {
  candidate: ReleaseVersion
  running: RunningVersion
}

// A prerelease sits below its own release and above everything older.
const isNewer = ({ candidate, running }: IsNewerProps): boolean => {
  const difference = compareVersions({ a: candidate, b: running.version })
  return difference > 0 || (difference === 0 && running.isPrerelease)
}

const isAnything = (_value: unknown): _value is unknown => true

const isList = listOf(isAnything)

type CandidateOfProps = {
  release: unknown
  target: UpdateTarget
}

const candidateOf = ({ release, target }: CandidateOfProps): Candidate | null => {
  if (target === null) return null
  if (!isGithubRelease(release) || release.draft || release.prerelease) return null
  if (!release.tag_name.startsWith('v')) return null
  const version = parseVersion(release.tag_name)
  if (!version) return null
  const text = release.tag_name.slice(1)
  const app = appAssetNameFor({ version: text, target })
  const hasApp = release.assets.some((asset) => asset.name === app)
  return hasApp ? { version, text } : null
}

type FindUpdateProps = {
  releases: unknown
  current: string
  target: UpdateTarget
}

/**
 * The highest full release that carries the target's app, against the running version. The page
 * link is built from the tag, never taken from the reply. Current only when such a release
 * was seen; with none, there is nothing to say the running version is the newest.
 */
export const findUpdate = ({ releases, current, target }: FindUpdateProps): UpdateCheck => {
  if (!isList(releases)) return failed(UPDATE_PROBLEMS.unreadable)
  const highest = releases.reduce<Candidate | null>((best, release) => {
    const candidate = candidateOf({ release, target })
    if (!candidate) return best
    if (!best) return candidate
    return compareVersions({ a: candidate.version, b: best.version }) > 0 ? candidate : best
  }, null)
  if (!highest) return failed(UPDATE_PROBLEMS.unlisted)
  const running = parseRunning(current) ?? { version: ZERO_VERSION, isPrerelease: false }
  if (!isNewer({ candidate: highest.version, running })) {
    return { ok: true, finding: { kind: UPDATE_FINDING_KINDS.current } }
  }
  return {
    ok: true,
    finding: {
      kind: UPDATE_FINDING_KINDS.newer,
      version: highest.text,
      pageUrl: `${RELEASE_PAGE_PREFIX}v${highest.text}`,
    },
  }
}

const LINK_PATTERN = /<([^<>]*)>\s*;\s*rel="([^"]*)"/g

const parseUrl = (text: string): URL | null => (URL.canParse(text) ? new URL(text) : null)

type NextPageUrlProps = {
  link: string | null
  start: string
}

/**
 * The next page of the releases list from a `Link` header, only when it is the same list:
 * GitHub's own (whose next links name the repository by id) or, for the test hook, the
 * list the check started from. Null for anything else, which ends the walk.
 */
export const nextPageUrl = ({ link, start }: NextPageUrlProps): string | null => {
  const raw =
    [...(link ?? '').matchAll(LINK_PATTERN)].find(([, , rel = '']) =>
      rel.split(' ').includes('next'),
    )?.[1] ?? null
  const next = raw === null ? null : parseUrl(raw)
  const from = parseUrl(start)
  if (next === null || from === null) return null
  if (next.username !== '' || next.password !== '') return null
  const isGithubList =
    next.origin === GITHUB_API_ORIGIN && RELEASE_LIST_PATHS.some((path) => path === next.pathname)
  const isStartList = next.origin === from.origin && next.pathname === from.pathname
  return isGithubList || isStartList ? next.href : null
}

type UpdateFetchProps = {
  url: string
  init: { headers: Record<string, string>; signal: AbortSignal }
}

export type UpdateFetch = (input: UpdateFetchProps) => Promise<{
  status: number
  headers: { get: (name: string) => string | null }
  text: () => Promise<string>
}>

type PageRead =
  | { ok: true; releases: unknown[]; next: string | null; chars: number }
  | { ok: false; problem: string }

type LinkOfProps = { get: (name: string) => string | null }

/** The header GitHub names the next page of the list in. */
const linkOf = (headers: LinkOfProps): string | null => {
  try {
    return headers.get(HTTP_HEADERS.link)
  } catch {
    return null
  }
}

type ReadPageProps = {
  fetch: UpdateFetch
  url: string
  init: Parameters<UpdateFetch>[0]['init']
  start: string
  charsLeft: number
}

const readPage = async ({
  fetch,
  url,
  init,
  start,
  charsLeft,
}: ReadPageProps): Promise<PageRead> => {
  // Through `then`, so a fetch that throws before returning its promise is a rejection too.
  const response = await Promise.resolve()
    .then(() => fetch({ url, init }))
    .catch(() => null)
  if (!response) return { ok: false, problem: UPDATE_PROBLEMS.unreachable }
  if (response.status === 403 || response.status === 429) {
    return { ok: false, problem: UPDATE_PROBLEMS.busy }
  }
  if (response.status !== 200) return { ok: false, problem: UPDATE_PROBLEMS.unreadable }
  const text = await Promise.resolve()
    .then(() => response.text())
    .catch(() => null)
  if (text === null) return { ok: false, problem: UPDATE_PROBLEMS.unreachable }
  if (text.length > charsLeft) return { ok: false, problem: UPDATE_PROBLEMS.unreadable }
  const parsed = parseJson(text)
  if (!isList(parsed)) return { ok: false, problem: UPDATE_PROBLEMS.unreadable }
  const next = nextPageUrl({ link: linkOf(response.headers), start })
  return { ok: true, releases: parsed, next, chars: text.length }
}

type WalkProps = {
  fetch: UpdateFetch
  url: string
  init: Parameters<UpdateFetch>[0]['init']
  start: string
  current: string
  target: UpdateTarget
  seen: unknown[]
  pagesLeft: number
  charsLeft: number
}

/**
 * Pages through the list until a newer release shows, the list ends or the page bound is
 * reached. GitHub orders the list by tag name, so neither a run of build releases nor
 * `v0.10.0` sorting after `v0.9.x` may hide the release that matters behind page 1, and a
 * running release seen early does not end the walk.
 */
const walk = async ({
  fetch,
  url,
  init,
  start,
  current,
  target,
  seen,
  pagesLeft,
  charsLeft,
}: WalkProps): Promise<UpdateCheck> => {
  const page = await readPage({ fetch, url, init, start, charsLeft })
  if (!page.ok) return failed(page.problem)
  const releases = [...seen, ...page.releases]
  const found = findUpdate({ releases, current, target })
  const hasNewer = found.ok && found.finding.kind === UPDATE_FINDING_KINDS.newer
  if (hasNewer || page.next === null || pagesLeft <= 1) return found
  return walk({
    fetch,
    url: page.next,
    init,
    start,
    current,
    target,
    seen: releases,
    pagesLeft: pagesLeft - 1,
    charsLeft: charsLeft - page.chars,
  })
}

type CheckForUpdatesProps = {
  fetch: UpdateFetch
  url: string
  current: string
  target: UpdateTarget
}

/** Asks GitHub for its releases, and never throws: every failure is a problem to show. */
export const checkForUpdates = async ({
  fetch,
  url,
  current,
  target,
}: CheckForUpdatesProps): Promise<UpdateCheck> => {
  // One deadline for every page, so the whole check is bounded, not each request.
  const init = {
    headers: {
      [HTTP_HEADERS.accept]: 'application/vnd.github+json',
      [HTTP_HEADERS.userAgent]: `raven-player/${current}`,
    },
    signal: AbortSignal.timeout(UPDATE_TIMEOUT_MS),
  }
  return walk({
    fetch,
    url,
    init,
    start: url,
    current,
    target,
    seen: [],
    pagesLeft: MAX_RELEASE_PAGES,
    charsLeft: MAX_RELEASES_CHARS,
  })
}

type IsCheckDueProps = {
  isEnabled: boolean
  checkedAt: number | null
  now: number
}

/** Due at launch when on and never run or unreadable, a day old, or ahead of the clock. */
export const isCheckDue = ({ isEnabled, checkedAt, now }: IsCheckDueProps): boolean => {
  if (!isEnabled) return false
  if (checkedAt === null || !Number.isFinite(checkedAt)) return true
  return checkedAt > now || now - checkedAt >= CHECK_INTERVAL_MS
}
