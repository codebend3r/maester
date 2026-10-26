import { afterEach, describe, expect, it, vi } from 'vitest'
import { readServerConfig } from '@/config'
import { MatchFactsCache } from '@/metadata/matchFactsCache'
import { type MetadataFetch, TmdbClient } from '@/metadata/tmdbClient'
import { fakeTmdb } from '@/test/fakeTmdb'

const DAY_MS = 24 * 60 * 60 * 1000
const DEADLINE_MS = 2500

const detailsCalls = (calls: readonly string[]): number =>
  calls.filter((url) => /^\/3\/movie\/\d+$/.test(new URL(url).pathname)).length

describe('MatchFactsCache', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  type SetUpProps = {
    /** A path whose calls wait until `until` settles. */
    held?: { path: string; until: Promise<void> }
  }

  const setUp = ({ held }: SetUpProps = {}) => {
    const tmdb = fakeTmdb({
      movies: [
        { id: 949, title: 'Heat', released: '1995-12-15', runtime: 170 },
        { id: 8195, title: 'Ronin', released: '1998-09-25', runtime: 122 },
      ],
    })
    const fetch: MetadataFetch = async ({ url, init }) => {
      if (held != null && new URL(url).pathname === held.path) await held.until
      return tmdb.fetch({ url, init })
    }
    const client = new TmdbClient({ ...readServerConfig({}), tmdbApiToken: 'secret-token' }, fetch)
    return { tmdb, client, cache: new MatchFactsCache(client) }
  }

  it('reads each result once, and from memory after', async () => {
    const { tmdb, cache } = setUp()
    const first = await cache.read({
      type: 'movie',
      tmdbIds: ['949', '8195'],
      deadlineMs: DEADLINE_MS,
    })
    expect([...first.keys()]).toEqual(['949', '8195'])
    expect(first.get('949')).toMatchObject({ type: 'movie', runtime: 170 })
    await cache.read({ type: 'movie', tmdbIds: ['949', '8195'], deadlineMs: DEADLINE_MS })
    expect(detailsCalls(tmdb.state.calls)).toBe(2)
  })

  it('leaves out a result whose details fail, and asks again next time', async () => {
    const { tmdb, cache } = setUp()
    tmdb.state.failing.push('/movie/949')
    const read = await cache.read({
      type: 'movie',
      tmdbIds: ['949', '8195'],
      deadlineMs: DEADLINE_MS,
    })
    expect([...read.keys()]).toEqual(['8195'])
    tmdb.state.failing.splice(0)
    expect([
      ...(await cache.read({ type: 'movie', tmdbIds: ['949'], deadlineMs: DEADLINE_MS })).keys(),
    ]).toEqual(['949'])
  })

  it("lets an error that is not TMDB's through", async () => {
    const { client, cache } = setUp()
    vi.spyOn(client, 'matchFacts').mockRejectedValue(new RangeError('a bug'))
    await expect(
      cache.read({ type: 'movie', tmdbIds: ['949'], deadlineMs: DEADLINE_MS }),
    ).rejects.toThrow('a bug')
  })

  it('answers with what arrives by the deadline, and keeps what lands after it', async () => {
    vi.useFakeTimers()
    const gate = { open: () => {} }
    const until = new Promise<void>((resolve) => {
      gate.open = resolve
    })
    const { tmdb, client, cache } = setUp({ held: { path: '/3/movie/8195', until } })
    const matchFacts = vi.spyOn(client, 'matchFacts')
    const reading = cache.read({ type: 'movie', tmdbIds: ['949', '8195'], deadlineMs: DEADLINE_MS })
    await vi.advanceTimersByTimeAsync(DEADLINE_MS)
    expect([...(await reading).keys()]).toEqual(['949'])
    gate.open()
    const late = matchFacts.mock.calls.findIndex(([asked]) => asked.tmdbId === '8195')
    await matchFacts.mock.results[late]?.value
    const again = await cache.read({ type: 'movie', tmdbIds: ['8195'], deadlineMs: DEADLINE_MS })
    expect(again.get('8195')).toMatchObject({ type: 'movie', runtime: 122 })
    expect(detailsCalls(tmdb.state.calls)).toBe(2)
  })

  it('keeps a movie and a show with the same id apart', async () => {
    const { tmdb, cache } = setUp()
    expect(
      (await cache.read({ type: 'movie', tmdbIds: ['949'], deadlineMs: DEADLINE_MS })).size,
    ).toBe(1)
    const read = await cache.read({ type: 'show', tmdbIds: ['949'], deadlineMs: DEADLINE_MS })
    expect(read.size).toBe(0)
    expect(tmdb.state.calls.some((url) => new URL(url).pathname === '/3/tv/949')).toBe(true)
  })

  it('reads again once a day has passed, and not before', async () => {
    vi.useFakeTimers()
    const { tmdb, cache } = setUp()
    await cache.read({ type: 'movie', tmdbIds: ['949'], deadlineMs: DEADLINE_MS })
    vi.advanceTimersByTime(DAY_MS - 1)
    await cache.read({ type: 'movie', tmdbIds: ['949'], deadlineMs: DEADLINE_MS })
    expect(detailsCalls(tmdb.state.calls)).toBe(1)
    vi.advanceTimersByTime(2)
    await cache.read({ type: 'movie', tmdbIds: ['949'], deadlineMs: DEADLINE_MS })
    expect(detailsCalls(tmdb.state.calls)).toBe(2)
  })

  it('keeps at most 500, the oldest going first', async () => {
    const { client, cache } = setUp()
    // Past TMDB's rate limit, 501 reads would take 25 seconds; the cache is what is under test.
    const matchFacts = vi
      .spyOn(client, 'matchFacts')
      .mockImplementation(async () => ({ type: 'movie', aliases: [], runtime: null }))
    const tmdbIds = Array.from({ length: 501 }, (_, index) => String(10000 + index))
    await tmdbIds.reduce(async (done, tmdbId) => {
      await done
      await cache.read({ type: 'movie', tmdbIds: [tmdbId], deadlineMs: DEADLINE_MS })
    }, Promise.resolve())
    expect(matchFacts).toHaveBeenCalledTimes(501)
    await cache.read({ type: 'movie', tmdbIds: [tmdbIds[500] ?? ''], deadlineMs: DEADLINE_MS })
    expect(matchFacts).toHaveBeenCalledTimes(501)
    await cache.read({ type: 'movie', tmdbIds: [tmdbIds[0] ?? ''], deadlineMs: DEADLINE_MS })
    expect(matchFacts).toHaveBeenCalledTimes(502)
  })
})
