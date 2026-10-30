import { keepPreviousData, queryOptions, skipToken } from '@tanstack/react-query'
import {
  ADMIN_LOCK_STATES,
  FILMOGRAPHY_STATES,
  type ApiClient,
  type MatchItemType,
  type MatchSubject,
  type MediaSort,
  type MusicSort,
  type ViewingSession,
  asksServerForNext,
} from '@raven/core'
import { LISTING_GC_MS, queryKeys } from '@/query/queryClient'
import { playerQueriesFor } from '@/lib/playerQueries'

/** What a history lists: what was watched by the library's own measure, or everything that played. */
export const HISTORY_SHOWS = { watched: 'watched', all: 'all' } as const

export type HistoryShow = (typeof HISTORY_SHOWS)[keyof typeof HISTORY_SHOWS]

type Listing = { libraryId: number; search: string; sort: MediaSort; seed: number }

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
  type RavenQueriesForAlbumsQueryProps = { libraryId: number; search: string; sort: MusicSort }
  type RavenQueriesForArtistsQueryProps = { libraryId: number; search: string }
  type RavenQueriesForAlbumMatchSearchQueryProps = { albumId: number; query: string }

  type RavenQueriesForMatchSearchQueryProps = {
    type: MatchItemType
    query: string
    year: number | null
    libraryId: number | null
    subject: MatchSubject | null
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

    albumsQuery: ({ libraryId, search, sort }: RavenQueriesForAlbumsQueryProps) =>
      queryOptions({
        queryKey: queryKeys.albums({ libraryId, search, sort }),
        queryFn: () => api.listAlbums({ libraryId, search, sort }),
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
