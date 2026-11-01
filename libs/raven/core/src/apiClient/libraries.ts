import type { Transport } from '@/apiClient/transport'
import {
  type DirectoryListing,
  type Duplicates,
  type HistoryEntry,
  isDirectoryListing,
  isDuplicates,
  isHistory,
  isLibrary,
  isLibraryCounts,
  isLibraryList,
  isMediaList,
  isPosterEntries,
  isSagaBackdrop,
  isSagaList,
  isShowListing,
  isUnmatchedList,
  type JoinRequest,
  type Library,
  type LibraryCounts,
  type LibraryHeroChange,
  type LibraryInput,
  type LibraryOrder,
  type LibraryViewChange,
  type MediaItem,
  type PosterEntry,
  type Saga,
  type SagaBackdrop,
  type ShowListing,
  type SplitRequest,
  type UnmatchedFile,
} from '@/contract'
import { type MediaListOptions, mediaListQuery } from '@/mediaListQuery'
import { toQueryString } from '@/query'

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
export const libraryCalls = ({ send, expect, libraryGet }: Transport) => ({
  listLibraries: (): Promise<Library[]> =>
    expect({ request: send({ path: '/api/libraries' }), guard: isLibraryList }),

  getLibrary: (id: number): Promise<Library> =>
    expect({ request: send({ path: `/api/libraries/${id}` }), guard: isLibrary }),

  createLibrary: (input: LibraryInput): Promise<Library> =>
    expect({
      request: send({ path: '/api/libraries', method: 'POST', body: input }),
      guard: isLibrary,
    }),

  updateLibrary: ({ id, input }: UpdateLibraryProps): Promise<Library> =>
    expect({
      request: send({ path: `/api/libraries/${id}`, method: 'PUT', body: input }),
      guard: isLibrary,
    }),

  /** How a library is laid out, or its pin: what any viewer may change, the admin lock on or off. */
  setLibraryView: ({ id, change }: SetLibraryViewProps): Promise<Library> =>
    expect({
      request: send({ path: `/api/libraries/${id}/view`, method: 'PUT', body: change }),
      guard: isLibrary,
    }),

  /** Includes a library's titles in home's hero, or leaves them out; the admin's. */
  setLibraryInHero: ({ id, inHero }: SetLibraryInHeroProps): Promise<Library> =>
    expect({
      request: send({
        path: `/api/libraries/${id}/hero`,
        method: 'PUT',
        body: { inHero } satisfies LibraryHeroChange,
      }),
      guard: isLibrary,
    }),

  /** Lists the libraries in the order of `ids`, which names every one; the admin's. */
  reorderLibraries: async ({ ids }: LibraryOrder): Promise<void> => {
    await send({
      path: '/api/libraries/order',
      method: 'PUT',
      body: { ids } satisfies LibraryOrder,
    })
  },

  deleteLibrary: async (id: number): Promise<void> => {
    await send({ path: `/api/libraries/${id}`, method: 'DELETE' })
  },

  scanLibraryMarkers: (id: number): Promise<Library> =>
    expect({
      request: send({ path: `/api/libraries/${id}/markers`, method: 'POST' }),
      guard: isLibrary,
    }),

  /** A full scan: every file in the library read again. */
  scanLibrary: (id: number): Promise<Library> =>
    expect({
      request: send({ path: `/api/libraries/${id}/scan`, method: 'POST' }),
      guard: isLibrary,
    }),

  /** Stops a full scan under way; the admin's. */
  cancelScan: (id: number): Promise<Library> =>
    expect({
      request: send({ path: `/api/libraries/${id}/scan/cancel`, method: 'POST' }),
      guard: isLibrary,
    }),

  /**
   * A quick scan: only what is new is read and added to the library, and
   * the ratings of the new titles are fetched once they are matched.
   */
  quickScanLibrary: (id: number): Promise<Library> =>
    expect({
      request: send({ path: `/api/libraries/${id}/quick-scan`, method: 'POST' }),
      guard: isLibrary,
    }),

  /** Stops a quick scan under way, and the ratings that would follow it. */
  cancelQuickScan: (id: number): Promise<Library> =>
    expect({
      request: send({ path: `/api/libraries/${id}/quick-scan/cancel`, method: 'POST' }),
      guard: isLibrary,
    }),

  /** Update ratings: the ratings of every title in the library that has none are fetched. */
  updateLibraryRatings: (id: number): Promise<Library> =>
    expect({
      request: send({ path: `/api/libraries/${id}/ratings`, method: 'POST' }),
      guard: isLibrary,
    }),

  /** Stops Update ratings: the titles still waiting are not asked for, and the ratings fetched stay. */
  cancelLibraryRatings: (id: number): Promise<Library> =>
    expect({
      request: send({ path: `/api/libraries/${id}/ratings/cancel`, method: 'POST' }),
      guard: isLibrary,
    }),

  /** Match again: TMDB is searched once more for the library's files no movie or show was found for. */
  matchLibrary: (id: number): Promise<Library> =>
    expect({
      request: send({ path: `/api/libraries/${id}/match`, method: 'POST' }),
      guard: isLibrary,
    }),

  /** `seed` only counts with a random sort: the same seed deals the same order. */
  listMedia: ({ libraryId, ...options }: ListMediaProps): Promise<MediaItem[]> =>
    expect({
      request: send({
        path: `/api/libraries/${libraryId}/media?${mediaListQuery.encode(options)}`,
      }),
      guard: isMediaList,
    }),

  /**
   * A TV shows library as shows: one entry each, with the files no show
   * was found for after. `seed` counts as it does for `listMedia`.
   */
  listShows: ({ libraryId, ...options }: ListMediaProps): Promise<ShowListing> =>
    expect({
      request: send({
        path: `/api/libraries/${libraryId}/shows?${mediaListQuery.encode(options)}`,
      }),
      guard: isShowListing,
    }),

  /** How much each of a library's tabs holds for this account, but All and Not matched, which the library counts. */
  getLibraryCounts: (libraryId: number): Promise<LibraryCounts> =>
    libraryGet({ libraryId, path: 'counts', guard: isLibraryCounts }),

  /** A library's videos with a saved spot, the most recently watched first, each with its poster. */
  listInProgress: (libraryId: number): Promise<PosterEntry[]> =>
    libraryGet({ libraryId, path: 'in-progress', guard: isPosterEntries }),

  /** A library's favourites, most recently marked first, each with its poster. */
  listLibraryFavourites: (libraryId: number): Promise<PosterEntry[]> =>
    libraryGet({ libraryId, path: 'favourites', guard: isPosterEntries }),

  /** A movie library's sagas of two movies or more, by name, each oldest first. */
  listSagas: (libraryId: number): Promise<Saga[]> =>
    libraryGet({ libraryId, path: 'sagas', guard: isSagaList }),

  /** Picks what a saga's page shows behind its title; answers with what was saved. */
  setSagaBackdrop: ({ libraryId, sagaId, backdrop }: SetSagaBackdropProps): Promise<SagaBackdrop> =>
    expect({
      request: send({
        path: `/api/libraries/${libraryId}/sagas/${encodeURIComponent(sagaId)}/backdrop`,
        method: 'PUT',
        body: backdrop,
      }),
      guard: isSagaBackdrop,
    }),

  /** A library's files no movie or show was found for, each with the AI lookup's suggestion for its folder. */
  listUnmatched: (libraryId: number): Promise<UnmatchedFile[]> =>
    libraryGet({ libraryId, path: 'unmatched', guard: isUnmatchedList }),

  /** A movie library's movies with more than one file, each with its cards, split apart or not. */
  listDuplicates: (libraryId: number): Promise<Duplicates> =>
    libraryGet({ libraryId, path: 'duplicates', guard: isDuplicates }),

  /** Splits the card `mediaId` is on, every file apart or by cut; answers with the duplicates as they stand after. */
  splitDuplicate: ({ libraryId, mediaId, how }: SplitDuplicateProps): Promise<Duplicates> =>
    expect({
      request: send({
        path: `/api/libraries/${libraryId}/duplicates/split`,
        method: 'POST',
        body: { mediaId, how } satisfies SplitRequest,
      }),
      guard: isDuplicates,
    }),

  /** Puts a movie's files back on one card; answers with the duplicates as they stand after. */
  joinSplit: ({ libraryId, itemId }: JoinSplitProps): Promise<Duplicates> =>
    expect({
      request: send({
        path: `/api/libraries/${libraryId}/duplicates/join`,
        method: 'POST',
        body: { itemId } satisfies JoinRequest,
      }),
      guard: isDuplicates,
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
    const query = toQueryString({
      limit: String(limit),
      ...(watchedOnly ? { watched: 'true' } : {}),
    })
    return expect({
      request: send({ path: `/api/libraries/${libraryId}/history?${query}` }),
      guard: isHistory,
    })
  },

  /** The server's folders, for picking a library's paths. */
  browse: (path?: string): Promise<DirectoryListing> => {
    const query = path ? `?${toQueryString({ path })}` : ''
    return expect({
      request: send({ path: `/api/fs/browse${query}` }),
      guard: isDirectoryListing,
    })
  },
})
