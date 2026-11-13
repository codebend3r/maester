import { FIXTURE_SERVER, ITEM_TYPES, type MatchItemType } from '@raven/core'
import { CONTENT_TYPES, HEADERS, HTTP_METHODS } from '@shared/server'
import { DOCUMENTARY_FILTERS, type MetadataFetch } from '@/metadata/tmdbClient'
import type { RequestsConfig } from '@/requests/requestsConfig'
import type { FakeMovie, FakeShow } from '@/test/fakeTmdb'

const { held, open, show } = FIXTURE_SERVER.upcoming

type UpcomingFixture = (typeof FIXTURE_SERVER.upcoming)[keyof typeof FIXTURE_SERVER.upcoming]

/** A day far enough off that Coming soon always counts it as still to come. */
const RELEASED = '2030-05-17'

/** Coming soon's movies as the fixture's fake TMDB describes them on their own pages. */
export const UPCOMING_MOVIES: FakeMovie[] = [held, open].map(({ tmdbId, title }) => ({
  id: Number(tmdbId),
  title,
  released: RELEASED,
}))

/** Coming soon's show as the fixture's fake TMDB describes it on its own page. */
export const UPCOMING_SHOWS: FakeShow[] = [
  { id: Number(show.tmdbId), title: show.title, first: RELEASED, seasons: {} },
]

/** Where the fixture's Radarr and Sonarr answer; nothing listens there, the fetch answers for them. */
const ARR_ORIGINS = {
  [ITEM_TYPES.movie]: 'http://radarr.fixture',
  [ITEM_TYPES.show]: 'http://sonarr.fixture',
} as const satisfies Record<MatchItemType, string>

const QUALITY_PROFILE = { id: 4, name: 'HD-1080p', resolution: 1080 } as const

/** The fixture's requests: both arrs on, letter folders under `/media`, and a budget that never runs out. */
export const FIXTURE_REQUESTS: RequestsConfig = {
  arrs: {
    [ITEM_TYPES.movie]: { url: ARR_ORIGINS[ITEM_TYPES.movie], apiKey: 'fixture-radarr' },
    [ITEM_TYPES.show]: { url: ARR_ORIGINS[ITEM_TYPES.show], apiKey: 'fixture-sonarr' },
  },
  folders: { [ITEM_TYPES.movie]: '/media/movies', [ITEM_TYPES.show]: '/media/shows' },
  qualityProfile: QUALITY_PROFILE.name,
  dailyLimit: 100,
}

/** Sonarr's and Radarr's v3 routes, as the fake answers them. */
const ARR_ROUTES = {
  rootFolders: '/api/v3/rootfolder',
  qualityProfiles: '/api/v3/qualityprofile',
  movieLookup: '/api/v3/movie/lookup/tmdb',
  seriesLookup: '/api/v3/series/lookup',
  movies: '/api/v3/movie',
  series: '/api/v3/series',
  command: '/api/v3/command',
  queue: '/api/v3/queue/details',
} as const

const LETTERS = [...'#ABCDEFGHIJKLMNOPQRSTUVWXYZ']

/** TMDB's `/discover` routes, as the fixture's fetch sees them, under the API's `/3`. */
const TMDB_DISCOVER_ROUTES = { any: '/3/discover/', shows: '/3/discover/tv' } as const

/** The query parameters the fake reads: a discover page, and a title's TMDB id as each arr sends it. */
const QUERY_KEYS = { page: 'page', tmdbId: 'tmdbId', term: 'term' } as const

/** The prefix Sonarr's lookup term puts before a TMDB id. */
const TMDB_TERM = 'tmdb:'

/** The first page of a `/discover` shelf, which holds every fixture title. */
const FIRST_PAGE = '1'

const json = (body: unknown): Response =>
  new Response(JSON.stringify(body), { headers: { [HEADERS.contentType]: CONTENT_TYPES.json } })

/** TMDB's `/discover` result for a title, as Coming soon's shelves read one. */
const discovered = ({ tmdbId, title }: UpcomingFixture) => ({
  id: Number(tmdbId),
  title,
  name: title,
  release_date: RELEASED,
  first_air_date: RELEASED,
  poster_path: `/poster${tmdbId}.jpg`,
  popularity: 10,
})

/** A `/discover` shelf: no documentaries, and every movie or the show on its first page. */
const discover = (url: URL): Response => {
  const isDocumentaries = url.searchParams.has(DOCUMENTARY_FILTERS.only)
  const isFirstPage = url.searchParams.get(QUERY_KEYS.page) === FIRST_PAGE
  const titles = url.pathname === TMDB_DISCOVER_ROUTES.shows ? [show] : [held, open]
  const results = isDocumentaries || !isFirstPage ? [] : titles.map(discovered)
  return json({ total_results: results.length, results })
}

/** The TMDB ids the fixture's arrs hold: `held` from the start, and each title added since. */
const holdings = new Set<string>([held.tmdbId])

const titleOf = (tmdbId: string): string =>
  [held, open, show].find((each) => each.tmdbId === tmdbId)?.title ?? tmdbId

/** The arr's record of a title, which it sends back whole to add it; an id once it holds it. */
const recordOf = (tmdbId: string) => ({
  title: titleOf(tmdbId),
  tmdbId: Number(tmdbId),
  ...(holdings.has(tmdbId) ? { id: Number(tmdbId) } : {}),
})

const tmdbIdIn = (body: BodyInit | null | undefined): string => {
  const parsed: unknown = JSON.parse(typeof body === 'string' ? body : '{}')
  return typeof parsed === 'object' && parsed !== null && QUERY_KEYS.tmdbId in parsed
    ? String(parsed.tmdbId)
    : ''
}

type ArrAnswerProps = { url: URL; init: RequestInit }

/**
 * Radarr and Sonarr as Coming soon talks to them. Radarr's TMDB lookup never carries an id, as
 * the real one's does not, so a held movie is found in its library; Sonarr's lookup does.
 * Every title waits in the queue once it is searched for.
 */
const arrAnswer = ({ url, init }: ArrAnswerProps): Response => {
  const method = init.method ?? HTTP_METHODS.get
  const path = url.pathname
  const tmdbId =
    url.searchParams.get(QUERY_KEYS.tmdbId) ??
    (url.searchParams.get(QUERY_KEYS.term) ?? '').replace(TMDB_TERM, '')
  if (path === ARR_ROUTES.rootFolders) {
    return json(
      Object.values(FIXTURE_REQUESTS.folders).flatMap((folder) =>
        LETTERS.map((letter) => ({ path: `${folder}/${letter}` })),
      ),
    )
  }
  if (path === ARR_ROUTES.qualityProfiles) {
    const { id, name, resolution } = QUALITY_PROFILE
    return json([{ id, name, items: [{ allowed: true, quality: { resolution } }] }])
  }
  if (path === ARR_ROUTES.movieLookup) return json({ ...recordOf(tmdbId), id: null })
  if (path === ARR_ROUTES.seriesLookup) return json([recordOf(tmdbId)])
  if (method === HTTP_METHODS.get && path === ARR_ROUTES.movies) {
    return json(holdings.has(tmdbId) ? [{ id: Number(tmdbId) }] : [])
  }
  if (method === HTTP_METHODS.post && (path === ARR_ROUTES.movies || path === ARR_ROUTES.series)) {
    const asked = tmdbIdIn(init.body)
    holdings.add(asked)
    return json({ id: Number(asked) })
  }
  if (method === HTTP_METHODS.post && path === ARR_ROUTES.command) return json({ id: 1 })
  if (path.startsWith(`${ARR_ROUTES.command}/`)) return json({ status: 'completed' })
  if (path === ARR_ROUTES.queue) return json([{ status: 'queued' }])
  if (path.startsWith(`${ARR_ROUTES.movies}/`)) return json({ hasFile: false })
  if (path.startsWith(`${ARR_ROUTES.series}/`)) {
    return json({ statistics: { episodeFileCount: 0 } })
  }
  return new Response(`The fixture's downloader has no ${method} ${path}`, { status: 404 })
}

const isArrOrigin = (origin: string): boolean =>
  Object.values(ARR_ORIGINS).some((each) => each === origin)

type FixtureRequestsFetchProps = { tmdb: MetadataFetch }

/**
 * The fixture's one fetch: TMDB's `/discover` for Coming soon's shelves, the fake Radarr and
 * Sonarr at their origins, and the fixture's fake TMDB for everything else.
 */
export const fixtureRequestsFetch =
  ({ tmdb }: FixtureRequestsFetchProps): MetadataFetch =>
  async (call) => {
    const url = new URL(call.url)
    if (isArrOrigin(url.origin)) return arrAnswer({ url, init: call.init })
    if (url.pathname.startsWith(TMDB_DISCOVER_ROUTES.any)) return discover(url)
    return tmdb(call)
  }
