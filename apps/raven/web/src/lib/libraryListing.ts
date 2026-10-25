import type { QueryClient } from '@tanstack/react-query'
import { type Library, type LibrarySettings, MEDIA_SORTS, listsShows } from '@raven/core'
import { LISTING_GC_MS, queryKeys } from '@raven/ui/headless'
import { mediaListQuery, showListQuery } from '@/lib/queries'

/** What of a library decides whether and how its listing is read ahead, so a scan's progress changes none of it. */
export type ListedLibrary = Pick<Library, 'id'> & {
  settings: Pick<LibrarySettings, 'kind' | 'sort' | 'locked'>
}

export const listedLibraryOf = ({
  id,
  settings: { kind, sort, locked },
}: Library): ListedLibrary => ({ id, settings: { kind, sort, locked } })

/**
 * Whether a library's listing may be read ahead and kept on this device: not
 * one behind the PIN, which must be asked for each time, and not a random
 * sort, whose deal is picked by the page when it opens so nothing read
 * before could match it.
 */
export const isCacheable = (library: ListedLibrary): boolean =>
  !library.settings.locked && library.settings.sort !== MEDIA_SORTS.random

/** The listing a library opens on: its own sort, nothing searched, and the seed every sort but random shares. */
const listingOf = (library: ListedLibrary) => ({
  libraryId: library.id,
  search: '',
  sort: library.settings.sort,
  seed: 0,
})

/** The cache key of the listing a library opens on: its shows for a TV library, its items otherwise. */
export const listingKeyOf = (library: ListedLibrary) =>
  listsShows(library.settings.kind)
    ? queryKeys.shows(listingOf(library))
    : queryKeys.media(listingOf(library))

/** Reads the listing a library opens on into the cache, unless it is still fresh. */
export const prefetchListing = async ({
  queryClient,
  library,
}: {
  queryClient: QueryClient
  library: ListedLibrary
}): Promise<void> => {
  if (listsShows(library.settings.kind)) {
    await queryClient.prefetchQuery(showListQuery(listingOf(library)))
    return
  }
  await queryClient.prefetchQuery(mediaListQuery(listingOf(library)))
}

/**
 * Puts a listing read earlier in the cache as old as it was, unless one is
 * already there. With no one watching it yet it would be dropped in minutes,
 * so it is given the keep a listing read now gets.
 */
export const seedListing = ({
  queryClient,
  library,
  data,
  updatedAt,
}: {
  queryClient: QueryClient
  library: ListedLibrary
  data: unknown
  updatedAt: number
}): void => {
  const queryKey = listingKeyOf(library)
  if (queryClient.getQueryData(queryKey) !== undefined) return
  queryClient.setQueryData(queryKey, data, { updatedAt })
  queryClient.getQueryCache().find({ queryKey })?.setOptions({ gcTime: LISTING_GC_MS })
}
