import { describe, expect, it } from 'bun:test'
import { QueryClient } from '@tanstack/react-query'
import { waitFor } from '@testing-library/react'
import { HOME_SHELF_TYPES, SHELF_ORDERS, createApiClient } from '@raven/core'
import { ravenQueriesFor } from '@/query/ravenQueries'
import { useReleasedShelves } from '@/query/useReleasedShelves'
import { renderQueryHook } from '@/test/renderQueryHook'

const SHELF = { libraryId: 2, type: HOME_SHELF_TYPES.media, media: [] }

/** A server answering Home and its albums, which keeps the address of every call. */
const serverWith = () => {
  const asked: string[] = []
  const api = createApiClient({
    baseUrl: 'http://raven.test',
    fetch: async (url) => {
      asked.push(url)
      const body = url.includes('/albums') ? [] : { inProgress: [], shelves: [SHELF] }
      return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })
    },
  })
  return { asked, queries: ravenQueriesFor(api) }
}

describe('useReleasedShelves', () => {
  it('reads nothing while every shelf is on Recently added', async () => {
    const { asked, queries } = serverWith()
    const { result } = renderQueryHook({
      hook: () => useReleasedShelves({ queries, orders: { 2: SHELF_ORDERS.added } }),
      client: new QueryClient(),
    })
    expect(result.current).toEqual({ shelves: null, albums: null })
    expect(asked).toEqual([])
  })

  it('reads the newest releases and albums once a shelf is turned to them', async () => {
    const { asked, queries } = serverWith()
    const { result } = renderQueryHook({
      hook: () => useReleasedShelves({ queries, orders: { 2: SHELF_ORDERS.released } }),
      client: new QueryClient(),
    })
    await waitFor(() => expect(result.current).toEqual({ shelves: [SHELF], albums: [] }))
    expect(asked.toSorted()).toEqual([
      'http://raven.test/api/home/albums?order=released',
      'http://raven.test/api/home?order=released',
    ])
  })
})
