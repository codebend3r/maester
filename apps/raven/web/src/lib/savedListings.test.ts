import { describe, expect, it, jest } from 'bun:test'
import { QueryClient } from '@tanstack/react-query'
import { queryKeys } from '@raven/ui/headless'
import type { ListingStore } from '@/lib/listingStore'
import { librariesQuery } from '@/lib/queries'
import {
  keepListingsSaved,
  restoreListings,
  saveListings,
  stopKeepingListings,
} from '@/lib/savedListings'
import { library, mediaItem } from '@/test/fixtures'

const memoryStore = (): ListingStore & { records: Map<string, unknown> } => {
  const records = new Map<string, unknown>()
  return {
    records,
    read: async (scope) => records.get(scope),
    write: async ({ scope, record }) => void records.set(scope, record),
    clear: async () => records.clear(),
  }
}

const listing = (id: number) => ({ libraryId: id, search: '', sort: 'title', seed: 0 }) as const

const items = [mediaItem({ id: 70, libraryId: 1 })]

type ReadProps = { client: QueryClient; id: number }

const read = ({ client, id }: ReadProps) => client.getQueryData(queryKeys.media(listing(id)))

describe('saved listings', () => {
  it('brings a listing back as old as it was, for another visit to show first', async () => {
    const store = memoryStore()
    const first = new QueryClient()
    first.setQueryData(queryKeys.media(listing(1)), items, { updatedAt: 1_000 })
    const libraries = [library({ id: 1 })]
    await saveListings({ store, scope: 'a', queryClient: first, libraries, now: 5_000 })

    const second = new QueryClient()
    await restoreListings({ store, scope: 'a', queryClient: second, libraries, now: 6_000 })
    expect(read({ client: second, id: 1 })).toEqual(items)
    expect(second.getQueryState(queryKeys.media(listing(1)))?.dataUpdatedAt).toBe(1_000)
  })

  it('keeps TV libraries as shows', async () => {
    const store = memoryStore()
    const first = new QueryClient()
    const shows = { shows: [], unmatched: [] }
    first.setQueryData(queryKeys.shows(listing(1)), shows)
    const libraries = [library({ id: 1, settings: { ...library().settings, kind: 'shows' } })]
    await saveListings({ store, scope: 'a', queryClient: first, libraries })

    const second = new QueryClient()
    await restoreListings({ store, scope: 'a', queryClient: second, libraries })
    expect<unknown>(second.getQueryData(queryKeys.shows(listing(1)))).toEqual(shows)
  })

  it('never saves a locked library', async () => {
    const store = memoryStore()
    const client = new QueryClient()
    client.setQueryData(queryKeys.media(listing(1)), items)
    const libraries = [library({ id: 1, settings: { ...library().settings, locked: true } })]
    await saveListings({ store, scope: 'a', queryClient: client, libraries })

    const open = [library({ id: 1 })]
    const second = new QueryClient()
    await restoreListings({ store, scope: 'a', queryClient: second, libraries: open })
    expect(read({ client: second, id: 1 })).toBeUndefined()
  })

  it('leaves out a library that has since been locked, deleted or re-sorted', async () => {
    const store = memoryStore()
    const client = new QueryClient()
    ;[1, 2, 3].forEach((id) => client.setQueryData(queryKeys.media(listing(id)), items))
    await saveListings({
      store,
      scope: 'a',
      queryClient: client,
      libraries: [1, 2, 3].map((id) => library({ id })),
    })

    const second = new QueryClient()
    await restoreListings({
      store,
      scope: 'a',
      queryClient: second,
      libraries: [
        library({ id: 1, settings: { ...library().settings, locked: true } }),
        library({ id: 3, settings: { ...library().settings, sort: 'added' } }),
      ],
    })
    expect([1, 2, 3].map((id) => read({ client: second, id }))).toEqual([
      undefined,
      undefined,
      undefined,
    ])
  })

  it('does not replace a listing already read this visit', async () => {
    const store = memoryStore()
    const first = new QueryClient()
    first.setQueryData(queryKeys.media(listing(1)), items)
    const libraries = [library({ id: 1 })]
    await saveListings({ store, scope: 'a', queryClient: first, libraries })

    const second = new QueryClient()
    second.setQueryData(queryKeys.media(listing(1)), [])
    await restoreListings({ store, scope: 'a', queryClient: second, libraries })
    expect(read({ client: second, id: 1 })).toEqual([])
  })

  it('ignores another account, an old record, another build and a damaged one', async () => {
    const store = memoryStore()
    const first = new QueryClient()
    first.setQueryData(queryKeys.media(listing(1)), items)
    const libraries = [library({ id: 1 })]
    await saveListings({ store, scope: 'a', queryClient: first, libraries, now: 0 })

    type RestoreIntoProps = { scope: string; now: number }

    const restoreInto = async ({ scope, now }: RestoreIntoProps) => {
      const client = new QueryClient()
      await restoreListings({ store, scope, queryClient: client, libraries, now })
      return read({ client, id: 1 })
    }
    expect(await restoreInto({ scope: 'b', now: 1 })).toBeUndefined()
    expect(await restoreInto({ scope: 'a', now: 25 * 60 * 60_000 })).toBeUndefined()

    store.records.set('a', { version: 'older', savedAt: 0, listings: [] })
    expect(await restoreInto({ scope: 'a', now: 1 })).toBeUndefined()
    store.records.set('a', 'garbage')
    expect(await restoreInto({ scope: 'a', now: 1 })).toBeUndefined()
  })
})

describe('keepListingsSaved', () => {
  it('saves once a few seconds after listings change, however many changes come', async () => {
    jest.useFakeTimers()
    try {
      const store = memoryStore()
      const client = new QueryClient()
      client.setQueryData(librariesQuery.queryKey, [library({ id: 1 })])
      const stop = keepListingsSaved({ store, scope: 'a', queryClient: client })
      client.setQueryData(queryKeys.media(listing(1)), items)
      client.setQueryData(queryKeys.media(listing(1)), items)
      expect(store.records.size).toBe(0)
      jest.advanceTimersByTime(5_000)
      await Promise.resolve()
      expect(store.records.has('a')).toBe(true)
      stop()
    } finally {
      jest.useRealTimers()
    }
  })

  it('ignores other queries, and saves nothing once stopped', () => {
    jest.useFakeTimers()
    try {
      const store = memoryStore()
      const client = new QueryClient()
      const stop = keepListingsSaved({ store, scope: 'a', queryClient: client })
      client.setQueryData(queryKeys.favourites, [])
      jest.advanceTimersByTime(10_000)
      expect(store.records.size).toBe(0)
      client.setQueryData(queryKeys.media(listing(1)), items)
      stop()
      jest.advanceTimersByTime(10_000)
      expect(store.records.size).toBe(0)
    } finally {
      jest.useRealTimers()
    }
  })

  it('saves nothing more once every keeper is stopped, as when the account changes', () => {
    jest.useFakeTimers()
    try {
      const store = memoryStore()
      const client = new QueryClient()
      client.setQueryData(librariesQuery.queryKey, [library({ id: 1 })])
      keepListingsSaved({ store, scope: 'a', queryClient: client })
      client.setQueryData(queryKeys.media(listing(1)), items)
      stopKeepingListings()
      jest.advanceTimersByTime(10_000)
      expect(store.records.size).toBe(0)
    } finally {
      jest.useRealTimers()
    }
  })
})
