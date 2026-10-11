import type { MetadataFetch } from '@/metadata/tmdbClient'

/** The bytes TMDB's CDN answers with here: enough of a JPEG to tell it apart. */
export const FAKE_JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0xff, 0xd9])

export type FakeMovie = {
  id: number
  title: string
  originalTitle?: string
  /** YYYY-MM-DD */
  released: string
  imdbId?: string
  poster?: string | null
}

/** A movie as TMDB's `/movie/{id}` answers with credits, release dates and external ids appended. */
export const movieBody = (movie: FakeMovie): Record<string, unknown> => ({
  id: movie.id,
  title: movie.title,
  original_title: movie.originalTitle ?? movie.title,
  release_date: movie.released,
  overview: `${movie.title} is a film.`,
  tagline: 'A tagline.',
  runtime: 120,
  genres: [
    { id: 28, name: 'Action' },
    { id: 878, name: 'Science Fiction' },
  ],
  production_companies: [{ id: 1, name: 'Studio One' }],
  poster_path: movie.poster === undefined ? `/poster${movie.id}.jpg` : movie.poster,
  backdrop_path: `/backdrop${movie.id}.jpg`,
  vote_average: 8.2,
  vote_count: 1000,
  external_ids: { imdb_id: movie.imdbId ?? null },
  release_dates: {
    results: [
      {
        iso_3166_1: 'US',
        release_dates: [
          { certification: 'R', type: 3, release_date: `${movie.released}T00:00:00.000Z` },
        ],
      },
    ],
  },
  credits: {
    cast: [
      { id: 6384, name: 'Keanu Reeves', character: 'Neo', order: 0, profile_path: '/keanu.jpg' },
      { id: 2975, name: 'Laurence Fishburne', character: 'Morpheus', order: 1, profile_path: null },
    ],
    crew: [
      { id: 9339, name: 'Lilly Wachowski', job: 'Director', profile_path: null },
      { id: 9339, name: 'Lilly Wachowski', job: 'Screenplay', profile_path: null },
      { id: 9340, name: 'Lana Wachowski', job: 'Director', profile_path: null },
      { id: 1, name: 'Someone Else', job: 'Gaffer', profile_path: null },
    ],
  },
})

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const yearOf = (released: string): number => Number(released.slice(0, 4))

/**
 * TMDB in miniature: searches by exact title (year optional), `/find` by
 * IMDb id, and movies by id. `down` makes every call fail as if TMDB were
 * unreachable; `calls` records each URL asked for.
 */
export const fakeTmdb = ({ movies }: { movies: FakeMovie[] }) => {
  const state = { down: false, calls: [] as string[], movies }

  const fetch: MetadataFetch = async (url) => {
    state.calls.push(url)
    if (state.down) throw new TypeError('fetch failed')
    const parsed = new URL(url)
    if (parsed.host === 'image.tmdb.org') {
      return new Response(FAKE_JPEG, { headers: { 'content-type': 'image/jpeg' } })
    }
    const path = parsed.pathname.replace(/^\/3/, '')
    const query = parsed.searchParams

    if (path === '/search/movie') {
      const title = query.get('query') ?? ''
      const year = query.get('year')
      const results = state.movies.filter(
        (movie) =>
          movie.title.toLowerCase().includes(title.toLowerCase()) &&
          (year == null || Math.abs(yearOf(movie.released) - Number(year)) <= 1),
      )
      return json({
        results: results.map((movie) => ({
          id: movie.id,
          title: movie.title,
          original_title: movie.originalTitle ?? movie.title,
          release_date: movie.released,
          overview: `${movie.title} is a film.`,
          poster_path: movie.poster === undefined ? `/poster${movie.id}.jpg` : movie.poster,
        })),
      })
    }

    const find = /^\/find\/(.+)$/.exec(path)
    if (find) {
      const found = state.movies.filter(
        (movie) => movie.imdbId === decodeURIComponent(find[1] ?? ''),
      )
      return json({ movie_results: found.map((movie) => ({ id: movie.id })), tv_results: [] })
    }

    const movie = /^\/movie\/(\d+)$/.exec(path)
    if (movie) {
      const found = state.movies.find((entry) => String(entry.id) === movie[1])
      return found ? json(movieBody(found)) : json({ status_code: 34 }, 404)
    }
    return json({ status_code: 34 }, 404)
  }

  return { fetch, state }
}
