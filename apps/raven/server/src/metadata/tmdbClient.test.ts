import { describe, expect, it } from 'vitest'
import { readServerConfig } from '@/config'
import { RAVEN_HEADERS } from '@/http'
import {
  type MetadataFetch,
  TmdbClient,
  TmdbError,
  mergeCredits,
  pickLogo,
  toSeason,
  toShow,
} from '@/metadata/tmdbClient'
import { fakeTmdb, movieBody, seasonBody, showBody } from '@/test/fakeTmdb'

const config = (token: string | null = 'secret-token') => ({
  ...readServerConfig({}),
  tmdbApiToken: token,
})

const respond =
  (answers: Array<() => Response | Promise<Response>>): MetadataFetch =>
  async () => {
    const next = answers.shift()
    if (!next) throw new Error('no more answers')
    return next()
  }

const json = ({
  body,
  status = 200,
  headers = {},
}: {
  body: unknown
  status?: number
  headers?: Record<string, string>
}) => new Response(JSON.stringify(body), { status, headers })

describe('TmdbClient', () => {
  it('reads a movie with its credits, rating, content rating and pictures', async () => {
    const tmdb = fakeTmdb({
      movies: [{ id: 603, title: 'The Matrix', released: '1999-03-31', imdbId: 'tt0133093' }],
    })
    const client = new TmdbClient(config(), tmdb.fetch)
    const movie = await client.movie('603')
    expect(movie).toMatchObject({
      type: 'movie',
      tmdbId: '603',
      title: 'The Matrix',
      year: 1999,
      released: '1999-03-31',
      contentRating: 'R',
      runtime: 120,
      studio: 'Studio One',
      genres: ['Action', 'Science Fiction'],
      imdbId: 'tt0133093',
      images: { poster: '/poster603.jpg', backdrop: '/backdrop603.jpg', still: null },
      rating: { value: 8.2, votes: 1000 },
    })
    expect(movie.credits.map((credit) => [credit.name, credit.job, credit.role])).toEqual([
      ['Keanu Reeves', 'cast', 'Neo'],
      ['Laurence Fishburne', 'cast', 'Morpheus'],
      ['Lilly Wachowski', 'director', 'Director'],
      ['Lana Wachowski', 'director', 'Director'],
      ['Lilly Wachowski', 'writer', 'Screenplay'],
    ])
  })

  it('reads the collection a movie belongs to as its saga, and none for one in no collection', async () => {
    const tmdb = fakeTmdb({
      movies: [
        {
          id: 120,
          title: 'The Fellowship of the Ring',
          released: '2001-12-18',
          saga: { id: 119, name: 'The Lord of the Rings Collection' },
        },
        { id: 949, title: 'Heat', released: '1995-12-15' },
      ],
    })
    const client = new TmdbClient(config(), tmdb.fetch)
    const saga = { tmdbId: '119', name: 'The Lord of the Rings Collection' }
    expect((await client.movie('120')).saga).toEqual(saga)
    expect((await client.movie('949')).saga).toBeNull()
    expect(await client.movieExtras('120')).toEqual({ saga, logo: '/logo120.png' })
    expect((await client.movieExtras('949')).saga).toBeNull()
    // The saga and logo alone ask for the movie with its pictures, and nothing else appended.
    const asked = new URL(tmdb.state.calls.at(-1) ?? '')
    expect(asked.pathname).toBe('/3/movie/949')
    expect(asked.searchParams.get('append_to_response')).toBe('images')
  })

  it("reads a movie's logo: a PNG in the language asked for, before one with none", async () => {
    const tmdb = fakeTmdb({ movies: [{ id: 603, title: 'The Matrix', released: '1999-03-31' }] })
    const client = new TmdbClient(config(), tmdb.fetch)
    expect((await client.movie('603')).images.logo).toBe('/logo603.png')
    expect((await client.movieExtras('603')).logo).toBe('/logo603.png')
    expect(tmdb.state.calls.at(-1)).toContain('include_image_language=en%2Cnull')
  })

  it('lists every PNG logo for Edit images, passing over an SVG, and none for a show', async () => {
    const tmdb = fakeTmdb({
      movies: [{ id: 603, title: 'The Matrix', released: '1999-03-31' }],
      shows: [{ id: 1399, title: 'Game of Thrones', first: '2011-04-17', seasons: {} }],
    })
    const client = new TmdbClient(config(), tmdb.fetch)
    const movie = await client.images({ type: 'movie', tmdbId: '603' })
    expect(movie.logo.map((logo) => [logo.path, logo.language])).toEqual([
      ['/logo603-fr.png', 'fr'],
      ['/logo603.png', 'en'],
      ['/logo603-plain.png', null],
    ])
    expect((await client.images({ type: 'show', tmdbId: '1399' })).logo).toEqual([])
  })

  it('takes a logo with no language when none is in the language, and never an SVG', () => {
    const logo = ({ path, language }: { path: string; language: string | null }) => ({
      file_path: path,
      iso_639_1: language,
    })
    expect(
      pickLogo({
        logos: [
          logo({ path: '/a.svg', language: 'en' }),
          logo({ path: '/b.png', language: 'fr' }),
          logo({ path: '/c.png', language: null }),
        ],
        language: 'en',
      }),
    ).toBe('/c.png')
    expect(
      pickLogo({ logos: [logo({ path: '/a.svg', language: 'en' })], language: 'en' }),
    ).toBeNull()
    expect(pickLogo({ logos: undefined, language: 'en' })).toBeNull()
  })

  it('sends the token as a bearer token and the language on every call', async () => {
    const seen: Array<{ url: string; authorization: string | undefined }> = []
    const client = new TmdbClient(config(), async ({ url, init }) => {
      seen.push({ url, authorization: init.headers.authorization })
      return json({ body: { results: [] } })
    })
    await client.searchMovies({ query: 'The Matrix', year: 1999 })
    expect(seen[0]?.authorization).toBe('Bearer secret-token')
    expect(seen[0]?.url).toContain('language=en-US')
    expect(seen[0]?.url).toContain('query=The+Matrix')
    expect(seen[0]?.url).toContain('year=1999')
  })

  it('sends a decomposed title composed, as TMDB finds nothing for the other form', async () => {
    const seen: string[] = []
    const client = new TmdbClient(config(), async ({ url }) => {
      seen.push(url)
      return json({ body: { results: [] } })
    })
    await client.searchShows({ query: 'Sho\u0304gun', year: 2024 })
    await client.searchMovies({ query: 'Ame\u0301lie', year: null })
    expect(seen[0]).toContain('query=Sh%C5%8Dgun')
    expect(seen[1]).toContain('query=Am%C3%A9lie')
  })

  it('sends a 32-character API key as api_key instead', async () => {
    const seen: Array<{ url: string; authorization: string | undefined }> = []
    const client = new TmdbClient(
      config('0123456789abcdef0123456789abcdef'),
      async ({ url, init }) => {
        seen.push({ url, authorization: init.headers.authorization })
        return json({ body: { results: [] } })
      },
    )
    await client.searchMovies({ query: 'Heat', year: null })
    expect(seen[0]?.authorization).toBeUndefined()
    expect(seen[0]?.url).toContain('api_key=0123456789abcdef0123456789abcdef')
  })

  it('drops image paths that are not plain TMDB files', async () => {
    const client = new TmdbClient(
      config(),
      respond([
        () =>
          json({
            body: {
              ...movieBody({ id: 1, title: 'X', released: '2000-01-01' }),
              poster_path: '/../../etc/passwd',
            },
          }),
      ]),
    )
    expect((await client.movie('1')).images.poster).toBeNull()
  })

  it('says a 404 is not found, and stays healthy', async () => {
    const client = new TmdbClient(config(), respond([() => json({ body: {}, status: 404 })]))
    await expect(client.movie('9')).rejects.toMatchObject({ kind: 'not-found' })
    expect(client.state().state).toBe('ok')
  })

  it('stops calling after a 401 until a restart', async () => {
    const calls = { count: 0 }
    const client = new TmdbClient(config(), async () => {
      calls.count += 1
      return json({ body: {}, status: 401 })
    })
    await expect(client.movie('1')).rejects.toMatchObject({ kind: 'unauthorized' })
    await expect(client.movie('2')).rejects.toBeInstanceOf(TmdbError)
    expect(calls.count).toBe(1)
    expect(client.enabled).toBe(false)
    expect(client.state()).toMatchObject({ state: 'failing' })
    expect(client.state().error).not.toContain('secret-token')
  })

  it('waits out a 429 and tries again', async () => {
    const client = new TmdbClient(
      config(),
      respond([
        () => json({ body: {}, status: 429, headers: { [RAVEN_HEADERS.retryAfter]: '0' } }),
        () => json({ body: { results: [] } }),
      ]),
    )
    await expect(client.searchMovies({ query: 'x', year: null })).resolves.toEqual([])
  })

  it('reports a server error and an unreachable TMDB as failing', async () => {
    const down = new TmdbClient(
      config(),
      respond([
        () => {
          throw new TypeError('fetch failed')
        },
      ]),
    )
    await expect(down.movie('1')).rejects.toMatchObject({ kind: 'unavailable' })
    expect(down.state()).toMatchObject({ state: 'failing', error: 'TMDB could not be reached.' })

    const slow = new TmdbClient(
      config(),
      respond([
        () => {
          throw new DOMException('The operation timed out.', 'TimeoutError')
        },
      ]),
    )
    await expect(slow.movie('1')).rejects.toMatchObject({ kind: 'unavailable' })
    expect(slow.state().error).toBe('TMDB did not answer within 10 seconds.')

    const broken = new TmdbClient(config(), respond([() => json({ body: {}, status: 503 })]))
    await expect(broken.movie('1')).rejects.toMatchObject({ kind: 'unavailable' })
  })

  it('is off without a token', () => {
    const client = new TmdbClient(config(null), respond([]))
    expect(client.enabled).toBe(false)
    expect(client.state()).toEqual({ state: 'off', error: null, lastOk: null })
  })

  it('finds a movie by its IMDb id', async () => {
    const tmdb = fakeTmdb({
      movies: [{ id: 603, title: 'The Matrix', released: '1999-03-31', imdbId: 'tt0133093' }],
    })
    const client = new TmdbClient(config(), tmdb.fetch)
    await expect(client.find({ id: 'tt0133093', source: 'imdb_id' })).resolves.toEqual({
      movies: ['603'],
      shows: [],
    })
  })

  it('keeps the genres and language a search gives, which a library type prefers by', async () => {
    const tmdb = fakeTmdb({
      movies: [
        { id: 4977, title: 'Paprika', released: '2006-11-25', genreIds: [16, 878], language: 'ja' },
      ],
      shows: [
        {
          id: 30991,
          title: 'Cowboy Bebop',
          first: '1998-04-03',
          genreIds: [16, 10759],
          language: 'ja',
          countries: ['JP'],
          seasons: {},
        },
      ],
    })
    const client = new TmdbClient(config(), tmdb.fetch)
    const [paprika] = await client.searchMovies({ query: 'Paprika', year: 2006 })
    expect(paprika).toMatchObject({ genreIds: [16, 878], originalLanguage: 'ja', countries: [] })
    const [bebop] = await client.searchShows({ query: 'Cowboy Bebop', year: null })
    expect(bebop).toMatchObject({
      genreIds: [16, 10759],
      originalLanguage: 'ja',
      countries: ['JP'],
    })
  })

  it("reads a show's seasons, episode total and aliases for Fix match, in one call", async () => {
    const tmdb = fakeTmdb({
      movies: [],
      shows: [
        {
          id: 30981,
          title: 'Monster',
          first: '2004-04-07',
          alternativeTitles: ['MONSTER'],
          seasons: {
            0: [{ number: 1, title: 'Special', aired: '2004-01-01' }],
            1: [
              { number: 1, title: 'Herr Dr. Tenma', aired: '2004-04-07' },
              { number: 2, title: 'Downfall', aired: '2004-04-14' },
            ],
          },
        },
      ],
    })
    const client = new TmdbClient(config(), tmdb.fetch)
    expect(await client.matchFacts({ type: 'show', tmdbId: '30981' })).toEqual({
      type: 'show',
      aliases: ['MONSTER'],
      seasons: [
        { number: 0, episodeCount: 1 },
        { number: 1, episodeCount: 2 },
      ],
      episodeCount: 2,
    })
    expect(tmdb.state.calls).toHaveLength(1)
    expect(new URL(tmdb.state.calls[0] ?? '').searchParams.get('append_to_response')).toBe(
      'alternative_titles',
    )
  })

  it("reads a movie's runtime and aliases for Fix match", async () => {
    const tmdb = fakeTmdb({
      movies: [
        {
          id: 949,
          title: 'Heat',
          released: '1995-12-15',
          runtime: 170,
          alternativeTitles: ['Fuego contra fuego'],
        },
      ],
    })
    const client = new TmdbClient(config(), tmdb.fetch)
    expect(await client.matchFacts({ type: 'movie', tmdbId: '949' })).toEqual({
      type: 'movie',
      aliases: ['Fuego contra fuego'],
      runtime: 170,
    })
  })
})

describe('toShow and toSeason', () => {
  const show = {
    id: 95396,
    title: 'Severance',
    first: '2022-02-18',
    last: '2025-03-21',
    seasons: { 1: [{ number: 1, title: 'Good News About Hell', aired: '2022-02-18' }] },
  }

  it('reads a show with its creator, aggregate credits, rating and network', () => {
    const parsed = toShow({ body: showBody(show), country: 'GB' })
    expect(parsed).toMatchObject({
      type: 'show',
      tmdbId: '95396',
      title: 'Severance',
      year: 2022,
      ended: '2025-03-21',
      contentRating: 'TV-MA',
      studio: 'Network One',
      runtime: 45,
      imdbId: 'tt95396',
    })
    expect(parsed?.credits.map((credit) => `${credit.name}:${credit.job}:${credit.role}`)).toEqual([
      'Adam Scott:cast:Mark Scout',
      'Britt Lower:cast:Helly R.',
      'Dan Erickson:creator:Creator',
      'Ben Stiller:director:Director',
      'Ben Stiller:producer:Producer',
    ])
  })

  it('leaves a show that still airs without an end', () => {
    expect(
      toShow({ body: showBody({ ...show, last: undefined }), country: 'US' })?.ended,
    ).toBeNull()
  })

  it('reads a season with its episodes, their stills and guest stars', () => {
    const parsed = toSeason(seasonBody({ show, number: 1 }))
    expect(parsed?.season).toMatchObject({ type: 'season', number: 1, title: 'Season 1' })
    expect(parsed?.episodes[0]).toMatchObject({
      type: 'episode',
      number: 1,
      title: 'Good News About Hell',
      images: { still: '/still95396-1-1.jpg' },
    })
    expect(parsed?.episodes[0]?.credits.map((credit) => credit.job)).toEqual(['guest', 'director'])
  })
})

describe('mergeCredits', () => {
  it('keeps ten producers', () => {
    const producers = Array.from({ length: 12 }, (_, index) => ({
      tmdbId: String(index),
      name: `Producer ${index}`,
      photo: null,
      job: 'producer' as const,
      role: 'Producer',
    }))
    expect(mergeCredits(producers)).toHaveLength(10)
  })

  it('joins two roles of one kind', () => {
    expect(
      mergeCredits([
        { tmdbId: '1', name: 'A', photo: null, job: 'writer', role: 'Screenplay' },
        { tmdbId: '1', name: 'A', photo: null, job: 'writer', role: 'Story' },
      ]),
    ).toEqual([{ tmdbId: '1', name: 'A', photo: null, job: 'writer', role: 'Screenplay / Story' }])
  })
})
