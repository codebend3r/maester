import type { Transport } from '@/apiClient/transport'
import { ROUTES } from '@/routes'
import {
  type AlbumMerge,
  type DirectoryListing,
  type DolbyVisionOnlyListing,
  type Duplicates,
  type HistoryEntry,
  type ItemSummary,
  type JoinRequest,
  type Library,
  type LibraryCounts,
  type LibraryHeroChange,
  type LibraryInput,
  type LibraryOrder,
  type LibraryViewChange,
  type MediaItem,
  type PosterEntry,
  type SmartMatchStarted,
  type Saga,
  type SagaBackdrop,
  type ShowListing,
  type SplitRequest,
  type UnmatchedFile,
} from '@/contract'
import { type MediaListOptions, mediaListQuery } from '@/mediaListQuery'

type UpdateLibraryProps = { id: number; input: LibraryInput }

type SetLibraryViewProps = { id: number; change: LibraryViewChange }

type SetLibraryInHeroProps = { id: number } & LibraryHeroChange

type ListMediaProps = { libraryId: number } & MediaListOptions

type SetSagaBackdropProps = {
  libraryId: number
  sagaId: Saga['tmdbId']
  backdrop: SagaBackdrop
}

type SplitDuplicateProps = { libraryId: number } & SplitRequest

type JoinSplitProps = { libraryId: number } & JoinRequest

type ListHistoryProps = {
  libraryId: number
  limit: number
  watchedOnly?: boolean
}

/** The libraries: each one's settings, scans and matching, and the lists it is read as. */
export const libraryCalls = ({ ask, tell }: Transport) => ({
  listLibraries: (): Promise<Library[]> => ask({ route: ROUTES.listLibraries }),

  getLibrary: (id: number): Promise<Library> => ask({ route: ROUTES.getLibrary, params: { id } }),

  createLibrary: (input: LibraryInput): Promise<Library> =>
    ask({ route: ROUTES.createLibrary, body: input }),

  updateLibrary: ({ id, input }: UpdateLibraryProps): Promise<Library> =>
    ask({ route: ROUTES.updateLibrary, params: { id }, body: input }),

  /** How a library is laid out, or its pin: what any viewer may change, the admin lock on or off. */
  setLibraryView: ({ id, change }: SetLibraryViewProps): Promise<Library> =>
    ask({ route: ROUTES.setLibraryView, params: { id }, body: change }),

  /** Includes a library's titles in home's hero, or leaves them out; the admin's. */
  setLibraryInHero: ({ id, inHero }: SetLibraryInHeroProps): Promise<Library> =>
    ask({
      route: ROUTES.setLibraryInHero,
      params: { id },
      body: { inHero } satisfies LibraryHeroChange,
    }),

  /** Lists the libraries in the order of `ids`, which names every one; the admin's. */
  reorderLibraries: async ({ ids }: LibraryOrder): Promise<void> => {
    await tell({ route: ROUTES.reorderLibraries, body: { ids } satisfies LibraryOrder })
  },

  deleteLibrary: async (id: number): Promise<void> => {
    await tell({ route: ROUTES.deleteLibrary, params: { id } })
  },

  scanLibraryMarkers: (id: number): Promise<Library> =>
    ask({ route: ROUTES.scanLibraryMarkers, params: { id } }),

  /** A full scan: every file in the library read again. */
  scanLibrary: (id: number): Promise<Library> => ask({ route: ROUTES.scanLibrary, params: { id } }),

  /** Stops a full scan under way; the admin's. */
  cancelScan: (id: number): Promise<Library> => ask({ route: ROUTES.cancelScan, params: { id } }),

  /**
   * A quick scan: only what is new is read and added to the library, and
   * the ratings of the new titles are fetched once they are matched.
   */
  quickScanLibrary: (id: number): Promise<Library> =>
    ask({ route: ROUTES.quickScanLibrary, params: { id } }),

  /** Stops a quick scan under way, and the ratings that would follow it. */
  cancelQuickScan: (id: number): Promise<Library> =>
    ask({ route: ROUTES.cancelQuickScan, params: { id } }),

  /** Update ratings: the ratings of every title in the library that has none are fetched. */
  updateLibraryRatings: (id: number): Promise<Library> =>
    ask({ route: ROUTES.updateLibraryRatings, params: { id } }),

  /** Stops Update ratings: the titles still waiting are not asked for, and the ratings fetched stay. */
  cancelLibraryRatings: (id: number): Promise<Library> =>
    ask({ route: ROUTES.cancelLibraryRatings, params: { id } }),

  /** Match again: TMDB is searched once more for the library's files no movie or show was found for. */
  matchLibrary: (id: number): Promise<Library> =>
    ask({ route: ROUTES.matchLibrary, params: { id } }),

  /** Looks through a music library and folds albums that are the same release into one; how many went. */
  mergeLibraryAlbums: (id: number): Promise<AlbumMerge> =>
    ask({ route: ROUTES.mergeLibraryAlbums, params: { id } }),

  /**
   * Smart match: a music library's unmatched albums are folded into the album
   * of their folder where one holds them, and the rest searched again harder,
   * with Claude's help; each outcome arrives as a notification. How many albums it looks at.
   */
  smartMatchAlbums: (id: number): Promise<SmartMatchStarted> =>
    ask({ route: ROUTES.smartMatchAlbums, params: { id } }),

  /** `seed` only counts with a random sort: the same seed deals the same order. */
  listMedia: ({ libraryId, ...options }: ListMediaProps): Promise<MediaItem[]> =>
    ask({
      route: ROUTES.listMedia,
      params: { id: libraryId },
      query: mediaListQuery.params(options),
    }),

  /**
   * A TV shows library as shows: one entry each, with the files no show
   * was found for after. `seed` counts as it does for `listMedia`.
   */
  listShows: ({ libraryId, ...options }: ListMediaProps): Promise<ShowListing> =>
    ask({
      route: ROUTES.listShows,
      params: { id: libraryId },
      query: mediaListQuery.params(options),
    }),

  /** How much each of a library's tabs holds for this account, but All and Not matched, which the library counts. */
  getLibraryCounts: (libraryId: number): Promise<LibraryCounts> =>
    ask({ route: ROUTES.getLibraryCounts, params: { id: libraryId } }),

  /** A library's videos with a saved spot, the most recently watched first, each with its poster. */
  listInProgress: (libraryId: number): Promise<PosterEntry[]> =>
    ask({ route: ROUTES.listInProgress, params: { id: libraryId } }),

  /** A library's favourites, most recently marked first, each with its poster. */
  listLibraryFavourites: (libraryId: number): Promise<PosterEntry[]> =>
    ask({ route: ROUTES.listLibraryFavourites, params: { id: libraryId } }),

  /** A library's favourite shows and seasons, most recently marked first. */
  listLibraryFavouriteTitles: (libraryId: number): Promise<ItemSummary[]> =>
    ask({ route: ROUTES.listLibraryFavouriteTitles, params: { id: libraryId } }),

  /** A movie library's sagas of two movies or more, by name, each oldest first. */
  listSagas: (libraryId: number): Promise<Saga[]> =>
    ask({ route: ROUTES.listSagas, params: { id: libraryId } }),

  /** Picks what a saga's page shows behind its title; answers with what was saved. */
  setSagaBackdrop: ({ libraryId, sagaId, backdrop }: SetSagaBackdropProps): Promise<SagaBackdrop> =>
    ask({
      route: ROUTES.setSagaBackdrop,
      params: { id: libraryId, sagaId },
      body: backdrop,
    }),

  /** A library's files no movie or show was found for, each with the AI lookup's suggestion for its folder. */
  listUnmatched: (libraryId: number): Promise<UnmatchedFile[]> =>
    ask({ route: ROUTES.listUnmatched, params: { id: libraryId } }),

  /** What in a library is Dolby Vision profile 5: its shows with how many episodes are, and its other such files. */
  listDolbyVisionOnly: (libraryId: number): Promise<DolbyVisionOnlyListing> =>
    ask({ route: ROUTES.listDolbyVisionOnly, params: { id: libraryId } }),

  /** A movie library's movies with more than one file, each with its cards, split apart or not. */
  listDuplicates: (libraryId: number): Promise<Duplicates> =>
    ask({ route: ROUTES.listDuplicates, params: { id: libraryId } }),

  /** Splits the card `mediaId` is on, every file apart or by cut; answers with the duplicates as they stand after. */
  splitDuplicate: ({ libraryId, mediaId, how }: SplitDuplicateProps): Promise<Duplicates> =>
    ask({
      route: ROUTES.splitDuplicate,
      params: { id: libraryId },
      body: { mediaId, how } satisfies SplitRequest,
    }),

  /** Puts a movie's files back on one card; answers with the duplicates as they stand after. */
  joinSplit: ({ libraryId, itemId }: JoinSplitProps): Promise<Duplicates> =>
    ask({
      route: ROUTES.joinSplit,
      params: { id: libraryId },
      body: { itemId } satisfies JoinRequest,
    }),

  /**
   * A library's played videos by when they last played, most recent first,
   * at most `limit` of them; `watchedOnly` keeps those that count as watched.
   */
  listHistory: ({
    libraryId,
    limit,
    watchedOnly = false,
  }: ListHistoryProps): Promise<HistoryEntry[]> => {
    return ask({
      route: ROUTES.listHistory,
      params: { id: libraryId },
      query: { limit: String(limit), ...(watchedOnly ? { watched: 'true' } : {}) },
    })
  },

  /** The server's folders, for picking a library's paths. */
  browse: (path?: string): Promise<DirectoryListing> => {
    return ask({ route: ROUTES.browse, query: path ? { path } : {} })
  },
})
