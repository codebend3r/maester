import { type DataTag, type QueryClient, type QueryKey, hashKey } from '@tanstack/react-query'
import {
  type Guard,
  isAlbumShelves,
  isHero,
  isHome,
  isNumber,
  isString,
  nullable,
  object,
} from '@raven/core'
import { keepSaved } from '@/lib/keepSaved'
import type { ListingStore } from '@/lib/listingStore'
import { heroQuery, homeAlbumsQuery, homeQuery } from '@/lib/queries'
import { ravenVersion } from '@/lib/version'

/** A saved home older than this is not trusted to be worth showing first. */
const MAX_AGE_MS = 24 * 60 * 60_000

/** The store keeps an account's listings under its scope; its home sits beside them under this prefix. */
const HOME_RECORD_PREFIX = 'home:'

const recordKeyOf = (scope: string) => `${HOME_RECORD_PREFIX}${scope}`

const savedAs = <T>(guard: Guard<T>) => nullable(object({ updatedAt: isNumber, data: guard }))

/** What is kept for one account: home's shelves, its hero and its albums as last read, and the build that read them. */
const isRecord = object({
  version: isString,
  savedAt: isNumber,
  home: savedAs(isHome),
  hero: savedAs(isHero),
  albums: savedAs(isAlbumShelves),
})

type SavedEntryProps = { queryClient: QueryClient; queryKey: readonly unknown[] }

const savedEntryOf = ({ queryClient, queryKey }: SavedEntryProps) => {
  const state = queryClient.getQueryState(queryKey)
  return state?.data === undefined ? null : { updatedAt: state.dataUpdatedAt, data: state.data }
}

type SaveHomeProps = {
  store: ListingStore
  scope: string
  queryClient: QueryClient
  now?: number
}

/** Keeps home's cached shelves, hero and albums under `scope`. */
export const saveHome = async ({
  store,
  scope,
  queryClient,
  now = Date.now(),
}: SaveHomeProps): Promise<void> => {
  await store.write({
    scope: recordKeyOf(scope),
    record: {
      version: ravenVersion,
      savedAt: now,
      home: savedEntryOf({ queryClient, queryKey: homeQuery.queryKey }),
      hero: savedEntryOf({ queryClient, queryKey: heroQuery.queryKey }),
      albums: savedEntryOf({ queryClient, queryKey: homeAlbumsQuery.queryKey }),
    },
  })
}

type SeedProps<T> = {
  queryClient: QueryClient
  queryKey: DataTag<QueryKey, T, Error>
  saved: { updatedAt: number; data: T } | null
}

/** Puts one saved query back, unless it was not saved or was already read this visit. */
const seed = <T>({ queryClient, queryKey, saved }: SeedProps<T>): void => {
  if (saved === null || queryClient.getQueryData(queryKey) !== undefined) return
  queryClient.setQueryData(queryKey, saved.data, { updatedAt: saved.updatedAt })
}

type RestoreHomeProps = SaveHomeProps

/**
 * Puts the saved home back in the cache, as old as it was when read so the
 * page draws it at once and still asks again. Nothing replaces what was
 * already read this visit, and a record from another build or a day ago is
 * left alone.
 */
export const restoreHome = async ({
  store,
  scope,
  queryClient,
  now = Date.now(),
}: RestoreHomeProps): Promise<void> => {
  const record = await store.read(recordKeyOf(scope))
  if (!isRecord(record) || record.version !== ravenVersion || now - record.savedAt > MAX_AGE_MS) {
    return
  }
  seed({ queryClient, queryKey: homeQuery.queryKey, saved: record.home })
  seed({ queryClient, queryKey: heroQuery.queryKey, saved: record.hero })
  seed({ queryClient, queryKey: homeAlbumsQuery.queryKey, saved: record.albums })
}

// Read when asked, not when the module loads: `queries` reaches this module through the session's sign out.
const isSavedQuery = (queryHash: string): boolean =>
  [homeQuery.queryKey, heroQuery.queryKey, homeAlbumsQuery.queryKey].some(
    (queryKey) => hashKey(queryKey) === queryHash,
  )

type KeepHomeProps = {
  store: ListingStore
  scope: string
  queryClient: QueryClient
  signal: AbortSignal
}

/** Puts back what was saved, then keeps home saved until `signal` aborts. */
export const keepHome = async ({
  store,
  scope,
  queryClient,
  signal,
}: KeepHomeProps): Promise<void> => {
  await restoreHome({ store, scope, queryClient })
  if (signal.aborted) return
  const stop = keepSaved({
    queryClient,
    isSaved: (query) => isSavedQuery(query.queryHash),
    save: () => saveHome({ store, scope, queryClient }),
  })
  signal.addEventListener('abort', stop, { once: true })
}
