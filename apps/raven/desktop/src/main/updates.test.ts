import { describe, expect, it } from 'bun:test'
import { NATIVE_TARGETS } from '@raven/mpv'
import { HTTP_HEADERS } from '@/shared/httpHeaders'
import {
  CHECK_INTERVAL_MS,
  MAX_RELEASE_PAGES,
  MAX_RELEASES_CHARS,
  nextPageUrl,
  parseRunning,
  RELEASES_URL,
  UPDATE_PROBLEMS,
  checkForUpdates,
  appAssetNameFor,
  compareVersions,
  findUpdate,
  isCheckDue,
  isGithubRelease,
  parseVersion,
  type UpdateCheck,
  type UpdateFetch,
} from '@/main/updates'

type ReleaseProps = {
  tag: string
  draft?: boolean
  prerelease?: boolean
  assets?: string[]
}

const MAC = NATIVE_TARGETS.darwinArm64

const release = ({
  tag,
  draft = false,
  prerelease = false,
  assets = [appAssetNameFor({ version: tag.slice(1), target: MAC })],
}: ReleaseProps) => ({
  tag_name: tag,
  draft,
  prerelease,
  assets: assets.map((name) => ({ name })),
})

const HOUR_MS = 3_600_000
const NOW = 1_800_000_000_000

describe('the constants', () => {
  it('reads the releases list and checks once a day', () => {
    expect(RELEASES_URL).toBe(
      'https://api.github.com/repos/codebend3r/maester/releases?per_page=100',
    )
    expect(MAX_RELEASE_PAGES).toBe(5)
    expect(CHECK_INTERVAL_MS).toBe(24 * HOUR_MS)
    expect(MAX_RELEASES_CHARS).toBe(2 * 1024 * 1024)
  })

  it('names the app the release workflow attaches for each target', () => {
    expect(appAssetNameFor({ version: '0.6.0', target: MAC })).toBe('raven-player-0.6.0-arm64.dmg')
    expect(appAssetNameFor({ version: '0.6.0', target: NATIVE_TARGETS.win32X64 })).toBe(
      'raven-player-0.6.0-x64-setup.exe',
    )
  })
})

describe('isGithubRelease', () => {
  it('accepts a release and rejects one missing a field', () => {
    expect(isGithubRelease(release({ tag: 'v0.6.0' }))).toBe(true)
    expect(isGithubRelease({ tag_name: 'v0.6.0', draft: false, prerelease: false })).toBe(false)
    expect(isGithubRelease({ ...release({ tag: 'v0.6.0' }), assets: [{ name: 3 }] })).toBe(false)
  })
})

describe('parseVersion', () => {
  it('reads three numbers with or without a leading v', () => {
    expect(parseVersion('v0.5.4')).toEqual({ major: 0, minor: 5, patch: 4 })
    expect(parseVersion('0.5.4')).toEqual({ major: 0, minor: 5, patch: 4 })
  })

  it('reads a part of exactly zero', () => {
    expect(parseVersion('v0.0.10')).toEqual({ major: 0, minor: 0, patch: 10 })
  })

  it.each([
    'v0.5.4.9',
    'v1.0.0-rc.1',
    '0.5',
    'vX',
    '',
    'v1.2.3 ',
    'v1234567.0.0',
    'v01.2.3',
    'v1.02.3',
    'v1.2.00',
  ])('is null for %p', (text) => {
    expect(parseVersion(text)).toBeNull()
  })
})

describe('compareVersions', () => {
  const versionOf = (text: string) => parseVersion(text) ?? { major: -1, minor: -1, patch: -1 }

  it('compares numbers, not text', () => {
    expect(compareVersions({ a: versionOf('10.0.0'), b: versionOf('9.9.9') })).toBeGreaterThan(0)
    expect(compareVersions({ a: versionOf('0.10.0'), b: versionOf('0.9.12') })).toBeGreaterThan(0)
    expect(compareVersions({ a: versionOf('0.9.12'), b: versionOf('0.10.0') })).toBeLessThan(0)
    expect(compareVersions({ a: versionOf('1.2.3'), b: versionOf('1.2.3') })).toBe(0)
    expect(compareVersions({ a: versionOf('1.2.4'), b: versionOf('1.2.3') })).toBeGreaterThan(0)
  })
})

describe('parseRunning', () => {
  it('reads a release as itself', () => {
    expect(parseRunning('0.6.0')).toEqual({
      version: { major: 0, minor: 6, patch: 0 },
      isPrerelease: false,
    })
  })

  it("reads a prerelease's own release and marks it a prerelease", () => {
    expect(parseRunning('0.6.0-rc.1')).toEqual({
      version: { major: 0, minor: 6, patch: 0 },
      isPrerelease: true,
    })
    expect(parseRunning('v1.2.3-beta-2.x')).toEqual({
      version: { major: 1, minor: 2, patch: 3 },
      isPrerelease: true,
    })
  })

  it.each(['dev', '0.6.0-', '0.6.0-rc 1', '0.6.0.1', '01.6.0-rc.1', ''])(
    'is null for %p',
    (text) => {
      expect(parseRunning(text)).toBeNull()
    },
  )
})

const newer = (version: string): UpdateCheck => ({
  ok: true,
  finding: {
    kind: 'newer',
    version,
    pageUrl: `https://github.com/codebend3r/maester/releases/tag/v${version}`,
  },
})

const CURRENT: UpdateCheck = { ok: true, finding: { kind: 'current' } }
const UNLISTED: UpdateCheck = { ok: false, problem: UPDATE_PROBLEMS.unlisted }
const UNREADABLE: UpdateCheck = { ok: false, problem: UPDATE_PROBLEMS.unreadable }

type BuildsProps = { version: string; count: number }

/** `count` build releases of `version`, as `main-smoke-test.yml` tags them, none with the app. */
const builds = ({ version, count }: BuildsProps) =>
  Array.from({ length: count }, (_, index) =>
    release({ tag: `v${version}.${count - index}`, assets: [] }),
  )

describe('findUpdate', () => {
  it('offers the highest full release that carries the app', () => {
    const releases = [
      release({ tag: 'v0.5.4.9' }),
      release({ tag: 'v0.7.0-rc.1', prerelease: true }),
      release({ tag: 'v0.8.0', draft: true }),
      release({ tag: 'v0.6.1', assets: [] }),
      release({ tag: 'v0.6.0' }),
    ]
    expect(findUpdate({ target: MAC, releases, current: '0.5.4' })).toEqual(newer('0.6.0'))
  })

  it("offers Windows the highest release that carries the installer, not the Mac's dmg", () => {
    const releases = [
      release({ tag: 'v0.6.1' }),
      release({ tag: 'v0.6.0', assets: ['raven-player-0.6.0-x64-setup.exe'] }),
    ]
    expect(findUpdate({ target: NATIVE_TARGETS.win32X64, releases, current: '0.5.4' })).toEqual(
      newer('0.6.0'),
    )
  })

  it('offers nothing to a system raven has no build for', () => {
    expect(
      findUpdate({ target: null, releases: [release({ tag: 'v0.6.0' })], current: '0.5.4' }),
    ).toEqual(UNLISTED)
  })

  it('skips a release whose dmg is for another version or is not the arm64 dmg', () => {
    const releases = [
      release({
        tag: 'v0.6.1',
        assets: [
          appAssetNameFor({ version: '0.6.0', target: MAC }),
          'raven-player-0.6.1-arm64.zip',
        ],
      }),
      release({ tag: 'v0.6.0' }),
    ]
    expect(findUpdate({ target: MAC, releases, current: '0.5.4' })).toEqual(newer('0.6.0'))
  })

  it('finds v0.10.0 listed after the v0.9 releases, as GitHub orders tags', () => {
    const releases = [
      ...builds({ version: '0.9.3', count: 12 }),
      release({ tag: 'v0.9.3' }),
      release({ tag: 'v0.9.2' }),
      release({ tag: 'v0.2.0' }),
      release({ tag: 'v0.10.0' }),
      release({ tag: 'v0.1.0' }),
    ]
    expect(findUpdate({ target: MAC, releases, current: '0.9.3' })).toEqual(newer('0.10.0'))
  })

  it('compares versions as numbers', () => {
    const releases = [release({ tag: 'v9.9.9' }), release({ tag: 'v10.0.0' })]
    expect(findUpdate({ target: MAC, releases, current: '9.9.9' })).toEqual(newer('10.0.0'))
  })

  it('is current when the release it saw is the running one or older', () => {
    const releases = [release({ tag: 'v0.5.4' }), release({ tag: 'v0.5.3' })]
    expect(findUpdate({ target: MAC, releases, current: '0.5.4' })).toEqual(CURRENT)
    expect(
      findUpdate({ target: MAC, releases: [release({ tag: 'v0.5.3' })], current: '0.5.4' }),
    ).toEqual(CURRENT)
  })

  it('never claims current when no release in the list carries the app', () => {
    expect(findUpdate({ target: MAC, releases: [], current: '0.5.4' })).toEqual(UNLISTED)
    expect(
      findUpdate({
        target: MAC,
        releases: builds({ version: '0.5.4', count: 40 }),
        current: '0.5.4',
      }),
    ).toEqual(UNLISTED)
  })

  it('skips a tag with leading zeros', () => {
    const releases = [release({ tag: 'v01.2.3' })]
    expect(findUpdate({ target: MAC, releases, current: '0.5.4' })).toEqual(UNLISTED)
  })

  it('skips a tag without its leading v', () => {
    const releases = [{ ...release({ tag: 'v0.6.0' }), tag_name: '0.6.0' }]
    expect(findUpdate({ target: MAC, releases, current: '0.5.4' })).toEqual(UNLISTED)
  })

  it('counts a current version that does not parse as 0.0.0', () => {
    const releases = [release({ tag: 'v0.0.1' })]
    expect(findUpdate({ target: MAC, releases, current: 'dev' })).toEqual(newer('0.0.1'))
  })

  describe('from a prerelease', () => {
    it('offers its own release', () => {
      const releases = [release({ tag: 'v0.6.0' }), release({ tag: 'v0.5.4' })]
      expect(findUpdate({ target: MAC, releases, current: '0.6.0-rc.1' })).toEqual(newer('0.6.0'))
    })

    it('never offers an older release', () => {
      const releases = [release({ tag: 'v0.5.4' }), release({ tag: 'v0.5.3' })]
      expect(findUpdate({ target: MAC, releases, current: '0.6.0-rc.1' })).toEqual(CURRENT)
    })

    it('offers a later release', () => {
      const releases = [release({ tag: 'v0.6.1' }), release({ tag: 'v0.5.4' })]
      expect(findUpdate({ target: MAC, releases, current: '0.6.0-rc.2' })).toEqual(newer('0.6.1'))
    })
  })

  it("ignores the reply's own links", () => {
    const releases = [
      {
        ...release({ tag: 'v0.6.0' }),
        html_url: 'https://evil.example/',
        url: 'https://evil.example/',
      },
    ]
    expect(findUpdate({ target: MAC, releases, current: '0.5.4' })).toEqual(newer('0.6.0'))
  })

  it('skips entries that are not releases', () => {
    const releases = [null, { tag_name: 3 }, 'v9.0.0', release({ tag: 'v0.6.0' })]
    expect(findUpdate({ target: MAC, releases, current: '0.5.4' })).toEqual(newer('0.6.0'))
  })

  it.each([null, {}, { message: 'x' }, 'v0.6.0', 3])(
    'is unreadable for a reply of %p',
    (releases) => {
      expect(findUpdate({ target: MAC, releases, current: '0.5.4' })).toEqual(UNREADABLE)
    },
  )
})

const GITHUB_NEXT = 'https://api.github.com/repositories/1388607730/releases?per_page=100&page=2'

describe('nextPageUrl', () => {
  const linkTo = (url: string) =>
    `<${url}>; rel="next", <https://api.github.com/repositories/1388607730/releases?per_page=100&page=9>; rel="last"`

  it("follows GitHub's next link, which names the repository by id", () => {
    expect(nextPageUrl({ link: linkTo(GITHUB_NEXT), start: RELEASES_URL })).toBe(GITHUB_NEXT)
  })

  it('follows a next link to the releases list by its owner and name', () => {
    const next = 'https://api.github.com/repos/codebend3r/maester/releases?per_page=100&page=2'
    expect(nextPageUrl({ link: linkTo(next), start: RELEASES_URL })).toBe(next)
  })

  it('finds next among several relations and in any order', () => {
    const link = `<https://api.github.com/repositories/1388607730/releases?page=1>; rel="prev first", <${GITHUB_NEXT}>; rel="next"`
    expect(nextPageUrl({ link, start: RELEASES_URL })).toBe(GITHUB_NEXT)
  })

  it.each([
    ['a foreign origin', 'https://evil.example/repos/codebend3r/maester/releases?page=2'],
    ['plain http', 'http://api.github.com/repos/codebend3r/maester/releases?page=2'],
    ['another port', 'https://api.github.com:8443/repos/codebend3r/maester/releases?page=2'],
    ["another repository's releases", 'https://api.github.com/repos/someone/else/releases?page=2'],
    ['another repository id', 'https://api.github.com/repositories/1/releases?page=2'],
    ['another list', 'https://api.github.com/repos/codebend3r/maester/issues?page=2'],
    ['a longer path', 'https://api.github.com/repos/codebend3r/maester/releases/1?page=2'],
    ['credentials', 'https://user:secret@api.github.com/repos/codebend3r/maester/releases'],
    ['no URL at all', 'not a url'],
  ])('never follows %s', (_, next) => {
    expect(nextPageUrl({ link: linkTo(next), start: RELEASES_URL })).toBeNull()
  })

  it('is null without a next relation or a header', () => {
    expect(
      nextPageUrl({
        link: '<https://api.github.com/repositories/1388607730/releases?page=1>; rel="prev"',
        start: RELEASES_URL,
      }),
    ).toBeNull()
    expect(nextPageUrl({ link: null, start: RELEASES_URL })).toBeNull()
    expect(nextPageUrl({ link: '', start: RELEASES_URL })).toBeNull()
  })

  it("follows the test hook's own list, and only that", () => {
    const start = 'http://127.0.0.1:4000/releases'
    expect(nextPageUrl({ link: linkTo(`${start}?page=2`), start })).toBe(`${start}?page=2`)
    expect(nextPageUrl({ link: linkTo('http://127.0.0.1:4000/other?page=2'), start })).toBeNull()
    expect(nextPageUrl({ link: linkTo('http://127.0.0.1:4001/releases?page=2'), start })).toBeNull()
  })
})

type Call = Parameters<UpdateFetch>[0]

type Reply = { status: number; text: string; link?: string }

/** GitHub as a map of URLs to replies; any other URL is a 404. */
const serving = (pages: Record<string, Reply>) => {
  const calls: Call[] = []
  const fetch: UpdateFetch = async (call) => {
    calls.push(call)
    const { url } = call
    const { status, text, link = null } = pages[url] ?? { status: 404, text: '' }
    return {
      status,
      headers: { get: (name: string) => (name.toLowerCase() === HTTP_HEADERS.link ? link : null) },
      text: async () => text,
    }
  }
  return { fetch, calls }
}

const replying = (reply: Reply) => serving({ [RELEASES_URL]: reply })

type CheckProps = { fetch: UpdateFetch; current?: string }

const check = ({ fetch, current = '0.5.4' }: CheckProps) =>
  checkForUpdates({ fetch, url: RELEASES_URL, current, target: MAC })

const pageUrl = (page: number) =>
  `https://api.github.com/repositories/1388607730/releases?per_page=100&page=${page}`

const nextLink = (page: number) => `<${pageUrl(page)}>; rel="next"`

describe('checkForUpdates', () => {
  const NEWER = JSON.stringify([release({ tag: 'v0.6.0' })])

  it('asks for GitHub JSON as Raven, with a deadline', async () => {
    const { fetch, calls } = replying({ status: 200, text: NEWER })
    await check({ fetch })
    expect(calls.length).toBe(1)
    const { url, init } = calls[0]
    expect(url).toBe(RELEASES_URL)
    expect(init.headers).toEqual({
      accept: 'application/vnd.github+json',
      'user-agent': 'raven-player/0.5.4',
    })
    expect(init.signal).toBeInstanceOf(AbortSignal)
    expect(init.signal.aborted).toBe(false)
  })

  it('is ok with a newer release', async () => {
    const { fetch } = replying({ status: 200, text: NEWER })
    expect(await check({ fetch })).toEqual(newer('0.6.0'))
  })

  it('is ok and current when nothing is newer', async () => {
    const { fetch } = replying({ status: 200, text: JSON.stringify([release({ tag: 'v0.5.4' })]) })
    expect(await check({ fetch })).toEqual(CURRENT)
  })

  it('says GitHub listed no release when nothing it read carries the app', async () => {
    const { fetch } = replying({
      status: 200,
      text: JSON.stringify(builds({ version: '0.5.4', count: 16 })),
    })
    expect(await check({ fetch })).toEqual(UNLISTED)
  })

  describe('across pages', () => {
    it('finds the full release on page 2 behind 30 or more build releases', async () => {
      const { fetch, calls } = serving({
        [RELEASES_URL]: {
          status: 200,
          text: JSON.stringify(builds({ version: '0.6.0', count: 100 })),
          link: nextLink(2),
        },
        [pageUrl(2)]: {
          status: 200,
          text: JSON.stringify([release({ tag: 'v0.6.0' }), release({ tag: 'v0.5.4' })]),
        },
      })
      expect(await check({ fetch })).toEqual(newer('0.6.0'))
      expect(calls.map(({ url }) => url)).toEqual([RELEASES_URL, pageUrl(2)])
    })

    it('is current only once a later page shows the running release', async () => {
      const { fetch, calls } = serving({
        [RELEASES_URL]: {
          status: 200,
          text: JSON.stringify(builds({ version: '0.5.4', count: 35 })),
          link: nextLink(2),
        },
        [pageUrl(2)]: { status: 200, text: JSON.stringify([release({ tag: 'v0.5.4' })]) },
      })
      expect(await check({ fetch })).toEqual(CURRENT)
      expect(calls).toHaveLength(2)
    })

    it('finds v0.10.0 on a later page than the running v0.9 release', async () => {
      const { fetch } = serving({
        [RELEASES_URL]: {
          status: 200,
          text: JSON.stringify([
            ...builds({ version: '0.9.3', count: 40 }),
            release({ tag: 'v0.9.3' }),
          ]),
          link: nextLink(2),
        },
        [pageUrl(2)]: {
          status: 200,
          text: JSON.stringify([release({ tag: 'v0.2.0' }), release({ tag: 'v0.10.0' })]),
        },
      })
      expect(await check({ fetch, current: '0.9.3' })).toEqual(newer('0.10.0'))
    })

    it('stops once it has seen a newer release', async () => {
      const { fetch, calls } = serving({
        [RELEASES_URL]: { status: 200, text: NEWER, link: nextLink(2) },
      })
      expect(await check({ fetch })).toEqual(newer('0.6.0'))
      expect(calls).toHaveLength(1)
    })

    it('never follows a next link to another origin', async () => {
      const foreign = 'https://evil.example/repos/codebend3r/maester/releases?page=2'
      const { fetch, calls } = serving({
        [RELEASES_URL]: {
          status: 200,
          text: JSON.stringify(builds({ version: '0.5.4', count: 30 })),
          link: `<${foreign}>; rel="next"`,
        },
        [foreign]: { status: 200, text: NEWER },
      })
      expect(await check({ fetch })).toEqual(UNLISTED)
      expect(calls.map(({ url }) => url)).toEqual([RELEASES_URL])
    })

    it(`reads at most ${MAX_RELEASE_PAGES} pages`, async () => {
      const BUILDS = JSON.stringify(builds({ version: '0.5.4', count: 30 }))
      const pages = Object.fromEntries(
        Array.from({ length: 8 }, (_, index) => [
          index === 0 ? RELEASES_URL : pageUrl(index + 1),
          { status: 200, text: BUILDS, link: nextLink(index + 2) },
        ]),
      )
      const { fetch, calls } = serving(pages)
      expect(await check({ fetch })).toEqual(UNLISTED)
      expect(calls).toHaveLength(MAX_RELEASE_PAGES)
    })

    it('sends every page the same headers and deadline', async () => {
      const { fetch, calls } = serving({
        [RELEASES_URL]: { status: 200, text: '[]', link: nextLink(2) },
        [pageUrl(2)]: { status: 200, text: NEWER },
      })
      await check({ fetch })
      const [first, second] = calls.map(({ init }) => init)
      expect(second).toEqual(first)
    })

    it('is unreadable when the pages together pass the largest size', async () => {
      const half = Math.ceil(MAX_RELEASES_CHARS / 2) + 1
      const padded = `[]${' '.repeat(half - 2)}`
      const { fetch, calls } = serving({
        [RELEASES_URL]: { status: 200, text: padded, link: nextLink(2) },
        [pageUrl(2)]: { status: 200, text: padded },
      })
      expect(await check({ fetch })).toEqual(UNREADABLE)
      expect(calls).toHaveLength(2)
    })

    it('reads pages of exactly the largest size together', async () => {
      const first = `[]${' '.repeat(MAX_RELEASES_CHARS - NEWER.length - 2)}`
      const { fetch } = serving({
        [RELEASES_URL]: { status: 200, text: first, link: nextLink(2) },
        [pageUrl(2)]: { status: 200, text: NEWER },
      })
      expect(first.length + NEWER.length).toBe(MAX_RELEASES_CHARS)
      expect(await check({ fetch })).toEqual(newer('0.6.0'))
    })

    it('says what went wrong with a later page, whatever the first held', async () => {
      const first = { status: 200, text: '[]', link: nextLink(2) }
      expect(
        await check({
          fetch: serving({ [RELEASES_URL]: first, [pageUrl(2)]: { status: 403, text: '' } }).fetch,
        }),
      ).toEqual({ ok: false, problem: UPDATE_PROBLEMS.busy })
      expect(
        await check({
          fetch: serving({ [RELEASES_URL]: first, [pageUrl(2)]: { status: 200, text: '{}' } })
            .fetch,
        }),
      ).toEqual(UNREADABLE)
    })
  })

  it('is unreachable when the request rejects', async () => {
    const fetch: UpdateFetch = async () => {
      throw new Error('getaddrinfo ENOTFOUND api.github.com')
    }
    expect(await check({ fetch })).toEqual({ ok: false, problem: UPDATE_PROBLEMS.unreachable })
  })

  it('is unreachable when reading the body rejects', async () => {
    const fetch: UpdateFetch = async () => ({
      status: 200,
      headers: { get: () => null },
      text: async () => {
        throw new Error('aborted')
      },
    })
    expect(await check({ fetch })).toEqual({ ok: false, problem: UPDATE_PROBLEMS.unreachable })
  })

  it('reads no next link from headers that throw', async () => {
    const fetch: UpdateFetch = async () => ({
      status: 200,
      headers: {
        get: () => {
          throw new Error('no headers')
        },
      },
      text: async () => NEWER,
    })
    expect(await check({ fetch })).toEqual(newer('0.6.0'))
  })

  it.each([403, 429])('is busy on %p', async (status) => {
    const { fetch } = replying({ status, text: '{"message":"API rate limit exceeded"}' })
    expect(await check({ fetch })).toEqual({ ok: false, problem: UPDATE_PROBLEMS.busy })
  })

  it.each([
    ['a 500', { status: 500, text: NEWER }],
    ['a 304', { status: 304, text: NEWER }],
    ['HTML', { status: 200, text: '<html>' }],
    [
      '3 MB of JSON',
      {
        status: 200,
        text: JSON.stringify([{ ...release({ tag: 'v0.6.0' }), body: 'x'.repeat(3_000_000) }]),
      },
    ],
    ['an object instead of a list', { status: 200, text: '{"message":"x"}' }],
  ])('is unreadable on %s', async (_, reply) => {
    const { fetch } = replying(reply)
    expect(await check({ fetch })).toEqual(UNREADABLE)
  })

  it('reads a reply of exactly the largest size', async () => {
    const list = JSON.stringify([release({ tag: 'v0.6.0' })])
    const padded = `${list}${' '.repeat(MAX_RELEASES_CHARS - list.length)}`
    const { fetch } = replying({ status: 200, text: padded })
    expect(padded.length).toBe(MAX_RELEASES_CHARS)
    expect((await check({ fetch })).ok).toBe(true)
  })

  it('words every problem for a person, with no dashes', () => {
    expect(UPDATE_PROBLEMS).toEqual({
      unreachable: 'GitHub did not answer.',
      busy: 'GitHub is busy. Try again later.',
      unreadable: 'GitHub sent something Raven could not read.',
      unlisted: 'GitHub listed no Raven release.',
    })
  })
})

describe('isCheckDue', () => {
  it('is never due while the check is off', () => {
    expect(isCheckDue({ isEnabled: false, checkedAt: null, now: NOW })).toBe(false)
    expect(isCheckDue({ isEnabled: false, checkedAt: NOW - 48 * HOUR_MS, now: NOW })).toBe(false)
  })

  it('is due when the last check time is not a number it can compare', () => {
    expect(isCheckDue({ isEnabled: true, checkedAt: Number.NaN, now: NOW })).toBe(true)
    expect(isCheckDue({ isEnabled: true, checkedAt: Number.POSITIVE_INFINITY, now: NOW })).toBe(
      true,
    )
    expect(isCheckDue({ isEnabled: false, checkedAt: Number.NaN, now: NOW })).toBe(false)
  })

  it('is due when it never ran', () => {
    expect(isCheckDue({ isEnabled: true, checkedAt: null, now: NOW })).toBe(true)
  })

  it('is not due 23 hours after the last check', () => {
    expect(isCheckDue({ isEnabled: true, checkedAt: NOW - 23 * HOUR_MS, now: NOW })).toBe(false)
  })

  it('is due 24 hours after the last check', () => {
    expect(isCheckDue({ isEnabled: true, checkedAt: NOW - 24 * HOUR_MS, now: NOW })).toBe(true)
  })

  it('is due when the last check is in the future, after the clock moved back', () => {
    expect(isCheckDue({ isEnabled: true, checkedAt: NOW + HOUR_MS, now: NOW })).toBe(true)
  })
})
