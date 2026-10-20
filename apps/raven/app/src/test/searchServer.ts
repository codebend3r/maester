import {
  APP_CALL_METHODS,
  APP_CLIENT_CALLS,
  type ApiClient,
  HOME_SHELF_TYPES,
  type HomeSearch,
  ITEM_TYPES,
  type ItemSummary,
  MATCH_STATES,
  createApiClient,
  toQueryString,
} from '@raven/core'

import { allowlistedFetch } from '@/servers/allowlist'
import { FILMS, NAS, SERIES } from '@/test/homeServer'
import type { HeardRequest } from '@/test/itemServer'
import { mediaItemFor } from '@/test/mediaItem'

export { FILMS, NAS }

const summaryFor = (overrides: Partial<ItemSummary> & Pick<ItemSummary, 'id' | 'title'>) =>
  ({
    type: ITEM_TYPES.movie,
    year: 2026,
    show: null,
    season: null,
    episode: null,
    posterVersion: `p${overrides.id}`,
    backdropVersion: `b${overrides.id}`,
    ratings: [],
    ...overrides,
  }) satisfies ItemSummary

export const DUNE = mediaItemFor({
  id: 50,
  libraryId: FILMS.id,
  title: 'Dune',
  fileName: 'Dune (2021).mkv',
  match: MATCH_STATES.matched,
  item: summaryFor({ id: 70, title: 'Dune', year: 2021 }),
})

const DUNE_PROPHECY = summaryFor({ id: 71, type: ITEM_TYPES.show, title: 'Dune: Prophecy' })

/** A library the viewer cannot see, as a locked one, which the server's answer still names. */
const LOCKED_LIBRARY_ID = 9

/** What a search for "dune" finds: a film, a show, and a match in a library not listed. */
const DUNE_RESULTS: HomeSearch = [
  { libraryId: FILMS.id, type: HOME_SHELF_TYPES.media, media: [DUNE] },
  {
    libraryId: SERIES.id,
    type: HOME_SHELF_TYPES.shows,
    shows: [
      {
        show: DUNE_PROPHECY,
        episodes: 6,
        watchedEpisodes: 0,
        endedYear: null,
        addedAt: '2026-10-16T00:00:00.000Z',
        bitrate: null,
        next: null,
      },
    ],
  },
  { libraryId: LOCKED_LIBRARY_ID, type: HOME_SHELF_TYPES.media, media: [DUNE] },
]

/** What a viewer types to find Dune. */
export const DUNE_QUERY = 'dune'

/** A search the server fails, and what it says. */
export const FAILING_SEARCH = { query: 'storm', message: 'The server could not search.' } as const

const { listLibraries, searchHome } = APP_CLIENT_CALLS

/** The path a search for `query` asks for. */
export const searchPathFor = (query: string): string =>
  `${searchHome.path}?${toQueryString({ q: query })}`

/** Whether `path` is a search through every library. */
export const isSearch = (path: string): boolean => path.startsWith(`${searchHome.path}?`)

type Answer = { status: number; body: unknown }

const answerFor = (path: string): Answer => {
  if (path === listLibraries.path) return { status: 200, body: [FILMS, SERIES] }
  if (path === searchPathFor(DUNE_QUERY)) return { status: 200, body: DUNE_RESULTS }
  if (path === searchPathFor(FAILING_SEARCH.query)) {
    return { status: 500, body: { message: FAILING_SEARCH.message } }
  }
  return isSearch(path)
    ? { status: 200, body: [] }
    : { status: 404, body: { message: 'Not found' } }
}

/**
 * Films and Series, and a search through them that finds Dune in both, behind the app's
 * allowlist so an unlisted call fails the test. Every request is heard.
 */
export const searchApi = ({
  hear = () => undefined,
}: { hear?: (request: HeardRequest) => void } = {}): ApiClient =>
  createApiClient({
    baseUrl: NAS.origin,
    fetch: allowlistedFetch({
      fetch: async (url, init = {}) => {
        const path = url.slice(NAS.origin.length)
        hear({ method: init.method ?? APP_CALL_METHODS.get, path, body: null })
        const { status, body } = answerFor(path)
        return {
          ok: status === 200,
          status,
          statusText: status === 200 ? 'OK' : 'Refused',
          json: async () => body,
          text: async () => JSON.stringify(body),
        }
      },
    }),
  })
