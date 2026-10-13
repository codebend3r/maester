import { describe, expect, it } from 'vitest'
import { readServerConfig } from '@/config'
import { MatchFactsCache } from '@/metadata/matchFactsCache'
import { TmdbClient } from '@/metadata/tmdbClient'
import { fakeTmdb } from '@/test/fakeTmdb'

const detailsCalls = (calls: readonly string[]): number =>
  calls.filter((url) => /^\/3\/movie\/\d+$/.test(new URL(url).pathname)).length

describe('MatchFactsCache', () => {
  const setUp = () => {
    const tmdb = fakeTmdb({
      movies: [
        { id: 949, title: 'Heat', released: '1995-12-15', runtime: 170 },
        { id: 8195, title: 'Ronin', released: '1998-09-25', runtime: 122 },
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
    const { cache } = setUp()
    const read = await cache.read({ type: 'show', tmdbIds: ['949'] })
    expect(read.size).toBe(0)
  })
})
