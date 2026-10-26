import { describe, expect, it } from 'bun:test'
import {
  type FetchQueryOptions,
  QueryClient,
  type QueryKey,
  skipToken,
} from '@tanstack/react-query'
import { type ApiClient, ITEM_TYPES, MATCH_SUBJECT_KINDS, MEDIA_SORTS } from '@raven/core'
import { queryKeys } from '@/query/queryClient'
import { HISTORY_SHOWS, type RavenQueries, ravenQueriesFor } from '@/query/ravenQueries'
import { itemDetails } from '@/test/fixtures'
import { recordingApi } from '@/test/recordingApi'

/** The addresses a run asks the server for, whether or not the answer passes its guard. */
const requested = async (run: (api: ApiClient) => Promise<unknown>): Promise<string[]> => {
  const { api, calls } = recordingApi({ body: null })
  await run(api).catch(() => null)
  return calls.map(({ url }) => url)
}

/** A query of `ravenQueriesFor`, picked out by what it is called with. */
type QueryPick<TData, TKey extends QueryKey> = (
  queries: RavenQueries,
) => FetchQueryOptions<TData, Error, TData, TKey>

type AskingProps<TData, TKey extends QueryKey> = {
  name: string
  key: QueryKey
  pick: QueryPick<TData, TKey>
  call: (api: ApiClient) => Promise<unknown>
}

/**
 * A query, the key it is filed under, and the call it makes, so a query
 * asks the server just as calling the client does.
 */
const asking = <TData, TKey extends QueryKey>({
  name,
  key,
  pick,
  call,
}: AskingProps<TData, TKey>) => ({
  name,
  key,
  keyOf: (queries: RavenQueries): QueryKey => pick(queries).queryKey,
  fetch: (api: ApiClient): Promise<TData> =>
    new QueryClient().fetchQuery(pick(ravenQueriesFor(api))),
  call,
})

type WaitingProps<TData, TKey extends QueryKey> = {
  name: string
  key: QueryKey
  pick: QueryPick<TData, TKey>
}

/** A query still waiting on what it needs, and the key it is filed under meanwhile. */
const waiting = <TData, TKey extends QueryKey>({ name, key, pick }: WaitingProps<TData, TKey>) => ({
  name,
  key,
  keyOf: (queries: RavenQueries): QueryKey => pick(queries).queryKey,
  queryFnOf: (queries: RavenQueries): unknown => pick(queries).queryFn,
})

const LISTING = { libraryId: 2, search: 'bus', sort: MEDIA_SORTS.title, seed: 4 } as const
const MATCH = {
  type: ITEM_TYPES.movie,
  query: 'Busboys',
  year: 2026,
  libraryId: 2,
  subject: { kind: MATCH_SUBJECT_KINDS.media, id: 7 },
} as const

/** Every query that asks the server for something. */
const QUERIES = [
  asking({
    name: 'librariesQuery',
    key: queryKeys.libraries,
    pick: (queries) => queries.librariesQuery,
    call: (api) => api.listLibraries(),
  }),
  asking({
    name: 'libraryQuery',
    key: queryKeys.library(2),
    pick: (queries) => queries.libraryQuery(2),
    call: (api) => api.getLibrary(2),
  }),
  asking({
    name: 'mediaListQuery',
    key: queryKeys.media(LISTING),
    pick: (queries) => queries.mediaListQuery(LISTING),
    call: (api) => api.listMedia(LISTING),
  }),
  asking({
    name: 'showListQuery',
    key: queryKeys.shows(LISTING),
    pick: (queries) => queries.showListQuery(LISTING),
    call: (api) => api.listShows(LISTING),
  }),
  asking({
    name: 'historyQuery for what was watched',
    key: queryKeys.history({ libraryId: 2, show: HISTORY_SHOWS.watched, limit: 50 }),
    pick: (queries) =>
      queries.historyQuery({ libraryId: 2, show: HISTORY_SHOWS.watched, limit: 50 }),
    call: (api) => api.listHistory({ libraryId: 2, limit: 50, watchedOnly: true }),
  }),
  asking({
    name: 'historyQuery for everything that played',
    key: queryKeys.history({ libraryId: 2, show: HISTORY_SHOWS.all, limit: 50 }),
    pick: (queries) => queries.historyQuery({ libraryId: 2, show: HISTORY_SHOWS.all, limit: 50 }),
    call: (api) => api.listHistory({ libraryId: 2, limit: 50, watchedOnly: false }),
  }),
  asking({
    name: 'inProgressQuery',
    key: queryKeys.inProgress(2),
    pick: (queries) => queries.inProgressQuery(2),
    call: (api) => api.listInProgress(2),
  }),
  asking({
    name: 'libraryFavouritesQuery',
    key: queryKeys.libraryFavourites(2),
    pick: (queries) => queries.libraryFavouritesQuery(2),
    call: (api) => api.listLibraryFavourites(2),
  }),
  asking({
    name: 'sagasQuery',
    key: queryKeys.sagas(2),
    pick: (queries) => queries.sagasQuery(2),
    call: (api) => api.listSagas(2),
  }),
  asking({
    name: 'unmatchedQuery',
    key: queryKeys.unmatched(2),
    pick: (queries) => queries.unmatchedQuery(2),
    call: (api) => api.listUnmatched(2),
  }),
  asking({
    name: 'duplicatesQuery',
    key: queryKeys.duplicates(2),
    pick: (queries) => queries.duplicatesQuery(2),
    call: (api) => api.listDuplicates(2),
  }),
  asking({
    name: 'favouritesQuery',
    key: queryKeys.favourites,
    pick: (queries) => queries.favouritesQuery,
    call: (api) => api.listFavourites(),
  }),
  asking({
    name: 'favouriteTitlesQuery',
    key: queryKeys.favouriteTitles,
    pick: (queries) => queries.favouriteTitlesQuery,
    call: (api) => api.listFavouriteTitles(),
  }),
  asking({
    name: 'homeQuery',
    key: queryKeys.home,
    pick: (queries) => queries.homeQuery,
    call: (api) => api.getHome(),
  }),
  asking({
    name: 'homeSearchQuery',
    key: queryKeys.homeSearch('bus'),
    pick: (queries) => queries.homeSearchQuery('bus'),
    call: (api) => api.searchHome('bus'),
  }),
  asking({
    name: 'mediaQuery',
    key: queryKeys.mediaItem(7),
    pick: (queries) => queries.mediaQuery(7),
    call: (api) => api.getMedia(7),
  }),
  asking({
    name: 'tracksQuery',
    key: queryKeys.mediaTracks(7),
    pick: (queries) => queries.tracksQuery(7),
    call: (api) => api.getTracks(7),
  }),
  asking({
    name: 'mediaLocationQuery',
    key: queryKeys.mediaLocation(7),
    pick: (queries) => queries.mediaLocationQuery(7),
    call: (api) => api.getMediaLocation(7),
  }),
  asking({
    name: 'itemImagesQuery',
    key: queryKeys.itemImages(40),
    pick: (queries) => queries.itemImagesQuery(40),
    call: (api) => api.getItemImages(40),
  }),
  asking({
    name: 'itemMetadataQuery',
    key: queryKeys.itemMetadata(40),
    pick: (queries) => queries.itemMetadataQuery(40),
    call: (api) => api.getItemMetadata(40),
  }),
  asking({
    name: 'nextEpisodeQuery',
    key: queryKeys.nextEpisode(4),
    pick: (queries) => queries.nextEpisodeQuery(4),
    call: (api) => api.nextEpisode(4),
  }),
  asking({
    name: 'personQuery',
    key: queryKeys.person(3),
    pick: (queries) => queries.personQuery(3),
    call: (api) => api.getPerson(3),
  }),
  asking({
    name: 'matchSearchQuery',
    key: queryKeys.matchSearch(MATCH),
    pick: (queries) => queries.matchSearchQuery(MATCH),
    call: (api) => api.searchMatches(MATCH),
  }),
  asking({
    name: 'browseQuery at the top',
    key: queryKeys.browse(null),
    pick: (queries) => queries.browseQuery(null),
    call: (api) => api.browse(),
  }),
  asking({
    name: 'browseQuery in a folder',
    key: queryKeys.browse('/media'),
    pick: (queries) => queries.browseQuery('/media'),
    call: (api) => api.browse('/media'),
  }),
  asking({
    name: 'lockQuery',
    key: queryKeys.lock,
    pick: (queries) => queries.lockQuery,
    call: (api) => api.getLock(),
  }),
  asking({
    name: 'adminLockQuery',
    key: queryKeys.adminLock,
    pick: (queries) => queries.adminLockQuery,
    call: (api) => api.getAdminLock(),
  }),
  asking({
    name: 'liveStreamsQuery',
    key: queryKeys.liveStreams,
    pick: (queries) => queries.liveStreamsQuery,
    call: (api) => api.listLiveStreams(),
  }),
  asking({
    name: 'bugReportsQuery',
    key: queryKeys.bugReports,
    pick: (queries) => queries.bugReportsQuery,
    call: (api) => api.listBugReports(),
  }),
  asking({
    name: 'metadataHealthQuery',
    key: queryKeys.metadataHealth,
    pick: (queries) => queries.metadataHealthQuery,
    call: (api) => api.getMetadataHealth(),
  }),
  asking({
    name: 'playbackSettingsQuery',
    key: queryKeys.playbackSettings,
    pick: (queries) => queries.playbackSettingsQuery,
    call: (api) => api.getPlaybackSettings(),
  }),
  asking({
    name: 'displaySettingsQuery',
    key: queryKeys.displaySettings,
    pick: (queries) => queries.displaySettingsQuery,
    call: (api) => api.getDisplaySettings(),
  }),
  asking({
    name: 'authConfigQuery',
    key: queryKeys.authConfig,
    pick: (queries) => queries.authConfigQuery,
    call: (api) => api.getAuthConfig(),
  }),
  asking({
    name: 'accountQuery',
    key: queryKeys.account('user-1'),
    pick: (queries) => queries.accountQuery('user-1'),
    call: (api) => api.getMe(),
  }),
  asking({
    name: 'membersQuery',
    key: queryKeys.members('user-1'),
    pick: (queries) => queries.membersQuery('user-1'),
    call: (api) => api.listMembers(),
  }),
]

/** Queries still waiting on what they need, which ask the server for nothing until it comes. */
const WAITING = [
  waiting({
    name: 'libraryQuery',
    key: queryKeys.library(null),
    pick: (queries) => queries.libraryQuery(null),
  }),
  waiting({
    name: 'historyQuery',
    key: queryKeys.history({ libraryId: null, show: HISTORY_SHOWS.all, limit: 50 }),
    pick: (queries) =>
      queries.historyQuery({ libraryId: null, show: HISTORY_SHOWS.all, limit: 50 }),
  }),
  waiting({
    name: 'sagasQuery',
    key: queryKeys.sagas(null),
    pick: (queries) => queries.sagasQuery(null),
  }),
  waiting({
    name: 'homeSearchQuery',
    key: queryKeys.homeSearch(''),
    pick: (queries) => queries.homeSearchQuery(''),
  }),
  waiting({
    name: 'mediaQuery',
    key: queryKeys.mediaItem(null),
    pick: (queries) => queries.mediaQuery(null),
  }),
  waiting({
    name: 'itemQuery',
    key: queryKeys.item(null),
    pick: (queries) => queries.itemQuery(null),
  }),
  waiting({
    name: 'personQuery',
    key: queryKeys.person(null),
    pick: (queries) => queries.personQuery(null),
  }),
  waiting({
    name: 'matchSearchQuery',
    key: queryKeys.matchSearch({ ...MATCH, query: '' }),
    pick: (queries) => queries.matchSearchQuery({ ...MATCH, query: '' }),
  }),
  waiting({
    name: 'accountQuery',
    key: queryKeys.account(null),
    pick: (queries) => queries.accountQuery(null),
  }),
]

describe('ravenQueriesFor', () => {
  it('keys an item under its shared key and fetches it through the client it is given', async () => {
    const item = itemDetails({ id: 5 })
    const { api, calls } = recordingApi({ body: item })
    const query = ravenQueriesFor(api).itemQuery(5)
    const cache = new QueryClient()
    expect(queryKeys.item(5)).toEqual(query.queryKey)
    expect(await cache.fetchQuery(query)).toEqual(item)
    expect(calls.map(({ url }) => url)).toEqual(['/api/items/5'])
    cache.clear()
  })

  QUERIES.forEach(({ name, key, keyOf, fetch, call }) =>
    it(`${name} is filed under its key and asks as the client does`, async () => {
      expect(key).toEqual(keyOf(ravenQueriesFor(recordingApi({ body: null }).api)))
      const asked = await requested(fetch)
      expect(asked).toHaveLength(1)
      expect(asked).toEqual(await requested(call))
    }),
  )

  WAITING.forEach(({ name, key, keyOf, queryFnOf }) =>
    it(`${name} asks for nothing while it waits`, () => {
      const queries = ravenQueriesFor(recordingApi({ body: null }).api)
      expect(key).toEqual(keyOf(queries))
      expect(queryFnOf(queries)).toBe(skipToken)
    }),
  )
})
