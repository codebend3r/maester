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
  type PosterEntry,
  type ShowEntry,
  type ShowListing,
  createApiClient,
  mediaListQuery,
} from '@raven/core'
import { allowlistedFetch } from '@raven/native/headless'

import { NOT_FOUND, STATUSES, pathFor, responseOf } from '@/test/fixtureFetch'
import { FILMS, NAS, SERIES } from '@/test/homeServer'
import { mediaItemFor, summaryFor } from '@/test/mediaItem'

type MovieForProps = {
  id: number
  title: string
  year: number
  addedAt: string
}

const movieFor = ({ id, title, year, addedAt }: MovieForProps) =>
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

type ShowForProps = { id: number; title: string }

const showFor = ({ id, title }: ShowForProps): ShowEntry => ({
  show: summaryFor({ id, type: ITEM_TYPES.show, title, year: 2024 }),
  episodes: 8,
  seasons: 1,
  totalEpisodes: 8,
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

type LibraryPathProps = {
  call: AppClientCall
  library: Library
  sort?: MediaSort
  /** What the library's search box asks for. */
  search?: string
}

/** A library route's path for `library`, with the listing's query when it has a sort. */
export const libraryPath = ({ call, library, sort, search }: LibraryPathProps): string => {
  const path = pathFor({ path: call.path, id: library.id })
  return sort === undefined ? path : `${path}?${mediaListQuery.encode({ sort, search })}`
}

/** What a viewer types in Films' search box to find Busboys, and to find nothing. */
export const FILM_SEARCHES = { busboys: 'bus', nothing: 'zzz' } as const

const { getLibrary, listInProgress, listLibraries, listMedia, listShows } = APP_CLIENT_CALLS

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
  [libraryPath({ call: listInProgress, library: FILMS })]: [],
  [libraryPath({ call: listInProgress, library: SERIES })]: [],
}

/** Night Train, stopped twenty minutes in, as Films' in-progress route lists it. */
export const NIGHT_TRAIN_IN_PROGRESS: PosterEntry = {
  media: { ...NIGHT_TRAIN, position: 1200 },
  poster: null,
}

/** Films as it would be once a viewer on the web groups it by match. */
export const GROUPED_FILMS: Library = {
  ...FILMS,
  settings: { ...FILMS.settings, view: LIBRARY_VIEWS.grouped, groupBy: MEDIA_GROUPINGS.match },
}

type LibraryApiProps = {
  /** Hears the path and query of every request. */
  record?: (path: string) => void
  /** Answers that stand in for these libraries' own. */
  libraries?: () => Library[]
  /** What each answer waits on, by its path and query, so a test can look while it waits. */
  reads?: (path: string) => Promise<void>
  /** What Films has in progress; nothing unless a test says. */
  inProgress?: () => PosterEntry[]
}

/**
 * A movie library and a show library, behind the app's allowlist so an unlisted call fails
 * the test. The app keeps one client per server, so what a test changes is read per request.
 */
export const libraryApi = ({
  record = () => undefined,
  libraries = () => [],
  reads = async () => undefined,
  inProgress = () => [],
}: LibraryApiProps = {}): ApiClient =>
  createApiClient({
    baseUrl: NAS.origin,
    fetch: allowlistedFetch({
      fetch: async (url) => {
        const path = url.slice(NAS.origin.length)
        record(path)
        await reads(path)
        const override = libraries().find(
          (library) => path === libraryPath({ call: getLibrary, library }),
        )
        const body =
          override ??
          (path === libraryPath({ call: listInProgress, library: FILMS })
            ? inProgress()
            : ANSWERS[path])
        return responseOf(body === undefined ? NOT_FOUND : { status: STATUSES.ok, body })
      },
    }),
  })
