import { describe, expect, it, jest } from 'bun:test'
import { QueryClient, type QueryKey } from '@tanstack/react-query'
import type { ListingStore } from '@/lib/listingStore'
import { heroQuery, homeAlbumsQuery, homeQuery } from '@/lib/queries'
import { stopKeepingSaved } from '@/lib/keepSaved'
import { keepHome, restoreHome, saveHome } from '@/lib/savedHome'
import { mediaItem } from '@/test/fixtures'

const memoryStore = (): ListingStore & { records: Map<string, unknown> } => {
  const records = new Map<string, unknown>()
  return {
    records,
    read: async (scope) => records.get(scope),
    write: async ({ scope, record }) => void records.set(scope, record),
    clear: async () => records.clear(),
  }
}

const HOME = { inProgress: [{ media: mediaItem({ id: 70 }), poster: null }], shelves: [] }
const NOW = 1_800_000_000_000

const clientWithHome = () => {
  const client = new QueryClient()
  client.setQueryData(homeQuery.queryKey, HOME, { updatedAt: NOW - 1_000 })
  client.setQueryData(heroQuery.queryKey, [], { updatedAt: NOW - 2_000 })
  return client
}

type DataOfProps = { client: QueryClient; queryKey: QueryKey }

/** What the cache holds under `queryKey`, untyped, so a test compares it with its fixture. */
const dataOf = ({ client, queryKey }: DataOfProps): unknown => client.getQueryData(queryKey)

describe('saved home', () => {
  it('puts back what was saved for the account, as old as it was, beside its listings', async () => {
    const store = memoryStore()
    await saveHome({ store, scope: 'account-1', queryClient: clientWithHome(), now: NOW })
    expect([...store.records.keys()]).toEqual(['home:account-1'])
    const client = new QueryClient()
    await restoreHome({ store, scope: 'account-1', queryClient: client, now: NOW })
    expect(dataOf({ client, queryKey: homeQuery.queryKey })).toEqual(HOME)
    expect(client.getQueryState(homeQuery.queryKey)?.dataUpdatedAt).toBe(NOW - 1_000)
    expect(dataOf({ client, queryKey: heroQuery.queryKey })).toEqual([])
    expect(dataOf({ client, queryKey: homeAlbumsQuery.queryKey })).toBeUndefined()
  })

  it("never puts back another account's home, a day-old one, or over what was read this visit", async () => {
    const store = memoryStore()
    await saveHome({ store, scope: 'account-1', queryClient: clientWithHome(), now: NOW })
    const other = new QueryClient()
    await restoreHome({ store, scope: 'account-2', queryClient: other, now: NOW })
    expect(dataOf({ client: other, queryKey: homeQuery.queryKey })).toBeUndefined()
    const late = new QueryClient()
    await restoreHome({ store, scope: 'account-1', queryClient: late, now: NOW + 25 * 60 * 60_000 })
    expect(dataOf({ client: late, queryKey: homeQuery.queryKey })).toBeUndefined()
    const fresh = new QueryClient()
    const read = { inProgress: [], shelves: [] }
    fresh.setQueryData(homeQuery.queryKey, read)
    await restoreHome({ store, scope: 'account-1', queryClient: fresh, now: NOW })
    expect(dataOf({ client: fresh, queryKey: homeQuery.queryKey })).toBe(read)
  })

  it('marks what it puts back stale, so a home saved moments ago is still asked again', async () => {
    const store = memoryStore()
    await saveHome({ store, scope: 'account-1', queryClient: clientWithHome(), now: NOW })
    const client = new QueryClient()
    await restoreHome({ store, scope: 'account-1', queryClient: client, now: NOW })
    expect(client.getQueryState(homeQuery.queryKey)?.isInvalidated).toBe(true)
    expect(client.getQueryState(heroQuery.queryKey)?.isInvalidated).toBe(true)
  })

  it('ignores a saved record that is not a home', async () => {
    const store = memoryStore()
    store.records.set('home:account-1', { version: 'x', savedAt: NOW, home: { data: 1 } })
    const client = new QueryClient()
    await restoreHome({ store, scope: 'account-1', queryClient: client, now: NOW })
    expect(dataOf({ client, queryKey: homeQuery.queryKey })).toBeUndefined()
  })

  it('saves again a few seconds after home is read, and not once stopped', async () => {
    jest.useFakeTimers()
    const store = memoryStore()
    const client = new QueryClient()
    const controller = new AbortController()
    await keepHome({ store, scope: 'account-1', queryClient: client, signal: controller.signal })
    await client.fetchQuery({ queryKey: homeQuery.queryKey, queryFn: async () => HOME })
    jest.advanceTimersByTime(5_000)
    await Promise.resolve()
    expect(store.records.has('home:account-1')).toBe(true)
    store.records.clear()
    stopKeepingSaved()
    await client.fetchQuery({ queryKey: heroQuery.queryKey, queryFn: async () => [] })
    jest.advanceTimersByTime(5_000)
    await Promise.resolve()
    expect(store.records.size).toBe(0)
    controller.abort()
    jest.useRealTimers()
  })
})
