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

export type FakeEpisode = { number: number; title: string; aired: string }

export type FakeShow = {
  id: number
  title: string
  /** YYYY-MM-DD of the first episode. */
  first: string
  /** Set once the show has ended. */
  last?: string
  tvdbId?: string
  seasons: Record<number, FakeEpisode[]>
}

/** A show as `/tv/{id}` answers with aggregate credits, content ratings and external ids. */
export const showBody = (show: FakeShow): Record<string, unknown> => ({
  id: show.id,
  name: show.title,
  original_name: show.title,
  first_air_date: show.first,
  last_air_date: show.last ?? show.first,
  status: show.last ? 'Ended' : 'Returning Series',
  overview: `${show.title} is a show.`,
  tagline: 'A tagline.',
  episode_run_time: [45],
  genres: [{ id: 18, name: 'Drama' }],
  networks: [{ id: 1, name: 'Network One' }],
  poster_path: `/showposter${show.id}.jpg`,
  backdrop_path: `/showbackdrop${show.id}.jpg`,
  vote_average: 8.5,
  vote_count: 500,
  created_by: [{ id: 7001, name: 'Dan Erickson', profile_path: null }],
  external_ids: {
    imdb_id: `tt${show.id}`,
    tvdb_id: show.tvdbId == null ? null : Number(show.tvdbId),
  },
  content_ratings: { results: [{ iso_3166_1: 'US', rating: 'TV-MA' }] },
  aggregate_credits: {
    cast: [
      {
        id: 6001,
        name: 'Adam Scott',
        order: 0,
        profile_path: '/adam.jpg',
        roles: [{ character: 'Mark Scout' }],
      },
      {
        id: 6002,
        name: 'Britt Lower',
        order: 1,
        profile_path: null,
        roles: [{ character: 'Helly R.' }],
      },
    ],
    crew: [
      {
        id: 7002,
        name: 'Ben Stiller',
        profile_path: null,
        jobs: [{ job: 'Director' }, { job: 'Producer' }],
      },
    ],
  },
})

/** A season as `/tv/{id}/season/{n}` answers it, with its episodes. */
export const seasonBody = ({
  show,
  number,
}: {
  show: FakeShow
  number: number
}): Record<string, unknown> => ({
  id: show.id * 100 + number,
  season_number: number,
  name: number === 0 ? 'Specials' : `Season ${number}`,
  air_date: show.seasons[number]?.[0]?.aired ?? show.first,
  overview: `Season ${number} of ${show.title}.`,
  poster_path: `/seasonposter${show.id}-${number}.jpg`,
  episodes: (show.seasons[number] ?? []).map((episode) => ({
    id: show.id * 10000 + number * 100 + episode.number,
    episode_number: episode.number,
    season_number: number,
    name: episode.title,
    air_date: episode.aired,
    overview: `${episode.title} is an episode.`,
    runtime: 50,
    still_path: `/still${show.id}-${number}-${episode.number}.jpg`,
    vote_average: 8.1,
    vote_count: 40,
    guest_stars: [
      {
        id: 6003,
        name: 'Tramell Tillman',
        character: 'Mr. Milchick',
        order: 0,
        profile_path: null,
      },
    ],
    crew: [{ id: 7002, name: 'Ben Stiller', job: 'Director', profile_path: null }],
  })),
})

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const yearOf = (released: string): number => Number(released.slice(0, 4))

/**
 * TMDB in miniature: searches by exact title (year optional), `/find` by
 * IMDb id, and movies by id. `down` makes every call fail as if TMDB were
 * unreachable; `calls` records each URL asked for.
 */
export const fakeTmdb = ({ movies, shows = [] }: { movies: FakeMovie[]; shows?: FakeShow[] }) => {
  const state = { down: false, calls: [] as string[], movies, shows }

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

    if (path === '/search/tv') {
      const title = query.get('query') ?? ''
      const year = query.get('first_air_date_year')
      const results = state.shows.filter(
        (show) =>
          show.title.toLowerCase().includes(title.toLowerCase()) &&
          (year == null || Math.abs(yearOf(show.first) - Number(year)) <= 1),
      )
      return json({
        results: results.map((show) => ({
          id: show.id,
          name: show.title,
          original_name: show.title,
          first_air_date: show.first,
          overview: `${show.title} is a show.`,
          poster_path: `/showposter${show.id}.jpg`,
        })),
      })
    }

    const find = /^\/find\/(.+)$/.exec(path)
    if (find) {
      const id = decodeURIComponent(find[1] ?? '')
      const source = query.get('external_source')
      const movieHits =
        source === 'imdb_id' ? state.movies.filter((movie) => movie.imdbId === id) : []
      const showHits = state.shows.filter((show) =>
        source === 'tvdb_id' ? show.tvdbId === id : source === 'imdb_id' && `tt${show.id}` === id,
      )
      return json({
        movie_results: movieHits.map((movie) => ({ id: movie.id })),
        tv_results: showHits.map((show) => ({ id: show.id })),
      })
    }

    const season = /^\/tv\/(\d+)\/season\/(\d+)$/.exec(path)
    if (season) {
      const show = state.shows.find((entry) => String(entry.id) === season[1])
      const number = Number(season[2])
      return show && show.seasons[number]
        ? json(seasonBody({ show, number }))
        : json({ status_code: 34 }, 404)
    }

    const show = /^\/tv\/(\d+)$/.exec(path)
    if (show) {
      const found = state.shows.find((entry) => String(entry.id) === show[1])
      return found ? json(showBody(found)) : json({ status_code: 34 }, 404)
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
