import { afterEach, describe, expect, it, spyOn } from 'bun:test'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { api } from '@/lib/api'
import { queryKeys } from '@/lib/queryClient'
import { useMediaMutations } from '@/lib/useMediaMutations'
import { itemDetails, mediaItem } from '@/test/fixtures'

/** The tabs beside library 2's listing, every one of them showing the video's menu. */
const TABS = [
  queryKeys.inProgress(2),
  queryKeys.unmatched(2),
  queryKeys.sagas(2),
  queryKeys.history({ libraryId: 2, show: '', limit: 50 }),
  queryKeys.libraryFavourites(2),
  queryKeys.showLists(2),
]

/** The hook for video 7 of library 2, its library's tabs already cached. */
const setUp = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  TABS.forEach((key) => client.setQueryData(key, []))
  client.setQueryData(queryKeys.inProgress(3), [])
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  const { result } = renderHook(() => useMediaMutations({ media: mediaItem() }), { wrapper })
  const isStale = (key: readonly unknown[]) => !!client.getQueryState(key)?.isInvalidated
  return { result, isStale }
}

describe('useMediaMutations', () => {
  const spies = {
    favourite: spyOn(api, 'setFavourite'),
    refresh: spyOn(api, 'refreshItem'),
  }

  afterEach(() => {
    spies.favourite.mockReset()
    spies.refresh.mockReset()
  })

  it('reads every tab of the library again after favouriting, so none keeps a stale menu', async () => {
    spies.favourite.mockImplementation(async ({ favourite }) => mediaItem({ favourite }))
    const { result, isStale } = setUp()
    act(() => result.current.favourite.mutate(true))
    await waitFor(() => expect(result.current.favourite.isSuccess).toBe(true))
    expect(TABS.filter((key) => !isStale(key))).toEqual([])
    expect(isStale(queryKeys.inProgress(3))).toBe(false)
  })

  it('reads every tab of the library again after a refresh', async () => {
    spies.refresh.mockImplementation(async () => itemDetails())
    const { result, isStale } = setUp()
    act(() => result.current.refresh.mutate(40))
    await waitFor(() => expect(result.current.refresh.isSuccess).toBe(true))
    expect(TABS.filter((key) => !isStale(key))).toEqual([])
    expect(isStale(queryKeys.inProgress(3))).toBe(false)
  })
})
