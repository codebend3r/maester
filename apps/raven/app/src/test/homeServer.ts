import {
  APP_CLIENT_CALLS,
  type ApiClient,
  FOLDER_LAYOUTS,
  HOME_SHELF_TYPES,
  LIBRARY_VIEWS,
  MEDIA_GROUPINGS,
  MEDIA_SORTS,
  PATH_LAYOUTS,
  RATING_SOURCES,
  RATINGS_REFRESH_STATES,
  SCAN_STATES,
  type Home,
  ITEM_TYPES,
  type ItemSummary,
  LIBRARY_KINDS,
  type Library,
  type LibraryKind,
  createApiClient,
} from '@raven/core'

import type { AppServer } from '@/servers/serverList'
import { mediaItemFor } from '@/test/mediaItem'

export const NAS: AppServer = {
  id: '0f8fad5b-d9cb-469f-a165-70867728950e',
  name: 'nas:8080',
  origin: 'http://nas:8080',
  addedAt: 1,
}

const libraryFor = ({ id, name, kind }: { id: number; name: string; kind: LibraryKind }) =>
  ({
    id,
    name,
    paths: [`/media/${name}`],
    layouts: [{ path: `/media/${name}`, layout: PATH_LAYOUTS.flat, groups: 0 }],
    itemCount: 2,
    unmatchedCount: 0,
    createdAt: '2026-10-16T00:00:00.000Z',
    scan: {
      state: SCAN_STATES.idle,
      found: 0,
      processed: 0,
      startedAt: null,
      finishedAt: null,
      quickScannedAt: null,
      error: null,
    },
    settings: {
      saveProgress: true,
      pinned: true,
      sort: MEDIA_SORTS.title,
      view: LIBRARY_VIEWS.grid,
      groupBy: MEDIA_GROUPINGS.resolution,
      watchedPercent: 95,
      kind,
      ratingsSource: RATING_SOURCES.tmdb,
      autoRefresh: true,
      locked: false,
      folderLayout: FOLDER_LAYOUTS.auto,
      icon: null,
    },
    backdrop: null,
    ratingsRefresh: { state: RATINGS_REFRESH_STATES.idle, finishedAt: null },
  }) satisfies Library

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

export const FILMS = libraryFor({ id: 1, name: 'Films', kind: LIBRARY_KINDS.movies })
export const SERIES = libraryFor({ id: 2, name: 'Series', kind: LIBRARY_KINDS.shows })

const BUSBOYS = mediaItemFor({
  id: 20,
  libraryId: FILMS.id,
  title: 'Busboys',
  duration: 6000,
  position: 1500,
  item: summaryFor({ id: 40, title: 'Busboys' }),
})

const NIGHT_TRAIN = mediaItemFor({
  id: 21,
  libraryId: FILMS.id,
  title: 'Night Train',
  item: summaryFor({ id: 41, title: 'Night Train', year: 2025 }),
})

/** Continue watching with one movie, then a Films shelf of two and a Series shelf of one show. */
export const HOME: Home = {
  inProgress: [{ media: BUSBOYS, poster: BUSBOYS.item }],
  shelves: [
    { libraryId: FILMS.id, type: HOME_SHELF_TYPES.media, media: [BUSBOYS, NIGHT_TRAIN] },
    {
      libraryId: SERIES.id,
      type: HOME_SHELF_TYPES.shows,
      shows: [
        {
          show: summaryFor({ id: 4, type: ITEM_TYPES.show, title: 'Severance', year: 2022 }),
          episodes: 9,
          watchedEpisodes: 0,
          endedYear: null,
          addedAt: '2026-10-16T00:00:00.000Z',
          bitrate: null,
          next: null,
        },
      ],
    },
  ],
}

/** A second server, whose Home is one series and nothing in progress. */
export const OTHER: AppServer = {
  id: '5d3c2b1a-0f9e-4d8c-b7a6-958473625140',
  name: 'other:8484',
  origin: 'http://other:8484',
  addedAt: 2,
}

const OTHER_SHOWS = libraryFor({ id: 7, name: 'Cartoons', kind: LIBRARY_KINDS.shows })

const OTHER_HOME: Home = {
  inProgress: [],
  shelves: [{ libraryId: OTHER_SHOWS.id, type: HOME_SHELF_TYPES.shows, shows: [] }],
}

/** A third server, whose first shelf is empty and whose second is the Films shelf. */
export const SPARSE: AppServer = {
  id: '9a8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d',
  name: 'sparse:8484',
  origin: 'http://sparse:8484',
  addedAt: 3,
}

const SPARSE_HOME: Home = {
  inProgress: [],
  shelves: [
    { libraryId: OTHER_SHOWS.id, type: HOME_SHELF_TYPES.shows, shows: [] },
    ...HOME.shelves.slice(0, 1),
  ],
}

const ANSWERS: Record<string, unknown> = {
  [`${NAS.origin}${APP_CLIENT_CALLS.getHome.path}`]: HOME,
  [`${NAS.origin}${APP_CLIENT_CALLS.listLibraries.path}`]: [FILMS, SERIES],
  [`${OTHER.origin}${APP_CLIENT_CALLS.getHome.path}`]: OTHER_HOME,
  [`${OTHER.origin}${APP_CLIENT_CALLS.listLibraries.path}`]: [OTHER_SHOWS],
  [`${SPARSE.origin}${APP_CLIENT_CALLS.getHome.path}`]: SPARSE_HOME,
  [`${SPARSE.origin}${APP_CLIENT_CALLS.listLibraries.path}`]: [OTHER_SHOWS, FILMS],
}

/**
 * A client for `server` as it answers: `NAS` with `HOME` and its two libraries, `OTHER` with
 * its one, `SPARSE` with an empty shelf before Films, each 404 to the rest. `unlock` answers `{ available: true, unlocked: true }` to
 * the PIN `1234` and 403 to any other.
 */
export const homeApi = (server: AppServer = NAS): ApiClient =>
  createApiClient({
    baseUrl: server.origin,
    fetch: async (url, init) => {
      const isUnlock = url === `${server.origin}${APP_CLIENT_CALLS.unlock.path}`
      const isRightPin = isUnlock && (init?.body ?? null) === JSON.stringify({ pin: '1234' })
      const body = isUnlock
        ? isRightPin
          ? { available: true, unlocked: true }
          : { message: 'That PIN is not right.' }
        : ANSWERS[url]
      const status = ((): number => {
        if (body === undefined) return 404
        return isUnlock && !isRightPin ? 403 : 200
      })()
      return {
        ok: status === 200,
        status,
        statusText: status === 200 ? 'OK' : 'Refused',
        json: async () => body ?? { message: 'Not found' },
        text: async () => JSON.stringify(body ?? { message: 'Not found' }),
      }
    },
  })
