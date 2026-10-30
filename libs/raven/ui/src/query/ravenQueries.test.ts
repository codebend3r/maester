import { describe, expect, it } from 'bun:test'
import {
  type FetchQueryOptions,
  QueryClient,
  type QueryKey,
  skipToken,
} from '@tanstack/react-query'
import {
  ALBUM_TYPES,
  type AlbumSummary,
  type ApiClient,
  createApiClient,
  ITEM_TYPES,
  MATCH_STATES,
  MATCH_SUBJECT_KINDS,
  MEDIA_SORTS,
  MUSIC_PAGE,
  MUSIC_SORTS,
} from '@raven/core'
import { queryKeys } from '@/query/queryClient'
import { HISTORY_SHOWS, type RavenQueries, ravenQueriesFor } from '@/query/ravenQueries'
import { useQuery } from '@tanstack/react-query'
import { waitFor } from '@testing-library/react'
import { itemDetails, track } from '@/test/fixtures'
import { renderQueryHook } from '@/test/renderQueryHook'
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

const ALBUM: AlbumSummary = {
  id: 1,
  libraryId: 2,
  title: 'OK Computer',
  sortTitle: 'OK Computer',
  year: 1997,
  type: ALBUM_TYPES.album,
  artists: [{ id: 1, name: 'Radiohead' }],
  isCompilation: false,
  trackCount: 12,
  duration: 3200,
  coverVersion: null,
  match: MATCH_STATES.matched,
  addedAt: '2026-01-01T00:00:00Z',
}

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
    name: 'favouriteAlbumsQuery',
    key: queryKeys.favouriteAlbums,
    pick: (queries) => queries.favouriteAlbumsQuery,
    call: (api) => api.listFavouriteAlbums(),
  }),
  asking({
    name: 'favouriteArtistsQuery',
    key: queryKeys.favouriteArtists,
    pick: (queries) => queries.favouriteArtistsQuery,
    call: (api) => api.listFavouriteArtists(),
  }),
  asking({
    name: 'playlistsQuery',
    key: queryKeys.playlistList,
    pick: (queries) => queries.playlistsQuery,
    call: (api) => api.listPlaylists(),
  }),
  asking({
    name: 'playlistQuery',
    key: queryKeys.playlist(5),
    pick: (queries) => queries.playlistQuery(5),
    call: (api) => api.getPlaylist(5),
  }),
  asking({
    name: 'lyricsQuery',
    key: queryKeys.lyrics(101),
    pick: (queries) => queries.lyricsQuery(101),
    call: (api) => api.getLyrics(101),
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
    key: queryKeys.itemImagesIn({ id: 40, libraryId: 3 }),
    pick: (queries) => queries.itemImagesQuery({ id: 40, libraryId: 3 }),
    call: (api) => api.getItemImages({ id: 40, libraryId: 3 }),
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
    name: 'playlistQuery',
    key: queryKeys.playlist(null),
    pick: (queries) => queries.playlistQuery(null),
  }),
  waiting({
    name: 'lyricsQuery',
    key: queryKeys.lyrics(null),
    pick: (queries) => queries.lyricsQuery(null),
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

  it("reads an audiobook's chapters from its markers, under their key, and asks nothing for no track", async () => {
    const chapters = [{ start: 0, end: 60, title: 'Opening' }]
    const { api, calls } = recordingApi({ body: { intro: null, credits: null, chapters } })
    const query = ravenQueriesFor(api).chaptersQuery(7)
    expect(queryKeys.markers(7)).toEqual(query.queryKey)
    const cache = new QueryClient()
    const { result } = renderQueryHook({ client: cache, hook: () => useQuery(query) })
    await waitFor(() => expect(result.current.data).toEqual(chapters))
    expect(calls.map(({ url }) => url)).toEqual(['/api/media/7/markers'])
    expect(ravenQueriesFor(api).chaptersQuery(null).queryFn).toBe(skipToken)
    cache.clear()
  })

  it("keeps a library's newest albums, asking for them newest first", async () => {
    const albums = [1, 2, 3].map((id) => ({ ...ALBUM, id }))
    const { api, calls } = recordingApi({ body: albums })
    const query = ravenQueriesFor(api).recentAlbumsQuery({ libraryId: 2, limit: 2 })
    expect(queryKeys.recentAlbums({ libraryId: 2, limit: 2 })).toEqual(query.queryKey)
    const cache = new QueryClient()
    const { result } = renderQueryHook({ client: cache, hook: () => useQuery(query) })
    await waitFor(() => expect(result.current.data?.map(({ id }) => id)).toEqual([1, 2]))
    expect(calls.map(({ url }) => url)).toEqual(['/api/libraries/2/albums?sort=added&limit=2'])
    cache.clear()
  })

  it("pages through each library's songs to its end, then the next library's", async () => {
    const { api, calls } = recordingApi({ body: { tracks: [track()], total: 2 } })
    const query = ravenQueriesFor(api).songsQuery({
      libraryIds: [2, 3],
      search: '',
      sort: MUSIC_SORTS.title,
    })
    const cache = new QueryClient()
    const songs = await cache.fetchInfiniteQuery({ ...query, pages: 4 })
    const page = `limit=${MUSIC_PAGE.most}`
    expect(calls.map(({ url }) => url)).toEqual([
      `/api/libraries/2/tracks?sort=title&${page}`,
      `/api/libraries/2/tracks?sort=title&${page}&offset=1`,
      `/api/libraries/3/tracks?sort=title&${page}`,
      `/api/libraries/3/tracks?sort=title&${page}&offset=1`,
    ])
    expect(songs.pages).toHaveLength(4)
    expect(query.getNextPageParam(songs.pages[3]!, songs.pages, { at: 1, offset: 1 }, [])).toBe(
      null,
    )
    expect(
      ravenQueriesFor(api).songsQuery({ libraryIds: [], search: '', sort: MUSIC_SORTS.title })
        .queryFn,
    ).toBe(skipToken)
    cache.clear()
  })

  it('passes over a library with no songs, so no page between two others is empty', async () => {
    const asked: string[] = []
    const api = createApiClient({
      fetch: async (url) => {
        asked.push(url)
        const body = url.includes('/libraries/3/')
          ? { tracks: [], total: 0 }
          : { tracks: [track()], total: 1 }
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          json: async () => body,
          text: async () => JSON.stringify(body),
        }
      },
    })
    const query = ravenQueriesFor(api).songsQuery({
      libraryIds: [2, 3, 4],
      search: '',
      sort: MUSIC_SORTS.title,
    })
    const cache = new QueryClient()
    const songs = await cache.fetchInfiniteQuery({ ...query, pages: 3 })
    expect(songs.pages.map(({ at, tracks }) => [at, tracks.length])).toEqual([
      [0, 1],
      [2, 1],
    ])
    expect(asked.map((url) => url.split('?')[0])).toEqual([
      '/api/libraries/2/tracks',
      '/api/libraries/3/tracks',
      '/api/libraries/4/tracks',
    ])
    cache.clear()
  })

  it('ends with an empty page when the last libraries have no songs', async () => {
    const { api } = recordingApi({ body: { tracks: [], total: 0 } })
    const query = ravenQueriesFor(api).songsQuery({
      libraryIds: [2, 3],
      search: '',
      sort: MUSIC_SORTS.title,
    })
    const cache = new QueryClient()
    const songs = await cache.fetchInfiniteQuery(query)
    expect(songs.pages).toEqual([{ tracks: [], total: 0, at: 1, offset: 0 }])
    expect(query.getNextPageParam(songs.pages[0]!, songs.pages, { at: 0, offset: 0 }, [])).toBe(
      null,
    )
    cache.clear()
  })

  WAITING.forEach(({ name, key, keyOf, queryFnOf }) =>
    it(`${name} asks for nothing while it waits`, () => {
      const queries = ravenQueriesFor(recordingApi({ body: null }).api)
      expect(key).toEqual(keyOf(queries))
      expect(queryFnOf(queries)).toBe(skipToken)
    }),
  )
})
