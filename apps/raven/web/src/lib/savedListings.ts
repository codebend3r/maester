import type { QueryClient } from '@tanstack/react-query'
import {
  type MediaItem,
  type ShowListing,
  isMediaList,
  isNumber,
  isMediaSort,
  isShowListing,
  isString,
  listOf,
  listsShows,
  object,
} from '@raven/core'
import { queryKeys } from '@raven/ui/headless'
import { type ListedLibrary, isCacheable, listingKeyOf, seedListing } from '@/lib/libraryListing'
import { keepSaved } from '@/lib/keepSaved'
import type { ListingStore } from '@/lib/listingStore'
import { librariesQuery } from '@/lib/queries'
import { ravenVersion } from '@/lib/version'
import { warmLibraries } from '@/lib/warmLibraries'

/** A saved listing older than this is not trusted to be worth showing first. */
const MAX_AGE_MS = 24 * 60 * 60_000

/** Whose listings these are when accounts are off. */
export const OPEN_SCOPE = 'open'

const isListing = (value: unknown): value is MediaItem[] | ShowListing =>
  isMediaList(value) || isShowListing(value)

/** What is kept for one account: every cacheable library's listing as last read, and the build that read it. */
const isRecord = object({
  version: isString,
  savedAt: isNumber,
  listings: listOf(
    object({ libraryId: isNumber, sort: isMediaSort, updatedAt: isNumber, data: isListing }),
  ),
})

type SaveListingsProps = {
  store: ListingStore
  scope: string
  queryClient: QueryClient
  libraries: ListedLibrary[]
  now?: number
}

/** Keeps every cacheable library's cached listing under `scope`. */
export const saveListings = async ({
  store,
  scope,
  queryClient,
  libraries,
  now = Date.now(),
}: SaveListingsProps): Promise<void> => {
  const listings = libraries.filter(isCacheable).flatMap((library) => {
    const queryKey = listingKeyOf(library)
    const data = queryClient.getQueryData(queryKey)
    const updatedAt = queryClient.getQueryState(queryKey)?.dataUpdatedAt
    return data === undefined || updatedAt === undefined
      ? []
      : [{ libraryId: library.id, sort: library.settings.sort, updatedAt, data }]
  })
  await store.write({ scope, record: { version: ravenVersion, savedAt: now, listings } })
}

type RestoreListingsProps = {
  store: ListingStore
  scope: string
  queryClient: QueryClient
  libraries: ListedLibrary[]
  now?: number
}

/**
 * Puts the saved listings back in the cache, as old as they were when read so
 * the page still asks again. Only a library that is still there, still
 * cacheable and still sorted the way it was is restored, and nothing
 * replaces a listing already read this visit.
 */
export const restoreListings = async ({
  store,
  scope,
  queryClient,
  libraries,
  now = Date.now(),
}: RestoreListingsProps): Promise<void> => {
  const record = await store.read(scope)
  if (!isRecord(record) || record.version !== ravenVersion || now - record.savedAt > MAX_AGE_MS) {
    return
  }
  const current = new Map(libraries.filter(isCacheable).map((library) => [library.id, library]))
  record.listings.forEach(({ libraryId, sort, updatedAt, data }) => {
    const library = current.get(libraryId)
    if (library?.settings.sort !== sort) return
    if (isShowListing(data) !== listsShows(library.settings.kind)) return
    seedListing({ queryClient, library, data, updatedAt })
  })
}

type KeepListingsSavedProps = {
  store: ListingStore
  scope: string
  queryClient: QueryClient
}

/** Saves the listings again after the libraries are read, so a scan's polling writes once, not on every poll. */
export const keepListingsSaved = ({
  store,
  scope,
  queryClient,
}: KeepListingsSavedProps): (() => void) =>
  keepSaved({
    queryClient,
    isSaved: (query) => query.queryKey[0] === queryKeys.libraries[0],
    save: () =>
      saveListings({
        store,
        scope,
        queryClient,
        libraries: queryClient.getQueryData(librariesQuery.queryKey) ?? [],
      }),
  })

type KeepListingsProps = {
  store: ListingStore
  scope: string
  queryClient: QueryClient
  libraries: ListedLibrary[]
  signal: AbortSignal
}

/**
 * Puts back what was saved, then keeps the cache saved and reads the rest of
 * the libraries in the background until `signal` aborts.
 */
export const keepListings = async ({
  store,
  scope,
  queryClient,
  libraries,
  signal,
}: KeepListingsProps): Promise<void> => {
  await restoreListings({ store, scope, queryClient, libraries })
  if (signal.aborted) return
  signal.addEventListener('abort', keepListingsSaved({ store, scope, queryClient }), { once: true })
  await warmLibraries({ queryClient, libraries, signal })
}
