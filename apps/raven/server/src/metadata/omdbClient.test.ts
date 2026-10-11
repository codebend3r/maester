import { describe, expect, it } from 'vitest'
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
      { source: 'imdb', value: 7.5 },
      { source: 'rottenTomatoes', value: 8.5 },
      { source: 'metacritic', value: 7.4 },
    ])
    expect(parseOmdbRatings({})).toEqual([])
  })
})

describe('OmdbClient', () => {
  it('is off without a key', () => {
    const client = new OmdbClient(config({ key: null }), fakeTmdb({ movies: [] }).fetch)
    expect(client.enabled).toBe(false)
    expect(client.state()).toEqual({ state: 'off', error: null, used: 0 })
  })

  it('answers with scores and counts the call', async () => {
    const tmdb = fakeTmdb({ movies: [], omdb: { tt1: { imdb: '8.0/10' } } })
    const client = new OmdbClient(config(), tmdb.fetch)
    await expect(client.ratings('tt1')).resolves.toEqual([{ source: 'imdb', value: 8 }])
    await expect(client.ratings('tt2')).resolves.toEqual([])
    expect(client.state()).toEqual({ state: 'ok', error: null, used: 2 })
    expect(client.remaining()).toBe(998)
  })

  it('stops at the daily limit', async () => {
    const tmdb = fakeTmdb({ movies: [], omdb: {} })
    const client = new OmdbClient(config({ limit: 1 }), tmdb.fetch)
    await client.ratings('tt1')
    expect(client.enabled).toBe(false)
    await expect(client.ratings('tt2')).rejects.toThrow('not available')
    expect(tmdb.state.omdbCalls).toBe(1)
  })

  it('stops after a refused key', async () => {
    const tmdb = fakeTmdb({ movies: [], omdb: {} })
    const client = new OmdbClient(config({ key: 'wrong' }), tmdb.fetch)
    await expect(client.ratings('tt1')).rejects.toThrow('refused')
    expect(client.enabled).toBe(false)
    expect(client.state().state).toBe('failing')
    expect(client.state().error).not.toContain('wrong')
  })
})
