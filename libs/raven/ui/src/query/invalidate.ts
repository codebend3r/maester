import type { InvalidateQueryFilters, QueryClient } from '@tanstack/react-query'
import type { ItemDetails } from '@raven/core'
import { queryKeys } from '@/query/queryClient'

/**
 * What to read again after each kind of change, named for the change, so a
 * component says what happened rather than which caches it touches.
 */

const refetch = ({
  queryClient,
  filters,
}: {
  queryClient: QueryClient
  filters: readonly InvalidateQueryFilters[]
}): Promise<unknown> => Promise.all(filters.map((filter) => queryClient.invalidateQueries(filter)))

/** A file or show now points somewhere else: its pages, the listings and their counts. */
export const afterMatch = (queryClient: QueryClient): Promise<unknown> =>
  refetch({
    queryClient,
    filters: [
      { queryKey: queryKeys.libraries },
      { queryKey: queryKeys.items },
      { queryKey: queryKeys.favourites },
      { queryKey: queryKeys.allMedia },
      { queryKey: queryKeys.home },
    ],
  })

/**
 * A library was created or its settings saved. Saved spots show or hide with
 * its progress setting, so cached videos and favourites are read again too.
 */
export const afterLibrarySaved = (queryClient: QueryClient): Promise<unknown> =>
  refetch({
    queryClient,
    filters: [
      { queryKey: queryKeys.libraries },
      { queryKey: queryKeys.allMedia },
      { queryKey: queryKeys.favourites },
      { queryKey: queryKeys.home },
    ],
  })

/**
 * Favourites were marked or unmarked, perhaps across libraries: everything
 * every library shows, each tab's menu among them, the favourites, the item
 * pages, home, and the videos themselves.
 */
export const afterFavourites = (queryClient: QueryClient): Promise<unknown> =>
  refetch({
    queryClient,
    filters: [
      { queryKey: queryKeys.libraries },
      { queryKey: queryKeys.favourites },
      { queryKey: queryKeys.items },
      { queryKey: queryKeys.home },
      { queryKey: queryKeys.allMedia },
    ],
  })

/**
 * Videos were marked watched or unwatched, in any library: the counts and
 * cards of everything every library shows, the item pages, home and its
 * up next, the favourites, and the videos themselves.
 */
export const afterWatched = (queryClient: QueryClient): Promise<unknown> =>
  refetch({
    queryClient,
    filters: [
      { queryKey: queryKeys.libraries },
      { queryKey: queryKeys.items },
      { queryKey: queryKeys.home },
      { queryKey: queryKeys.favourites },
      { queryKey: queryKeys.allMedia },
    ],
  })

/** The admin put a title in the hero or took one out: the picks, and the hero they decide. */
export const afterHeroPicked = (queryClient: QueryClient): Promise<unknown> =>
  refetch({
    queryClient,
    filters: [{ queryKey: queryKeys.heroPicks }, { queryKey: queryKeys.hero }],
  })

/** Libraries were pinned or unpinned: every library, and home, whose shelves follow the pins. */
export const afterPins = (queryClient: QueryClient): Promise<unknown> =>
  refetch({
    queryClient,
    filters: [{ queryKey: queryKeys.libraries }, { queryKey: queryKeys.home }],
  })

/** The libraries were put in a new order: every library, and home, whose shelves follow it. */
export const afterLibraryOrder = (queryClient: QueryClient): Promise<unknown> =>
  refetch({
    queryClient,
    filters: [{ queryKey: queryKeys.libraries }, { queryKey: queryKeys.home }],
  })

/** A library was included in the hero or left out: every library, and the hero and its picks. */
export const afterHeroLibraries = (queryClient: QueryClient): Promise<unknown> =>
  refetch({
    queryClient,
    filters: [
      { queryKey: queryKeys.libraries },
      { queryKey: queryKeys.hero },
      { queryKey: queryKeys.heroPicks },
    ],
  })

/** A library was rescanned: every library and everything listed under them. */
export const afterRescan = (queryClient: QueryClient): Promise<unknown> =>
  refetch({ queryClient, filters: [{ queryKey: queryKeys.libraries }] })

/**
 * A library's files not matched went back to TMDB: the libraries list for its
 * count, and its listings, which then poll while any file is pending.
 */
export const afterRematch = ({
  queryClient,
  libraryId,
}: {
  queryClient: QueryClient
  libraryId: number
}): Promise<unknown> =>
  refetch({
    queryClient,
    filters: [
      { queryKey: queryKeys.libraries, exact: true },
      { queryKey: queryKeys.showLists(libraryId) },
      { queryKey: queryKeys.mediaLists(libraryId) },
      { queryKey: queryKeys.unmatched(libraryId) },
    ],
  })

/** A library's sort, view or grouping was saved: the library, and the list the side menu reads. */
export const afterLibraryView = ({
  queryClient,
  libraryId,
}: {
  queryClient: QueryClient
  libraryId: number
}): Promise<unknown> =>
  refetch({
    queryClient,
    filters: [
      { queryKey: queryKeys.library(libraryId), exact: true },
      { queryKey: queryKeys.libraries, exact: true },
    ],
  })

/** A saga's backdrop was picked: the library's sagas, which its page and its deck read. */
export const afterSagaBackdrop = ({
  queryClient,
  libraryId,
}: {
  queryClient: QueryClient
  libraryId: number
}): Promise<unknown> =>
  refetch({ queryClient, filters: [{ queryKey: queryKeys.sagas(libraryId) }] })

/**
 * The player closed: resume lines and watched marks on the library's
 * listings, In progress and the history, all under the library, home's show
 * where it stopped, and the item pages and favourites, which show the same.
 */
export const afterWatching = ({
  queryClient,
  libraryId,
}: {
  queryClient: QueryClient
  libraryId: number
}): Promise<unknown> =>
  refetch({
    queryClient,
    filters: [
      { queryKey: queryKeys.library(libraryId) },
      { queryKey: queryKeys.home },
      { queryKey: queryKeys.items },
      { queryKey: queryKeys.favourites },
    ],
  })

/** What of an item an editor changes: its pictures or its metadata. */
export const EDITED_PARTS = { images: 'images', metadata: 'metadata' } as const

/** An item's pictures or metadata were edited: its page takes the answer, its editor and the listings read again. */
export const afterItemEdited = ({
  queryClient,
  updated,
  part,
}: {
  queryClient: QueryClient
  updated: ItemDetails
  part: (typeof EDITED_PARTS)[keyof typeof EDITED_PARTS]
}): Promise<unknown> => {
  queryClient.setQueryData(queryKeys.item(updated.id), updated)
  return refetch({
    queryClient,
    filters: [
      {
        queryKey:
          part === EDITED_PARTS.images
            ? queryKeys.itemImages(updated.id)
            : queryKeys.itemMetadata(updated.id),
      },
      { queryKey: queryKeys.libraries },
      { queryKey: queryKeys.home },
    ],
  })
}

/** The server says a library's folders changed: it, its count, and whatever its videos show on. */
export const afterLibraryEvent = ({
  queryClient,
  libraryId,
}: {
  queryClient: QueryClient
  libraryId: number
}): Promise<unknown> =>
  refetch({
    queryClient,
    filters: [
      { queryKey: queryKeys.library(libraryId) },
      { queryKey: queryKeys.libraries, exact: true },
      { queryKey: queryKeys.favourites },
      { queryKey: queryKeys.items },
      { queryKey: queryKeys.home },
    ],
  })

/**
 * A movie's files were split onto cards of their own or put back on one:
 * everything the library shows, its listings counting and titling its
 * cards, home's shelves, and the item pages, which list a card's files.
 * The duplicates already hold the answer, so theirs reads back the same.
 */
export const afterSplit = ({
  queryClient,
  libraryId,
}: {
  queryClient: QueryClient
  libraryId: number
}): Promise<unknown> =>
  refetch({
    queryClient,
    filters: [
      { queryKey: queryKeys.library(libraryId) },
      { queryKey: queryKeys.home },
      { queryKey: queryKeys.items },
    ],
  })

/** The event stream was down a while: anything may have changed. */
export const afterReconnect = (queryClient: QueryClient): Promise<unknown> =>
  refetch({
    queryClient,
    filters: [
      { queryKey: queryKeys.libraries },
      { queryKey: queryKeys.favourites },
      { queryKey: queryKeys.items },
      { queryKey: queryKeys.home },
    ],
  })

/** A matching pass finished: the library's count of files not matched changed, and home's shows with it. */
export const afterMatchingPass = ({
  queryClient,
  libraryId,
}: {
  queryClient: QueryClient
  libraryId: number
}): Promise<unknown> =>
  refetch({
    queryClient,
    filters: [
      { queryKey: queryKeys.library(libraryId), exact: true },
      { queryKey: queryKeys.libraries, exact: true },
      { queryKey: queryKeys.home },
    ],
  })

/**
 * The AI lookups ended: what the library's Not matched tab lists and
 * suggests, its other listings and its count, which a sure pick changes, and
 * home's shows.
 */
export const afterAiLookups = ({
  queryClient,
  libraryId,
}: {
  queryClient: QueryClient
  libraryId: number
}): Promise<unknown> =>
  refetch({
    queryClient,
    filters: [
      { queryKey: queryKeys.library(libraryId) },
      { queryKey: queryKeys.libraries, exact: true },
      { queryKey: queryKeys.home },
    ],
  })
