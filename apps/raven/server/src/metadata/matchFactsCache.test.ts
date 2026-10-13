import { afterEach, describe, expect, it, vi } from 'vitest'
import { readServerConfig } from '@/config'
import { MatchFactsCache } from '@/metadata/matchFactsCache'
import { TmdbClient } from '@/metadata/tmdbClient'
import { fakeTmdb } from '@/test/fakeTmdb'

const DAY_MS = 24 * 60 * 60 * 1000

const detailsCalls = (calls: readonly string[]): number =>
  calls.filter((url) => /^\/3\/movie\/\d+$/.test(new URL(url).pathname)).length

describe('MatchFactsCache', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  const setUp = ({ movies = [] }: { movies?: Parameters<typeof fakeTmdb>[0]['movies'] } = {}) => {
    const tmdb = fakeTmdb({
      movies: [
        { id: 949, title: 'Heat', released: '1995-12-15', runtime: 170 },
        { id: 8195, title: 'Ronin', released: '1998-09-25', runtime: 122 },
        ...movies,
      ],
    })
    const client = new TmdbClient(
      { ...readServerConfig({}), tmdbApiToken: 'secret-token' },
      tmdb.fetch,
    )
    return { tmdb, cache: new MatchFactsCache(client) }
  }

  it('reads each result once, and from memory after', async () => {
    const { tmdb, cache } = setUp()
    const first = await cache.read({ type: 'movie', tmdbIds: ['949', '8195'] })
    expect([...first.keys()]).toEqual(['949', '8195'])
    expect(first.get('949')).toMatchObject({ type: 'movie', runtime: 170 })
    await cache.read({ type: 'movie', tmdbIds: ['949', '8195'] })
    expect(detailsCalls(tmdb.state.calls)).toBe(2)
  })

  it('leaves out a result whose details fail, and asks again next time', async () => {
    const { tmdb, cache } = setUp()
    tmdb.state.failing.push('/movie/949')
    const read = await cache.read({ type: 'movie', tmdbIds: ['949', '8195'] })
    expect([...read.keys()]).toEqual(['8195'])
    tmdb.state.failing.splice(0)
    expect([...(await cache.read({ type: 'movie', tmdbIds: ['949'] })).keys()]).toEqual(['949'])
  })

  it('keeps a movie and a show with the same id apart', async () => {
    const { tmdb, cache } = setUp()
    expect((await cache.read({ type: 'movie', tmdbIds: ['949'] })).size).toBe(1)
    const read = await cache.read({ type: 'show', tmdbIds: ['949'] })
    expect(read.size).toBe(0)
    expect(tmdb.state.calls.some((url) => new URL(url).pathname === '/3/tv/949')).toBe(true)
  })

  it('reads again once a day has passed, and not before', async () => {
    vi.useFakeTimers()
    const { tmdb, cache } = setUp()
    await cache.read({ type: 'movie', tmdbIds: ['949'] })
    vi.advanceTimersByTime(DAY_MS - 1)
    await cache.read({ type: 'movie', tmdbIds: ['949'] })
    expect(detailsCalls(tmdb.state.calls)).toBe(1)
    vi.advanceTimersByTime(2)
    await cache.read({ type: 'movie', tmdbIds: ['949'] })
    expect(detailsCalls(tmdb.state.calls)).toBe(2)
  })

  it('keeps at most 500, the oldest going first', async () => {
    const movies = Array.from({ length: 499 }, (_, index) => ({
      id: 10000 + index,
      title: `Film ${index}`,
      released: '2000-01-01',
    }))
    const { tmdb, cache } = setUp({ movies })
    const tmdbIds = ['949', '8195', ...movies.map((movie) => String(movie.id))]
    await tmdbIds.reduce(async (done, tmdbId) => {
      await done
      await cache.read({ type: 'movie', tmdbIds: [tmdbId] })
    }, Promise.resolve())
    expect(detailsCalls(tmdb.state.calls)).toBe(501)
    await cache.read({ type: 'movie', tmdbIds: [tmdbIds[500] ?? ''] })
    expect(detailsCalls(tmdb.state.calls)).toBe(501)
    await cache.read({ type: 'movie', tmdbIds: ['949'] })
    expect(detailsCalls(tmdb.state.calls)).toBe(502)
  })
})
