import { CONTENT_TYPES, HEADERS } from '@shared/server'
import { RAVEN_CONTENT_TYPES, RAVEN_HEADERS } from '@/http'
import {
  type MetadataFetch,
  TMDB_EXTERNAL_SOURCES,
  TMDB_SEARCH_ROUTES,
  TMDB_SEGMENTS,
} from '@/metadata/tmdbClient'

/** The hosts the fake answers for besides TMDB's API. */
const HOSTS = {
  omdb: 'www.omdbapi.com',
  mdblist: 'api.mdblist.com',
  images: 'image.tmdb.org',
} as const

/** What a query flag such as `include_adult=true` says when it is on. */
const QUERY_FLAGS = { true: 'true' } as const

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
  /** The other titles TMDB knows it by, which its search reads too. */
  alternativeTitles?: string[]
  /** Left out of a search without adult titles, as TMDB leaves out Paprika (1991). */
  isHiddenFromSearch?: boolean
  /** The collection it belongs to, as `belongs_to_collection`. */
  saga?: { id: number; name: string }
  /** TMDB's `genre_ids` in a search: Action and Science Fiction when not given. */
  genreIds?: number[]
  /** TMDB's `original_language`: `en` when not given. */
  language?: string
  /** TMDB's `runtime` in minutes: 120 when not given. */
  runtime?: number
  /** TMDB's `popularity` in a search; left out when not given. */
  popularity?: number
  /** TMDB's `vote_average`: 8.2 when not given. */
  voteAverage?: number
}

/**
 * A movie's logos as TMDB lists them: an SVG first, which raven passes over,
 * then PNG files in French, in English and with no language.
 */
const logosOf = (id: number) => [
  { file_path: `/logo${id}.svg`, iso_639_1: 'en', width: 500, height: 200 },
  { file_path: `/logo${id}-fr.png`, iso_639_1: 'fr', width: 500, height: 200 },
  { file_path: `/logo${id}.png`, iso_639_1: 'en', width: 500, height: 200 },
  { file_path: `/logo${id}-plain.png`, iso_639_1: null, width: 500, height: 200 },
]

/** A movie as TMDB's `/movie/{id}` answers with credits, release dates, external ids and images appended. */
export const movieBody = (movie: FakeMovie): Record<string, unknown> => ({
  id: movie.id,
  title: movie.title,
  original_title: movie.originalTitle ?? movie.title,
  release_date: movie.released,
  overview: `${movie.title} is a film.`,
  tagline: 'A tagline.',
  runtime: movie.runtime ?? 120,
  genres: [
    { id: 28, name: 'Action' },
    { id: 878, name: 'Science Fiction' },
  ],
  production_companies: [{ id: 1, name: 'Studio One' }],
  poster_path: movie.poster === undefined ? `/poster${movie.id}.jpg` : movie.poster,
  backdrop_path: `/backdrop${movie.id}.jpg`,
  images: { logos: logosOf(movie.id) },
  belongs_to_collection: movie.saga
    ? { id: movie.saga.id, name: movie.saga.name, poster_path: null, backdrop_path: null }
    : null,
  vote_average: movie.voteAverage ?? 8.2,
  vote_count: 1000,
  external_ids: { imdb_id: movie.imdbId ?? null },
  reviews: {
    results: [
      {
        id: `review-${movie.id}-1`,
        author: 'filmfan',
        author_details: {
          name: 'A Film Fan',
          username: 'filmfan',
          avatar_path: '/avatar1.jpg',
          rating: 8,
        },
        content: `${movie.title} holds up.\n\nThe second act drags, but the end lands.`,
        created_at: '2024-01-02T10:00:00.000Z',
        url: `https://www.themoviedb.org/review/review-${movie.id}-1`,
      },
      {
        id: `review-${movie.id}-2`,
        author: 'latecomer',
        author_details: {
          name: '',
          username: 'latecomer',
          avatar_path: 'https://elsewhere.example/x.png',
          rating: null,
        },
        content: '<b>Not</b> for me.',
        created_at: '2025-06-01T10:00:00.000Z',
        url: `https://www.themoviedb.org/review/review-${movie.id}-2`,
      },
    ],
  },
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

/** One entry of a person's `combined_credits`: cast with a character, or crew with a job and department. */
type FakePersonCredit = {
  creditId: string
  mediaType: 'movie' | 'tv'
  id: number
  title: string
  /** YYYY-MM-DD; left out for a title with no date. */
  date?: string
  poster?: string | null
  genreIds?: number[]
  /** A show's `episode_count`. */
  episodes?: number
} & ({ character: string } | { job: string; department: string })

export type FakePerson = {
  id: number
  name: string
  photo?: string | null
  imdbId?: string
  birthday?: string
  deathday?: string
  placeOfBirth?: string
  biography?: string
  knownFor?: string
  credits: FakePersonCredit[]
}

/** Keanu Reeves, who is in the fake movies' cast: a title raven has, one it lacks, shows and crew work. */
export const keanuReeves: FakePerson = {
  id: 6384,
  name: 'Keanu Reeves',
  photo: '/keanu.jpg',
  imdbId: 'nm0000206',
  birthday: '1964-09-02',
  placeOfBirth: 'Beirut, Lebanon',
  biography: 'Keanu Charles Reeves is a Canadian actor.',
  knownFor: 'Acting',
  credits: [
    {
      creditId: 'keanu-matrix',
      mediaType: 'movie',
      id: 603,
      title: 'The Matrix',
      date: '1999-03-31',
      poster: '/poster603.jpg',
      genreIds: [28, 878],
      character: 'Neo',
    },
    {
      creditId: 'keanu-john-wick',
      mediaType: 'movie',
      id: 245891,
      title: 'John Wick',
      date: '2014-10-22',
      poster: '/poster245891.jpg',
      genreIds: [28, 53],
      character: 'John Wick',
    },
    {
      creditId: 'keanu-dogstar',
      mediaType: 'tv',
      id: 9100,
      title: 'Dogstar Diaries',
      date: '1999-06-01',
      poster: '/showposter9100.jpg',
      genreIds: [99],
      episodes: 12,
      character: 'Bassist',
    },
    {
      creditId: 'keanu-late-show',
      mediaType: 'tv',
      id: 9101,
      title: 'The Late Show',
      date: '1993-08-30',
      poster: null,
      genreIds: [10767],
      episodes: 3,
      character: 'Self',
    },
    {
      creditId: 'keanu-bill-and-ted',
      mediaType: 'movie',
      id: 501170,
      title: 'Bill & Ted Face the Music',
      date: '2020-08-27',
      poster: '/poster501170.jpg',
      genreIds: [35, 878],
      job: 'Executive Producer',
      department: 'Production',
    },
    {
      creditId: 'keanu-thanks',
      mediaType: 'movie',
      id: 9003,
      title: 'A Film With Thanks',
      genreIds: [18],
      job: 'Thanks',
      department: 'Crew',
    },
  ],
}

/** A person as `/person/{id}` answers with combined credits and external ids appended. */
export const personBody = (person: FakePerson): Record<string, unknown> => {
  const entry = (credit: FakePersonCredit): Record<string, unknown> => ({
    credit_id: credit.creditId,
    media_type: credit.mediaType,
    id: credit.id,
    adult: false,
    ...(credit.mediaType === 'movie'
      ? { title: credit.title, release_date: credit.date ?? '' }
      : { name: credit.title, first_air_date: credit.date ?? '', episode_count: credit.episodes }),
    poster_path: credit.poster ?? null,
    genre_ids: credit.genreIds ?? [],
  })
  const cast = person.credits.flatMap((credit) =>
    'character' in credit ? [{ ...entry(credit), character: credit.character, order: 0 }] : [],
  )
  const crew = person.credits.flatMap((credit) =>
    'job' in credit ? [{ ...entry(credit), job: credit.job, department: credit.department }] : [],
  )
  return {
    id: person.id,
    name: person.name,
    adult: false,
    profile_path: person.photo ?? null,
    imdb_id: person.imdbId ?? null,
    birthday: person.birthday ?? null,
    deathday: person.deathday ?? null,
    place_of_birth: person.placeOfBirth ?? null,
    biography: person.biography ?? '',
    known_for_department: person.knownFor ?? null,
    external_ids: { imdb_id: person.imdbId ?? null },
    combined_credits: { cast, crew },
  }
}

export type FakeEpisode = { number: number; title: string; aired: string }

export type FakeShow = {
  id: number
  title: string
  /** YYYY-MM-DD of the first episode. */
  first: string
  /** Set once the show has ended. */
  last?: string
  tvdbId?: string
  /** TMDB's `origin_country`: `['GB']`. */
  countries?: string[]
  /** The other titles TMDB knows the show by, as `/tv/{id}/alternative_titles` gives them. */
  alternativeTitles?: string[]
  /** TMDB's `genre_ids` in a search: Drama when not given. */
  genreIds?: number[]
  /** TMDB's `original_language`: `en` when not given. */
  language?: string
  /** TMDB's `popularity` in a search; left out when not given. */
  popularity?: number
  seasons: Record<number, FakeEpisode[]>
}

/** A show as `/tv/{id}` answers with aggregate credits, content ratings, external ids and images. */
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
  number_of_episodes: Object.entries(show.seasons)
    .filter(([number]) => Number(number) !== 0)
    .reduce((sum, [, episodes]) => sum + episodes.length, 0),
  seasons: Object.entries(show.seasons).map(([number, episodes]) => ({
    season_number: Number(number),
    episode_count: episodes.length,
  })),
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
  images: { logos: logosOf(show.id) },
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

const json = ({
  body,
  status = 200,
  headers = {},
}: {
  body: unknown
  status?: number
  headers?: Record<string, string>
}): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { [HEADERS.contentType]: CONTENT_TYPES.json, ...headers },
  })

const yearOf = (released: string): number => Number(released.slice(0, 4))

/** TMDB ignores punctuation missing from a filesystem-safe title, such as a subtitle's colon. */
const searchWords = (title: string): string =>
  title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()

/** OMDb's answer for an IMDb id, as its `Ratings` strings. */
export type FakeOmdb = Record<
  string,
  { imdb?: string; rottenTomatoes?: string; metacritic?: string }
>

/**
 * MDBList's answer for a title, keyed `movie:<tmdb id>` or `show:<tmdb id>`:
 * each score as MDBList's 0 to 100 `score`, and the IMDb vote count.
 */
export type FakeMdblist = Record<
  string,
  { imdb?: number; rottenTomatoes?: number; metacritic?: number; imdbVotes?: number }
>

/**
 * TMDB in miniature: searches by a title or alternative title holding the
 * query (year optional), `/find` by IMDb id, and movies by id. `down` makes every call fail as if TMDB were
 * unreachable, and `failing` lists the paths (after `/3`) whose calls fail
 * the same way, by prefix; `omdbSpent` makes OMDb answer as it does once a
 * key's day is used up, and `mdblistSpent` does the same for MDBList with a
 * 429; `calls` records each URL asked for. `hold` keeps the
 * searches for a title waiting until it is let go, so a pass stays busy, and
 * `holdPerson` does the same for one person's `/person/{id}`; `personCalls`
 * counts those.
 */
export const fakeTmdb = ({
  movies,
  shows = [],
  people = [keanuReeves],
  omdb = {},
  mdblist = {},
}: {
  movies: FakeMovie[]
  shows?: FakeShow[]
  people?: FakePerson[]
  omdb?: FakeOmdb
  mdblist?: FakeMdblist
}) => {
  const calls: string[] = []
  const failing: string[] = []
  const state = {
    down: false,
    failing,
    omdbSpent: false,
    calls,
    movies,
    shows,
    people,
    omdb,
    mdblist,
    mdblistSpent: false,
    mdblistCalls: 0,
    omdbCalls: 0,
    personCalls: 0,
  }
  // Searches kept waiting, by lower-cased title, and what lets each go.
  const held = new Map<string, Promise<void>>()
  const hold = (title: string): (() => void) => {
    const gate = { open: () => {} }
    held.set(
      title.toLowerCase(),
      new Promise((resolve) => {
        gate.open = resolve
      }),
    )
    return () => {
      held.delete(title.toLowerCase())
      gate.open()
    }
  }

  // People kept waiting, by TMDB id, and what lets each go.
  const heldPeople = new Map<number, Promise<void>>()
  const holdPerson = (id: number): (() => void) => {
    const gate = { open: () => {} }
    heldPeople.set(
      id,
      new Promise((resolve) => {
        gate.open = resolve
      }),
    )
    return () => {
      heldPeople.delete(id)
      gate.open()
    }
  }

  const fetch: MetadataFetch = async ({ url }) => {
    state.calls.push(url)
    if (state.down) throw new TypeError('fetch failed')
    const parsed = new URL(url)
    if (parsed.host === HOSTS.omdb) {
      state.omdbCalls += 1
      if (parsed.searchParams.get('apikey') !== 'omdb-key') {
        return json({ body: { Response: 'False', Error: 'Invalid API key!' }, status: 401 })
      }
      if (state.omdbSpent)
        return json({ body: { Response: 'False', Error: 'Request limit reached!' }, status: 401 })
      const scores = state.omdb[parsed.searchParams.get('i') ?? '']
      if (!scores) return json({ body: { Response: 'False', Error: 'Error getting data.' } })
      return json({
        body: {
          Response: 'True',
          Ratings: [
            ...(scores.imdb ? [{ Source: 'Internet Movie Database', Value: scores.imdb }] : []),
            ...(scores.rottenTomatoes
              ? [{ Source: 'Rotten Tomatoes', Value: scores.rottenTomatoes }]
              : []),
            ...(scores.metacritic ? [{ Source: 'Metacritic', Value: scores.metacritic }] : []),
          ],
        },
      })
    }
    if (parsed.host === HOSTS.mdblist) {
      state.mdblistCalls += 1
      if (parsed.searchParams.get('apikey') !== 'mdblist-key') {
        return json({ body: { error: 'Invalid API key' }, status: 401 })
      }
      if (state.mdblistSpent) {
        return json({
          body: { error: 'Daily API limit exceeded!' },
          status: 429,
          headers: { [RAVEN_HEADERS.retryAfter]: '3600' },
        })
      }
      const title = /^\/tmdb\/(movie|show)\/(\d+)\/$/.exec(parsed.pathname)
      const scores = title ? state.mdblist[`${title[1]}:${title[2]}`] : undefined
      if (!title || !scores) return json({ body: { error: 'Not found' }, status: 404 })
      return json({
        body: {
          id: Number(title[2]),
          type: title[1],
          ratings: [
            ...(scores.imdb == null
              ? []
              : [
                  {
                    source: 'imdb',
                    value: scores.imdb / 10,
                    score: scores.imdb,
                    votes: scores.imdbVotes ?? null,
                  },
                ]),
            ...(scores.rottenTomatoes == null
              ? []
              : [
                  {
                    source: 'tomatoes',
                    value: scores.rottenTomatoes,
                    score: scores.rottenTomatoes,
                    votes: null,
                  },
                ]),
            ...(scores.metacritic == null
              ? []
              : [
                  {
                    source: 'metacritic',
                    value: scores.metacritic,
                    score: scores.metacritic,
                    votes: null,
                  },
                ]),
          ],
        },
      })
    }
    if (parsed.host === HOSTS.images) {
      return new Response(FAKE_JPEG, {
        headers: { [HEADERS.contentType]: RAVEN_CONTENT_TYPES.jpeg },
      })
    }
    const path = parsed.pathname.replace(/^\/3/, '')
    if (state.failing.some((prefix) => path.startsWith(prefix))) throw new TypeError('fetch failed')
    const query = parsed.searchParams
    const appended = (query.get('append_to_response') ?? '').split(',')

    if (path === TMDB_SEARCH_ROUTES.movie) {
      const title = query.get('query') ?? ''
      await held.get(title.toLowerCase())
      const year = query.get('year')
      const isAdultIncluded = query.get('include_adult') === QUERY_FLAGS.true
      const results = state.movies.filter(
        (movie) =>
          [movie.title, ...(movie.alternativeTitles ?? [])].some((each) =>
            searchWords(each).includes(searchWords(title)),
          ) &&
          (year == null || Math.abs(yearOf(movie.released) - Number(year)) <= 1) &&
          (isAdultIncluded || !movie.isHiddenFromSearch),
      )
      return json({
        body: {
          results: results.map((movie) => ({
            id: movie.id,
            title: movie.title,
            original_title: movie.originalTitle ?? movie.title,
            release_date: movie.released,
            genre_ids: movie.genreIds ?? [28, 878],
            original_language: movie.language ?? 'en',
            popularity: movie.popularity,
            overview: `${movie.title} is a film.`,
            poster_path: movie.poster === undefined ? `/poster${movie.id}.jpg` : movie.poster,
          })),
        },
      })
    }

    if (path === TMDB_SEARCH_ROUTES.show) {
      const title = query.get('query') ?? ''
      const year = query.get('first_air_date_year')
      const results = state.shows.filter(
        (show) =>
          [show.title, ...(show.alternativeTitles ?? [])].some((each) =>
            searchWords(each).includes(searchWords(title)),
          ) &&
          (year == null || Math.abs(yearOf(show.first) - Number(year)) <= 1),
      )
      return json({
        body: {
          results: results.map((show) => ({
            id: show.id,
            name: show.title,
            original_name: show.title,
            first_air_date: show.first,
            origin_country: show.countries ?? ['US'],
            genre_ids: show.genreIds ?? [18],
            original_language: show.language ?? 'en',
            popularity: show.popularity,
            overview: `${show.title} is a show.`,
            poster_path: `/showposter${show.id}.jpg`,
          })),
        },
      })
    }

    const find = /^\/find\/(.+)$/.exec(path)
    if (find) {
      const id = decodeURIComponent(find[1] ?? '')
      const source = query.get('external_source')
      const movieHits =
        source === TMDB_EXTERNAL_SOURCES.imdbId
          ? state.movies.filter((movie) => movie.imdbId === id)
          : []
      const showHits = state.shows.filter((show) =>
        source === TMDB_EXTERNAL_SOURCES.tvdbId
          ? show.tvdbId === id
          : source === TMDB_EXTERNAL_SOURCES.imdbId && `tt${show.id}` === id,
      )
      return json({
        body: {
          movie_results: movieHits.map((movie) => ({ id: movie.id })),
          tv_results: showHits.map((show) => ({ id: show.id })),
        },
      })
    }

    const season = /^\/tv\/(\d+)\/season\/(\d+)$/.exec(path)
    if (season) {
      const show = state.shows.find((entry) => String(entry.id) === season[1])
      const number = Number(season[2])
      return show && show.seasons[number]
        ? json({ body: seasonBody({ show, number }) })
        : json({ body: { status_code: 34 }, status: 404 })
    }

    const show = /^\/tv\/(\d+)$/.exec(path)
    if (show) {
      const found = state.shows.find((entry) => String(entry.id) === show[1])
      return found
        ? json({
            body: {
              ...showBody(found),
              ...(appended.includes('alternative_titles')
                ? {
                    alternative_titles: {
                      results: (found.alternativeTitles ?? []).map((title) => ({
                        iso_3166_1: 'GB',
                        title,
                        type: '',
                      })),
                    },
                  }
                : {}),
            },
          })
        : json({ body: { status_code: 34 }, status: 404 })
    }

    const images = /^\/(movie|tv)\/(\d+)\/images$/.exec(path)
    if (images) {
      const id = Number(images[2])
      const known =
        images[1] === TMDB_SEGMENTS.movie
          ? state.movies.some((entry) => entry.id === id)
          : state.shows.some((entry) => entry.id === id)
      if (!known) return json({ body: { status_code: 34 }, status: 404 })
      const picture = ({ name, language }: { name: string; language: string | null }) => ({
        file_path: `/${name}${id}.jpg`,
        width: 2000,
        height: 3000,
        iso_639_1: language,
        vote_average: 5,
      })
      return json({
        body: {
          id,
          posters: [
            picture({ name: 'poster', language: 'en' }),
            picture({ name: 'alt', language: null }),
          ],
          backdrops: [
            picture({ name: 'backdrop', language: null }),
            picture({ name: 'scene', language: 'en' }),
          ],
          logos: logosOf(id),
        },
      })
    }

    const alternatives = /^\/(movie|tv)\/(\d+)\/alternative_titles$/.exec(path)
    if (alternatives) {
      const id = Number(alternatives[2])
      if (alternatives[1] === TMDB_SEGMENTS.show) {
        const titled = state.shows.find((entry) => entry.id === id)
        return titled
          ? json({
              body: {
                id,
                results: (titled.alternativeTitles ?? []).map((title) => ({
                  iso_3166_1: 'GB',
                  title,
                  type: '',
                })),
              },
            })
          : json({ body: { status_code: 34 }, status: 404 })
      }
      const found = state.movies.find((entry) => entry.id === id)
      return found
        ? json({
            body: {
              id,
              titles: (found.alternativeTitles ?? []).map((title) => ({
                iso_3166_1: 'US',
                title,
                type: '',
              })),
            },
          })
        : json({ body: { status_code: 34 }, status: 404 })
    }

    const person = /^\/person\/(\d+)$/.exec(path)
    if (person) {
      state.personCalls += 1
      await heldPeople.get(Number(person[1]))
      const found = state.people.find((entry) => String(entry.id) === person[1])
      return found
        ? json({ body: personBody(found) })
        : json({ body: { status_code: 34 }, status: 404 })
    }

    const movie = /^\/movie\/(\d+)$/.exec(path)
    if (movie) {
      const found = state.movies.find((entry) => String(entry.id) === movie[1])
      return found
        ? json({
            body: {
              ...movieBody(found),
              ...(appended.includes('alternative_titles')
                ? {
                    alternative_titles: {
                      titles: (found.alternativeTitles ?? []).map((title) => ({
                        iso_3166_1: 'US',
                        title,
                        type: '',
                      })),
                    },
                  }
                : {}),
            },
          })
        : json({ body: { status_code: 34 }, status: 404 })
    }
    return json({ body: { status_code: 34 }, status: 404 })
  }

  return { fetch, state, hold, holdPerson }
}
