import {
  APP_CALL_METHODS,
  APP_CLIENT_CALLS,
  type ApiClient,
  HOME_SHELF_TYPES,
  type HomeSearch,
  ITEM_TYPES,
  MATCH_STATES,
  createApiClient,
  toQueryString,
} from '@raven/core'
import { allowlistedFetch } from '@raven/native/headless'

import {
  type Answer,
  type HeardRequest,
  NOT_FOUND,
  STATUSES,
  responseOf,
} from '@/test/fixtureFetch'
import { FILMS, NAS, SERIES } from '@/test/homeServer'
import { mediaItemFor, summaryFor } from '@/test/mediaItem'

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
        seasons: 1,
        totalEpisodes: 6,
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

const answerFor = (path: string): Answer => {
  if (path === listLibraries.path) return { status: STATUSES.ok, body: [FILMS, SERIES] }
  if (path === searchPathFor(DUNE_QUERY)) return { status: STATUSES.ok, body: DUNE_RESULTS }
  if (path === searchPathFor(FAILING_SEARCH.query)) {
    return { status: STATUSES.failed, body: { message: FAILING_SEARCH.message } }
  }
  return isSearch(path) ? { status: STATUSES.ok, body: [] } : NOT_FOUND
}

type SearchApiProps = {
  hear?: (request: HeardRequest) => void
  reads?: (path: string) => Promise<void>
}

/**
 * Films and Series, and a search through them that finds Dune in both, behind the app's
 * allowlist so an unlisted call fails the test. Every request is heard, and answered once
 * `reads` lets its path through, so a test can look while the server is still busy.
 */
export const searchApi = ({
  hear = () => undefined,
  reads = async () => undefined,
}: SearchApiProps = {}): ApiClient =>
  createApiClient({
    baseUrl: NAS.origin,
    fetch: allowlistedFetch({
      fetch: async (url, init = {}) => {
        const path = url.slice(NAS.origin.length)
        hear({ method: init.method ?? APP_CALL_METHODS.get, path, body: null })
        await reads(path)
        return responseOf(answerFor(path))
      },
    }),
  })
