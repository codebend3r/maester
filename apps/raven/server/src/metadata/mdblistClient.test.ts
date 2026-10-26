import { afterEach, describe, expect, it, vi } from 'vitest'
import { readServerConfig } from '@/config'
import { MdblistClient, parseMdblistRatings } from '@/metadata/mdblistClient'
import type { MetadataFetch } from '@/metadata/tmdbClient'
import { fakeTmdb } from '@/test/fakeTmdb'

type ConfigProps = { key?: string | null; limit?: number }

const config = ({ key = 'mdblist-key', limit = 1000 }: ConfigProps = {}) => ({
  ...readServerConfig({}),
  mdblistApiKey: key,
  mdblistDailyLimit: limit,
})

const show = { type: 'show', tmdbId: '100', imdbId: null } as const

describe('parseMdblistRatings', () => {
  it('brings IMDb, Rotten Tomatoes and Metacritic to a mark out of 10 and keeps votes', () => {
    expect(
      parseMdblistRatings({
        ratings: [
          { source: 'imdb', value: 8.3, score: 83, votes: 12_345 },
          { source: 'tomatoes', value: 91, score: 91, votes: null },
          { source: 'metacritic', value: 74, score: 74 },
          { source: 'letterboxd', value: 4.1, score: 82, votes: 9 },
        ],
      }),
    ).toEqual([
      { source: 'imdb', value: 8.3, votes: 12_345 },
      { source: 'rottenTomatoes', value: 9.1, votes: null },
      { source: 'metacritic', value: 7.4, votes: null },
    ])
  })

  it('drops a null score and a malformed item', () => {
    expect(
      parseMdblistRatings({
        ratings: [
          { source: 'imdb', value: null, score: null, votes: 5 },
          { source: 'tomatoes', score: '91' },
          { score: 80 },
          'metacritic',
          null,
          { source: 'metacritic', score: 60, votes: '3' },
        ],
      }),
    ).toEqual([{ source: 'metacritic', value: 6, votes: null }])
  })

  it('drops a score outside 0 to 100', () => {
    expect(
      parseMdblistRatings({
        ratings: [
          { source: 'imdb', score: 101 },
          { source: 'tomatoes', score: -1 },
          { source: 'metacritic', score: 100 },
          { source: 'imdb', score: 0 },
        ],
      }),
    ).toEqual([
      { source: 'metacritic', value: 10, votes: null },
      { source: 'imdb', value: 0, votes: null },
    ])
  })

  it('does not take a source name from the object prototype', () => {
    expect(
      parseMdblistRatings({
        ratings: [
          { source: 'constructor', score: 50 },
          { source: 'toString', score: 50 },
          { source: '__proto__', score: 50 },
        ],
      }),
    ).toEqual([])
  })

  it('reads nothing from an answer without ratings', () => {
    expect(parseMdblistRatings({})).toEqual([])
    expect(parseMdblistRatings({ ratings: 'none' })).toEqual([])
    expect(parseMdblistRatings(null)).toEqual([])
  })
})

describe('MdblistClient', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('is off without a key', () => {
    const client = new MdblistClient(config({ key: null }), fakeTmdb({ movies: [] }).fetch)
    expect(client.enabled()).toBe(false)
    expect(client.state()).toBe('off')
  })

  it('answers with scores for a show by its TMDB id', async () => {
    const tmdb = fakeTmdb({
      movies: [],
      mdblist: { 'show:100': { imdb: 83, rottenTomatoes: 91, metacritic: 74, imdbVotes: 500 } },
    })
    const client = new MdblistClient(config(), tmdb.fetch)
    await expect(client.lookUp(show)).resolves.toEqual([
      { source: 'imdb', value: 8.3, votes: 500 },
      { source: 'rottenTomatoes', value: 9.1, votes: null },
      { source: 'metacritic', value: 7.4, votes: null },
    ])
    expect(tmdb.state.calls).toEqual(['https://api.mdblist.com/tmdb/show/100/?apikey=mdblist-key'])
    expect(client.state()).toBe('ok')
  })

  it('asks for a movie by its own path', async () => {
    const tmdb = fakeTmdb({ movies: [], mdblist: { 'movie:603': { metacritic: 73 } } })
    const client = new MdblistClient(config(), tmdb.fetch)
    await expect(
      client.lookUp({ type: 'movie', tmdbId: '603', imdbId: 'tt0133093' }),
    ).resolves.toEqual([{ source: 'metacritic', value: 7.3, votes: null }])
  })

  it('answers unknown for a title it has nothing on, a 404', async () => {
    const tmdb = fakeTmdb({ movies: [] })
    const client = new MdblistClient(config(), tmdb.fetch)
    await expect(client.lookUp(show)).resolves.toBe('unknown')
    expect(client.state()).toBe('ok')
  })

  it('fails on an answer without ratings, rather than take it for an unknown title', async () => {
    const bare: MetadataFetch = async () => new Response(JSON.stringify({ id: 100 }))
    const client = new MdblistClient(config(), bare)
    await expect(client.lookUp(show)).rejects.toThrow('MDBList answered without ratings.')
    expect(client.state()).toBe('failing')

    const notJson: MetadataFetch = async () => new Response('<html>Moved</html>')
    await expect(new MdblistClient(config(), notJson).lookUp(show)).rejects.toThrow(
      'without ratings',
    )
    const erring: MetadataFetch = async () =>
      new Response(JSON.stringify({ error: 'Something went wrong' }))
    await expect(new MdblistClient(config(), erring).lookUp(show)).rejects.toThrow(
      'without ratings',
    )
  })

  it("keeps to MDBList's own count of calls left, down to a spent day, until midnight UTC", async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-11T20:00:00Z'))
    const lefts = ['2', null, null]
    const fetch: MetadataFetch = async () => {
      const left = lefts.shift() ?? null
      return new Response(JSON.stringify({ ratings: [{ source: 'imdb', score: 70 }] }), {
        headers: left == null ? {} : { 'x-ratelimit-remaining': left },
      })
    }
    const client = new MdblistClient(config(), fetch)
    expect(client.remaining()).toBe(1000)

    await client.lookUp(show)
    expect(client.remaining()).toBe(2)
    await client.lookUp(show)
    expect(client.remaining()).toBe(1)
    await client.lookUp(show)
    expect(client.remaining()).toBe(0)
    expect(client.enabled()).toBe(false)
    await expect(client.lookUp(show)).rejects.toThrow('not available')
    expect(client.state()).toBe('ok')

    vi.setSystemTime(new Date('2026-10-12T00:00:01Z'))
    expect(client.remaining()).toBe(1000)
    expect(client.enabled()).toBe(true)
  })

  it('takes a reported zero left as a spent day', async () => {
    const fetch: MetadataFetch = async () =>
      new Response(JSON.stringify({ ratings: [{ source: 'imdb', score: 70 }] }), {
        headers: { 'x-ratelimit-remaining': '0' },
      })
    const client = new MdblistClient(config(), fetch)
    await expect(client.lookUp(show)).resolves.toEqual([{ source: 'imdb', value: 7, votes: null }])
    expect(client.remaining()).toBe(0)
    expect(client.enabled()).toBe(false)
  })

  it('takes a 429 that waits past the 5-minute window, or counts none left, as a spent day', async () => {
    const spentBy = async (headers: Record<string, string>) => {
      const calls: string[] = []
      const fetch: MetadataFetch = async ({ url }) => {
        calls.push(url)
        return new Response(JSON.stringify({ error: 'Too many requests' }), {
          status: 429,
          headers,
        })
      }
      const client = new MdblistClient(config(), fetch)
      await expect(client.lookUp(show)).rejects.toThrow('daily limit')
      return { remaining: client.remaining(), calls: calls.length }
    }
    await expect(spentBy({ 'retry-after': '301' })).resolves.toEqual({ remaining: 0, calls: 1 })
    await expect(spentBy({ 'retry-after': '0', 'x-ratelimit-remaining': '0' })).resolves.toEqual({
      remaining: 0,
      calls: 1,
    })
  })

  it('counts down the budget and stops at the limit', async () => {
    const tmdb = fakeTmdb({ movies: [], mdblist: { 'show:100': { imdb: 80 } } })
    const client = new MdblistClient(config({ limit: 2 }), tmdb.fetch)
    expect(client.remaining()).toBe(2)
    await client.lookUp(show)
    expect(client.remaining()).toBe(1)
    await client.lookUp(show)
    expect(client.remaining()).toBe(0)
    expect(client.enabled()).toBe(false)
    await expect(client.lookUp(show)).rejects.toThrow('not available')
    expect(tmdb.state.mdblistCalls).toBe(2)
  })

  it('stops after a refused key', async () => {
    const tmdb = fakeTmdb({ movies: [] })
    const client = new MdblistClient(config({ key: 'wrong' }), tmdb.fetch)
    await expect(client.lookUp(show)).rejects.toThrow('refused')
    expect(client.enabled()).toBe(false)
    expect(client.state()).toBe('failing')
    await expect(client.lookUp(show)).rejects.toThrow('not available')
    expect(tmdb.state.mdblistCalls).toBe(1)
  })

  it('keeps the key out of what it throws and reports', async () => {
    const key = 'mdb-secret-key-8f3a91'
    const tmdb = fakeTmdb({ movies: [] })
    const refused = new MdblistClient(config({ key }), tmdb.fetch)
    const refusal = await refused.lookUp(show).catch((error: unknown) => error)
    expect(refusal).toBeInstanceOf(Error)
    expect(String(refusal)).not.toContain(key)
    expect(refused.state()).toBe('failing')

    tmdb.state.down = true
    const unreachable = new MdblistClient(config({ key }), tmdb.fetch)
    const failure = await unreachable.lookUp(show).catch((error: unknown) => error)
    expect(String(failure)).toContain('could not be reached')
    expect(String(failure)).not.toContain(key)
  })

  it('spends the day when MDBList says its limit is exceeded, until midnight UTC', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-11T20:00:00Z'))
    const tmdb = fakeTmdb({ movies: [], mdblist: { 'show:100': { imdb: 80 } } })
    tmdb.state.mdblistSpent = true
    const client = new MdblistClient(config(), tmdb.fetch)
    await expect(client.lookUp(show)).rejects.toThrow('daily limit')
    expect(client.enabled()).toBe(false)
    expect(client.remaining()).toBe(0)
    expect(client.state()).toBe('failing')
    expect(tmdb.state.mdblistCalls).toBe(1)

    tmdb.state.mdblistSpent = false
    vi.setSystemTime(new Date('2026-10-12T00:00:01Z'))
    expect(client.enabled()).toBe(true)
    await expect(client.lookUp(show)).resolves.toEqual([{ source: 'imdb', value: 8, votes: null }])
    expect(client.remaining()).toBe(999)
    expect(client.state()).toBe('ok')
  })

  it('waits a second for a 429 that names no Retry-After', async () => {
    vi.useFakeTimers()
    const answers = [
      new Response(JSON.stringify({ error: 'API rate limit exceeded!' }), { status: 429 }),
      new Response(JSON.stringify({ ratings: [{ source: 'imdb', score: 70 }] })),
    ]
    const calls: string[] = []
    const fetch: MetadataFetch = async ({ url }) => {
      calls.push(url)
      return answers.shift() ?? new Response(null, { status: 500 })
    }
    const result = new MdblistClient(config(), fetch).lookUp(show)
    await vi.advanceTimersByTimeAsync(999)
    expect(calls).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(500)
    await expect(result).resolves.toEqual([{ source: 'imdb', value: 7, votes: null }])
    expect(calls).toHaveLength(2)
  })

  it('waits out a burst 429 and asks again', async () => {
    const answers = [
      new Response(JSON.stringify({ error: 'API rate limit exceeded!' }), {
        status: 429,
        headers: { 'retry-after': '0' },
      }),
      new Response(JSON.stringify({ ratings: [{ source: 'imdb', score: 70 }] })),
    ]
    const calls: string[] = []
    const fetch: MetadataFetch = async ({ url }) => {
      calls.push(url)
      return answers.shift() ?? new Response(null, { status: 500 })
    }
    const client = new MdblistClient(config(), fetch)
    await expect(client.lookUp(show)).resolves.toEqual([{ source: 'imdb', value: 7, votes: null }])
    expect(calls).toHaveLength(2)
    expect(client.remaining()).toBe(999)
    expect(client.state()).toBe('ok')
  })
})
