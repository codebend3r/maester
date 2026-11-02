import {
  infiniteQueryOptions,
  keepPreviousData,
  queryOptions,
  skipToken,
} from '@tanstack/react-query'
import {
  ADMIN_LOCK_STATES,
  FILMOGRAPHY_STATES,
  MUSIC_PAGE,
  MUSIC_SORTS,
  type MusicListOptions,
  type ApiClient,
  type MatchItemType,
  type MatchSubject,
  type MediaSort,
  type MixKind,
  type MusicSort,
  type TrackPage,
  type ViewingSession,
  asksServerForNext,
} from '@raven/core'
import { LISTING_GC_MS, queryKeys } from '@/query/queryClient'
import { playerQueriesFor } from '@/lib/playerQueries'

/** What a history lists: what was watched by the library's own measure, or everything that played. */
export const HISTORY_SHOWS = { watched: 'watched', all: 'all' } as const

export type HistoryShow = (typeof HISTORY_SHOWS)[keyof typeof HISTORY_SHOWS]

type Listing = { libraryId: number; search: string; sort: MediaSort; seed: number }

/** Where the next page of songs starts: which of the libraries, and how far into it. */
type SongsPage = { at: number; offset: number }

const FIRST_SONGS_PAGE: SongsPage = { at: 0, offset: 0 }

/** How long a person's page waits between asks while their filmography is on its way. */
const FILMOGRAPHY_POLL_MS = 1_500

/** A moment past when a lock on its way is due, so the server holds it by the time it is asked. */
const PAST_DUE_MS = 250

/** How often the Streams page asks who is streaming: often enough that Stop answers and a new stream shows within moments. */
const LIVE_STREAMS_POLL_MS = 2000

/**
 * What each query fetches from `api` and how long it keeps, paired with its
 * key once, so every page asking for the same thing asks the same way. A
 * page adds only what is its own: when to poll, whether it may run yet.
 */
export const ravenQueriesFor = (api: ApiClient) => {
  const playerQueries = playerQueriesFor(api)
  type RavenQueriesForHistoryQueryProps = {
    libraryId: number | null
    show: HistoryShow
    limit: number
  }
  type RavenQueriesForNextInSessionQueryProps = { id: number; session: ViewingSession }
  type RavenQueriesForItemImagesQueryProps = { id: number; libraryId: number }
  type RavenQueriesForAlbumsQueryProps = {
    libraryId: number
    search: string
    sort: MusicSort
  } & Pick<MusicListOptions, 'order' | 'seed'>
  type RavenQueriesForArtistsQueryProps = { libraryId: number; search: string }
  type RavenQueriesForRecentAlbumsQueryProps = { libraryId: number; limit: number }
  type RavenQueriesForSongsQueryProps = {
    libraryIds: readonly number[]
    search: string
    sort: MusicSort
  }
  type RavenQueriesForAlbumMatchSearchQueryProps = { albumId: number; query: string }

  type RavenQueriesForMatchSearchQueryProps = {
    type: MatchItemType
    query: string
    year: number | null
    libraryId: number | null
    subject: MatchSubject | null
  }

  type SongsFromProps = RavenQueriesForSongsQueryProps & { from: SongsPage }

  /**
   * A page of songs from `from` on, with where it was read. A library that has none there is
   * passed over for the next one's first page, so a page is empty only at the end of the last
   * library, and a list asking near its end always gets rows or the end.
   */
  const songsFrom = async ({
    libraryIds,
    search,
    sort,
    from: { at, offset },
  }: SongsFromProps): Promise<TrackPage & SongsPage> => {
    const libraryId = libraryIds[at]
    if (libraryId === undefined) throw new Error(`No music library at ${at}`)
    const page = await api.listTracks({ libraryId, search, sort, limit: MUSIC_PAGE.most, offset })
    if (page.tracks.length > 0 || at + 1 >= libraryIds.length) return { ...page, at, offset }
    return songsFrom({ libraryIds, search, sort, from: { at: at + 1, offset: 0 } })
  }

  return {
    librariesQuery: queryOptions({
      queryKey: queryKeys.libraries,
      queryFn: () => api.listLibraries(),
    }),

    libraryQuery: (id: number | null) =>
      queryOptions({
        queryKey: queryKeys.library(id),
        queryFn: id == null ? skipToken : () => api.getLibrary(id),
      }),

    mediaListQuery: (listing: Listing) =>
      queryOptions({
        queryKey: queryKeys.media(listing),
        queryFn: () => api.listMedia(listing),
        gcTime: LISTING_GC_MS,
        placeholderData: keepPreviousData,
      }),

    showListQuery: (listing: Listing) =>
      queryOptions({
        queryKey: queryKeys.shows(listing),
        queryFn: () => api.listShows(listing),
        gcTime: LISTING_GC_MS,
        placeholderData: keepPreviousData,
      }),

    historyQuery: ({ libraryId, show, limit }: RavenQueriesForHistoryQueryProps) =>
      queryOptions({
        queryKey: queryKeys.history({ libraryId, show, limit }),
        queryFn:
          libraryId == null
            ? skipToken
            : () =>
                api.listHistory({ libraryId, limit, watchedOnly: show === HISTORY_SHOWS.watched }),
        placeholderData: keepPreviousData,
      }),

    /** How much each tab holds; under the library's key, so whatever reads the libraries again reads it again too. */
    libraryCountsQuery: (libraryId: number) =>
      queryOptions({
        queryKey: queryKeys.libraryCounts(libraryId),
        queryFn: () => api.getLibraryCounts(libraryId),
      }),

    inProgressQuery: (libraryId: number) =>
      queryOptions({
        queryKey: queryKeys.inProgress(libraryId),
        queryFn: () => api.listInProgress(libraryId),
      }),

    libraryFavouritesQuery: (libraryId: number) =>
      queryOptions({
        queryKey: queryKeys.libraryFavourites(libraryId),
        queryFn: () => api.listLibraryFavourites(libraryId),
      }),

    sagasQuery: (libraryId: number | null) =>
      queryOptions({
        queryKey: queryKeys.sagas(libraryId),
        queryFn: libraryId == null ? skipToken : () => api.listSagas(libraryId),
      }),

    unmatchedQuery: (libraryId: number) =>
      queryOptions({
        queryKey: queryKeys.unmatched(libraryId),
        queryFn: () => api.listUnmatched(libraryId),
      }),

    duplicatesQuery: (libraryId: number) =>
      queryOptions({
        queryKey: queryKeys.duplicates(libraryId),
        queryFn: () => api.listDuplicates(libraryId),
      }),

    favouritesQuery: queryOptions({
      queryKey: queryKeys.favourites,
      queryFn: () => api.listFavourites(),
    }),

    favouriteTitlesQuery: queryOptions({
      queryKey: queryKeys.favouriteTitles,
      queryFn: () => api.listFavouriteTitles(),
    }),

    homeQuery: queryOptions({
      queryKey: queryKeys.home,
      queryFn: () => api.getHome(),
    }),

    /** The titles home's hero takes turns with, read apart from the shelves. */
    heroQuery: queryOptions({
      queryKey: queryKeys.hero,
      queryFn: () => api.getHero(),
    }),

    /** A shelf of albums for each pinned music library, read apart from the shelves. */
    homeAlbumsQuery: queryOptions({
      queryKey: queryKeys.homeAlbums,
      queryFn: () => api.getHomeAlbums(),
    }),

    /** The admin's picks for the hero, and how many it holds at most. */
    heroPicksQuery: queryOptions({
      queryKey: queryKeys.heroPicks,
      queryFn: () => api.getHeroPicks(),
    }),

    /** What a search from home finds in every library; a blank one asks for nothing. */
    homeSearchQuery: (query: string) =>
      queryOptions({
        queryKey: queryKeys.homeSearch(query),
        queryFn: query === '' ? skipToken : () => api.searchHome(query),
        placeholderData: keepPreviousData,
      }),

    mediaQuery: (id: number | null) =>
      queryOptions({
        queryKey: queryKeys.mediaItem(id),
        queryFn: id == null ? skipToken : () => api.getMedia(id),
      }),

    /** What plays after a video in its session; a session whose next is not the server's asks nothing. */
    nextInSessionQuery: ({ id, session }: RavenQueriesForNextInSessionQueryProps) =>
      queryOptions({
        queryKey: queryKeys.nextInSession({ id, session }),
        queryFn: asksServerForNext(session) ? () => api.nextInSession({ id, session }) : skipToken,
      }),

    /** A file's markers change only when its file does or a detector or an admin finds new ones, so they are read once a session. */
    markersQuery: (id: number) =>
      queryOptions({
        queryKey: queryKeys.markers(id),
        queryFn: () => api.getMarkers(id),
        staleTime: Infinity,
      }),

    /** A file's tracks only change when the file does, and the scan stores them. */
    tracksQuery: playerQueries.tracks,

    /** The server probes a file for each answer, so a stream's card asks once, when it opens. */
    mediaStreamsQuery: playerQueries.streams,

    /** Where a file lives is read fresh each time its menu shows it. */
    mediaLocationQuery: (id: number) =>
      queryOptions({
        queryKey: queryKeys.mediaLocation(id),
        queryFn: () => api.getMediaLocation(id),
        staleTime: 0,
      }),

    itemQuery: (id: number | null) =>
      queryOptions({
        queryKey: queryKeys.item(id),
        queryFn: id == null ? skipToken : () => api.getItem(id),
      }),

    itemImagesQuery: ({ id, libraryId }: RavenQueriesForItemImagesQueryProps) =>
      queryOptions({
        queryKey: queryKeys.itemImagesIn({ id, libraryId }),
        queryFn: () => api.getItemImages({ id, libraryId }),
      }),

    itemMetadataQuery: (id: number) =>
      queryOptions({
        queryKey: queryKeys.itemMetadata(id),
        queryFn: () => api.getItemMetadata(id),
      }),

    nextEpisodeQuery: (showId: number) =>
      queryOptions({
        queryKey: queryKeys.nextEpisode(showId),
        queryFn: () => api.nextEpisode(showId),
      }),

    /**
     * A person, asked for again while the server says their filmography is
     * `pending`, which is also its answer when its line of lookups is full.
     * An ask can take the server 2.5 s to answer. A tick that comes round
     * mid-flight gets the fetch already going rather than a second one, and
     * the interval starts over once it settles, so asks never overlap.
     */
    personQuery: (id: number | null) =>
      queryOptions({
        queryKey: queryKeys.person(id),
        queryFn: id == null ? skipToken : () => api.getPerson(id),
        refetchInterval: (query) =>
          (query.state.data?.filmography.state ?? null) === FILMOGRAPHY_STATES.pending
            ? FILMOGRAPHY_POLL_MS
            : false,
      }),

    albumsQuery: (options: RavenQueriesForAlbumsQueryProps) =>
      queryOptions({
        queryKey: queryKeys.albums(options),
        queryFn: () => api.listAlbums(options),
        placeholderData: keepPreviousData,
        gcTime: LISTING_GC_MS,
      }),

    artistsQuery: ({ libraryId, search }: RavenQueriesForArtistsQueryProps) =>
      queryOptions({
        queryKey: queryKeys.artists({ libraryId, search }),
        queryFn: () => api.listArtists({ libraryId, search }),
        placeholderData: keepPreviousData,
        gcTime: LISTING_GC_MS,
      }),

    /** A music library's newest albums, newest first. */
    recentAlbumsQuery: ({ libraryId, limit }: RavenQueriesForRecentAlbumsQueryProps) =>
      queryOptions({
        queryKey: queryKeys.recentAlbums({ libraryId, limit }),
        queryFn: () => api.listAlbums({ libraryId, sort: MUSIC_SORTS.added, limit }),
        // The server lists a library's every album whatever the limit, so the newest are kept here.
        select: (albums) => albums.slice(0, limit),
      }),

    /**
     * The tracks of `libraryIds` as one list, `MUSIC_PAGE.most` a page: each library's to its
     * end, then the next library's from its start. None asks for nothing.
     */
    songsQuery: ({ libraryIds, search, sort }: RavenQueriesForSongsQueryProps) =>
      infiniteQueryOptions({
        queryKey: queryKeys.songs({ libraryIds, search, sort }),
        queryFn:
          libraryIds.length === 0
            ? skipToken
            : ({ pageParam }) => songsFrom({ libraryIds, search, sort, from: pageParam }),
        initialPageParam: FIRST_SONGS_PAGE,
        getNextPageParam: (last): SongsPage | null => {
          const next = last.offset + last.tracks.length
          if (last.tracks.length > 0 && next < last.total) return { at: last.at, offset: next }
          return last.at + 1 < libraryIds.length ? { at: last.at + 1, offset: 0 } : null
        },
        gcTime: LISTING_GC_MS,
      }),

    /** The account's mixes for today; each holds the same tracks all day. */
    mixesQuery: queryOptions({
      queryKey: queryKeys.mixes,
      queryFn: () => api.listMixes(),
    }),

    mixQuery: (id: MixKind | null) =>
      queryOptions({
        queryKey: queryKeys.mix(id),
        queryFn: id == null ? skipToken : () => api.getMix({ id }),
      }),

    /** The albums the account played last, and the albums added last. */
    recentMusicQuery: queryOptions({
      queryKey: queryKeys.recentMusic,
      queryFn: () => api.getRecentAlbums(),
    }),

    albumQuery: (id: number | null) =>
      queryOptions({
        queryKey: queryKeys.album(id),
        queryFn: id == null ? skipToken : () => api.getAlbum(id),
      }),

    artistQuery: (id: number | null) =>
      queryOptions({
        queryKey: queryKeys.artist(id),
        queryFn: id == null ? skipToken : () => api.getArtist(id),
      }),

    /** The account's favourite albums, across every library it may see. */
    favouriteAlbumsQuery: queryOptions({
      queryKey: queryKeys.favouriteAlbums,
      queryFn: () => api.listFavouriteAlbums(),
    }),

    /** The account's favourite artists. */
    favouriteArtistsQuery: queryOptions({
      queryKey: queryKeys.favouriteArtists,
      queryFn: () => api.listFavouriteArtists(),
    }),

    /** The account's playlists and every account's shared ones, most recently changed first. */
    playlistsQuery: queryOptions({
      queryKey: queryKeys.playlistList,
      queryFn: () => api.listPlaylists(),
    }),

    /**
     * Only the account's own playlists, the ones it may add to; under the
     * same key as `playlistsQuery`, so they share the cache and its invalidations.
     */
    ownPlaylistsQuery: queryOptions({
      queryKey: queryKeys.playlistList,
      queryFn: () => api.listPlaylists(),
      select: (list) => list.filter(({ isOwn }) => isOwn),
    }),

    playlistQuery: (id: number | null) =>
      queryOptions({
        queryKey: queryKeys.playlist(id),
        queryFn: id == null ? skipToken : () => api.getPlaylist(id),
      }),

    /** Each scrobbling service, whether this server offers it, and the account's name there once linked. */
    scrobblingQuery: queryOptions({
      queryKey: queryKeys.scrobbling,
      queryFn: () => api.getScrobbling(),
    }),

    /** A track's lyrics change only when its file or LRCLIB does, so they are read once a session. */
    lyricsQuery: (id: number | null) =>
      queryOptions({
        queryKey: queryKeys.lyrics(id),
        queryFn: id == null ? skipToken : () => api.getLyrics(id),
        staleTime: Infinity,
      }),

    /**
     * An audiobook's chapters, from the file's markers as the player reads
     * them; its intro is never asked for, since a chapter named like an
     * opening is still a chapter of the book.
     */
    chaptersQuery: (id: number | null) =>
      queryOptions({
        queryKey: queryKeys.markers(id),
        queryFn: id == null ? skipToken : () => api.getMarkers(id),
        staleTime: Infinity,
        select: (markers) => markers.chapters,
      }),

    /** MusicBrainz's releases for an album's Fix match; `query` '' searches by the album's own name. */
    albumMatchSearchQuery: ({ albumId, query }: RavenQueriesForAlbumMatchSearchQueryProps) =>
      queryOptions({
        queryKey: queryKeys.albumMatchSearch({ albumId, query }),
        queryFn: () => api.searchAlbumMatches({ albumId, query: query === '' ? undefined : query }),
        staleTime: Infinity,
        retry: false,
      }),

    /** A search for Fix match, scored against `subject` and best first; an empty title asks for nothing. */
    matchSearchQuery: ({
      type,
      query,
      year,
      libraryId,
      subject,
    }: RavenQueriesForMatchSearchQueryProps) =>
      queryOptions({
        queryKey: queryKeys.matchSearch({ type, query, year, libraryId, subject }),
        queryFn:
          query === ''
            ? skipToken
            : () => api.searchMatches({ type, query, year, libraryId, subject }),
        staleTime: 5 * 60_000,
      }),

    browseQuery: (path: string | null) =>
      queryOptions({
        queryKey: queryKeys.browse(path),
        queryFn: () => api.browse(path ?? undefined),
      }),

    lockQuery: queryOptions({ queryKey: queryKeys.lock, queryFn: () => api.getLock() }),

    /** Read again once a lock on its way holds, so every page can follow it. */
    adminLockQuery: queryOptions({
      queryKey: queryKeys.adminLock,
      queryFn: () => api.getAdminLock(),
      staleTime: 60_000,
      refetchInterval: (query) => {
        const lock = query.state.data
        if (lock === undefined || lock.state !== ADMIN_LOCK_STATES.turningOn) return false
        return lock.remainingMs + PAST_DUE_MS
      },
    }),

    /** Who is streaming right now. Admin only, so a page asks only while the admin lock is off. */
    liveStreamsQuery: queryOptions({
      queryKey: queryKeys.liveStreams,
      queryFn: () => api.listLiveStreams(),
      refetchInterval: LIVE_STREAMS_POLL_MS,
    }),

    /** Every bug report, newest first. Admin only, so a page asks only while the viewer may manage. */
    bugReportsQuery: queryOptions({
      queryKey: queryKeys.bugReports,
      queryFn: () => api.listBugReports(),
    }),

    metadataHealthQuery: queryOptions({
      queryKey: queryKeys.metadataHealth,
      queryFn: () => api.getMetadataHealth(),
      staleTime: 60_000,
    }),

    playbackSettingsQuery: playerQueries.playbackSettings,

    displaySettingsQuery: queryOptions({
      queryKey: queryKeys.displaySettings,
      queryFn: () => api.getDisplaySettings(),
      staleTime: 60_000,
    }),

    /** Whether accounts are on: the server's setting, which only a restart changes, so one read serves the visit. */
    authConfigQuery: queryOptions({
      queryKey: queryKeys.authConfig,
      queryFn: () => api.getAuthConfig(),
      staleTime: Infinity,
    }),

    /**
     * Who the signed-in user is. Keyed by user id so another account never reads
     * this one's answer, and never retried: a refusal is the answer.
     */
    accountQuery: (userId: string | null) =>
      queryOptions({
        queryKey: queryKeys.account(userId),
        queryFn: userId === null ? skipToken : () => api.getMe(),
        retry: false,
      }),

    /** Every account on this raven. Keyed by the owner asking, so another account never reads this list, and never retried: a refusal is the answer. */
    membersQuery: (userId: string) =>
      queryOptions({
        queryKey: queryKeys.members(userId),
        queryFn: () => api.listMembers(),
        retry: false,
      }),
  }
}

export type RavenQueries = ReturnType<typeof ravenQueriesFor>
