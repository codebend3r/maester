import {
  APP_CLIENT_CALLS,
  type ApiClient,
  type AppClientCall,
  ITEM_TYPES,
  LIBRARY_VIEWS,
  type Library,
  MATCH_STATES,
  MEDIA_GROUPINGS,
  MEDIA_SORTS,
  type MediaSort,
  type ShowEntry,
  type ShowListing,
  createApiClient,
  mediaListQuery,
} from '@raven/core'

import { allowlistedFetch } from '@/servers/allowlist'
import { NOT_FOUND, STATUSES, pathFor, responseOf } from '@/test/fixtureFetch'
import { FILMS, NAS, SERIES } from '@/test/homeServer'
import { mediaItemFor, summaryFor } from '@/test/mediaItem'

const movieFor = ({
  id,
  title,
  year,
  addedAt,
}: {
  id: number
  title: string
  year: number
  addedAt: string
}) =>
  mediaItemFor({
    id,
    libraryId: FILMS.id,
    title,
    fileName: `${title} (${year}).mkv`,
    match: MATCH_STATES.matched,
    addedAt,
    item: summaryFor({ id: id + 20, title, year }),
  })

export const ASHFALL_GATE = movieFor({
  id: 30,
  title: 'Ashfall Gate',
  year: 2021,
  addedAt: '2026-10-10T00:00:00.000Z',
})
export const BUSBOYS = movieFor({
  id: 31,
  title: 'Busboys',
  year: 2026,
  addedAt: '2026-10-16T00:00:00.000Z',
})
export const NIGHT_TRAIN = movieFor({
  id: 32,
  title: 'Night Train',
  year: 2025,
  addedAt: '2026-10-12T00:00:00.000Z',
})

const showFor = ({ id, title }: { id: number; title: string }): ShowEntry => ({
  show: summaryFor({ id, type: ITEM_TYPES.show, title, year: 2024 }),
  episodes: 8,
  watchedEpisodes: 0,
  endedYear: null,
  addedAt: '2026-10-16T00:00:00.000Z',
  bitrate: 4_000_000,
  next: null,
})

/** A TV library's shows as the server sorts them by title: past a leading "The". */
const SHOWS: ShowListing = {
  shows: [
    showFor({ id: 60, title: 'Ashfall' }),
    showFor({ id: 61, title: 'The Beacon' }),
    showFor({ id: 62, title: 'Saltmarsh' }),
  ],
  unmatched: [],
}

/** A library route's path for `library`, with the listing's query when it has a sort. */
export const libraryPath = ({
  call,
  library,
  sort,
  search,
}: {
  call: AppClientCall
  library: Library
  sort?: MediaSort
  /** What the library's search box asks for. */
  search?: string
}): string => {
  const path = pathFor({ path: call.path, id: library.id })
  return sort === undefined ? path : `${path}?${mediaListQuery.encode({ sort, search })}`
}

/** What a viewer types in Films' search box to find Busboys, and to find nothing. */
export const FILM_SEARCHES = { busboys: 'bus', nothing: 'zzz' } as const

const { getLibrary, listLibraries, listMedia, listShows } = APP_CLIENT_CALLS

/** Films sorted by title, then newest first, and searched; Series by title. */
const ANSWERS: Record<string, unknown> = {
  [listLibraries.path]: [FILMS, SERIES],
  [libraryPath({ call: getLibrary, library: FILMS })]: FILMS,
  [libraryPath({ call: getLibrary, library: SERIES })]: SERIES,
  [libraryPath({ call: listMedia, library: FILMS, sort: MEDIA_SORTS.title })]: [
    ASHFALL_GATE,
    BUSBOYS,
    NIGHT_TRAIN,
  ],
  [libraryPath({ call: listMedia, library: FILMS, sort: MEDIA_SORTS.added })]: [
    BUSBOYS,
    NIGHT_TRAIN,
    ASHFALL_GATE,
  ],
  [libraryPath({
    call: listMedia,
    library: FILMS,
    sort: MEDIA_SORTS.title,
    search: FILM_SEARCHES.busboys,
  })]: [BUSBOYS],
  [libraryPath({
    call: listMedia,
    library: FILMS,
    sort: MEDIA_SORTS.title,
    search: FILM_SEARCHES.nothing,
  })]: [],
  [libraryPath({ call: listShows, library: SERIES, sort: MEDIA_SORTS.title })]: SHOWS,
}

/** Films as it would be once a viewer on the web groups it by match. */
export const GROUPED_FILMS: Library = {
  ...FILMS,
  settings: { ...FILMS.settings, view: LIBRARY_VIEWS.grouped, groupBy: MEDIA_GROUPINGS.match },
}

/**
 * A movie library and a show library, behind the app's allowlist so an unlisted call fails
 * the test. The app keeps one client per server, so what a test changes is read per request.
 */
export const libraryApi = ({
  record = () => undefined,
  libraries = () => [],
  reads = async () => undefined,
}: {
  /** Hears the path and query of every request. */
  record?: (path: string) => void
  /** Answers that stand in for these libraries' own. */
  libraries?: () => Library[]
  /** What each answer waits on, by its path and query, so a test can look while it waits. */
  reads?: (path: string) => Promise<void>
} = {}): ApiClient =>
  createApiClient({
    baseUrl: NAS.origin,
    fetch: allowlistedFetch({
      hasAccounts: () => false,
      fetch: async (url) => {
        const path = url.slice(NAS.origin.length)
        record(path)
        await reads(path)
        const override = libraries().find(
          (library) => path === libraryPath({ call: getLibrary, library }),
        )
        const body = override ?? ANSWERS[path]
        return responseOf(body === undefined ? NOT_FOUND : { status: STATUSES.ok, body })
      },
    }),
  })
