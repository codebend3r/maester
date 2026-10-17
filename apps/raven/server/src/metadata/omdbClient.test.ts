import { afterEach, describe, expect, it, vi } from 'vitest'
import { readServerConfig } from '@/config'
import { OmdbClient, parseOmdbRatings } from '@/metadata/omdbClient'
import { fakeTmdb } from '@/test/fakeTmdb'

const config = ({
  key = 'omdb-key',
  limit = 1000,
}: { key?: string | null; limit?: number } = {}) => ({
  ...readServerConfig({}),
  omdbApiKey: key,
  omdbDailyLimit: limit,
})

describe('parseOmdbRatings', () => {
  it('brings each score to a mark out of 10', () => {
    expect(
      parseOmdbRatings({
        Ratings: [
          { Source: 'Internet Movie Database', Value: '7.5/10' },
          { Source: 'Rotten Tomatoes', Value: '85%' },
          { Source: 'Metacritic', Value: '74/100' },
          { Source: 'Letterboxd', Value: '4/5' },
        ],
      }),
    ).toEqual([
      { source: 'imdb', value: 7.5, votes: null },
      { source: 'rottenTomatoes', value: 8.5, votes: null },
      { source: 'metacritic', value: 7.4, votes: null },
    ])
    expect(parseOmdbRatings({})).toEqual([])
  })
})

describe('OmdbClient', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('is off without a key', () => {
    const client = new OmdbClient(config({ key: null }), fakeTmdb({ movies: [] }).fetch)
    expect(client.enabled()).toBe(false)
    expect(client.state()).toBe('off')
  })

  it('answers with scores and counts the call', async () => {
    const tmdb = fakeTmdb({ movies: [], omdb: { tt1: { imdb: '8.0/10' } } })
    const client = new OmdbClient(config(), tmdb.fetch)
    await expect(client.ratings('tt1')).resolves.toEqual([
      { source: 'imdb', value: 8, votes: null },
    ])
    await expect(client.ratings('tt2')).resolves.toEqual([])
    expect(client.state()).toBe('ok')
    expect(client.remaining()).toBe(998)
  })

  it('stops at the daily limit', async () => {
    const tmdb = fakeTmdb({ movies: [], omdb: {} })
    const client = new OmdbClient(config({ limit: 1 }), tmdb.fetch)
    await client.ratings('tt1')
    expect(client.enabled()).toBe(false)
    await expect(client.ratings('tt2')).rejects.toThrow('not available')
    expect(tmdb.state.omdbCalls).toBe(1)
  })

  it('stops after a refused key', async () => {
    const tmdb = fakeTmdb({ movies: [], omdb: {} })
    const client = new OmdbClient(config({ key: 'wrong' }), tmdb.fetch)
    await expect(client.ratings('tt1')).rejects.toThrow('refused')
    expect(client.enabled()).toBe(false)
    expect(client.state()).toBe('failing')
  })

  it('waits for midnight UTC when OMDb answers a spent day with a 401', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-11T20:00:00Z'))
    const tmdb = fakeTmdb({ movies: [], omdb: { tt1: { imdb: '8.0/10' } } })
    tmdb.state.omdbSpent = true
    const client = new OmdbClient(config(), tmdb.fetch)
    await expect(client.ratings('tt1')).rejects.toThrow('daily limit')
    expect(client.enabled()).toBe(false)
    expect(client.remaining()).toBe(0)

    tmdb.state.omdbSpent = false
    vi.setSystemTime(new Date('2026-10-12T00:00:01Z'))
    expect(client.enabled()).toBe(true)
    await expect(client.ratings('tt1')).resolves.toEqual([
      { source: 'imdb', value: 8, votes: null },
    ])
    expect(client.state()).toBe('ok')
    expect(client.remaining()).toBe(999)
  })

  it('looks a title up by its IMDb id, and knows nothing of one without', async () => {
    const tmdb = fakeTmdb({ movies: [], omdb: { tt1: { imdb: '8.0/10' } } })
    const client = new OmdbClient(config(), tmdb.fetch)
    expect(client.provider).toBe('omdb')
    await expect(client.lookUp({ type: 'movie', tmdbId: '1', imdbId: 'tt1' })).resolves.toEqual([
      { source: 'imdb', value: 8, votes: null },
    ])
    await expect(client.lookUp({ type: 'show', tmdbId: '2', imdbId: null })).resolves.toBe(
      'unknown',
    )
    expect(tmdb.state.omdbCalls).toBe(1)
  })
})
