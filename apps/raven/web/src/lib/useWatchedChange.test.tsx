import { afterEach, describe, expect, it, spyOn } from 'bun:test'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { api } from '@/lib/api'
import { queryKeys } from '@/lib/queryClient'
import { useWatchedChange } from '@/lib/useWatchedChange'
import { held } from '@/test/held'

const setUp = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(queryKeys.item(40), {})
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  const { result } = renderHook(() => useWatchedChange(), { wrapper })
  return { result, client }
}

const change = ({ id, watched }: { id: number; watched: boolean }) => ({
  watched,
  targets: [{ kind: 'item' as const, id, libraryId: null }],
})

describe('useWatchedChange', () => {
  const spy = spyOn(api, 'setWatched')

  afterEach(() => spy.mockReset())

  it('reads what it touched again once the server has answered, not before', async () => {
    const answer = held<void>()
    spy.mockImplementation(() => answer.promise)
    const { result, client } = setUp()
    act(() => result.current.mutate(change({ id: 40, watched: true })))
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1))
    expect(client.getQueryState(queryKeys.item(40))?.isInvalidated).toBe(false)
    answer.answer()
    await waitFor(() => expect(client.getQueryState(queryKeys.item(40))?.isInvalidated).toBe(true))
  })

  it('keeps marks in the order they were made', async () => {
    const first = held<void>()
    const seen: number[] = []
    spy.mockImplementation(({ targets }) => {
      seen.push(targets.length)
      return seen.length === 1 ? first.promise : Promise.resolve()
    })
    const { result } = setUp()
    act(() => {
      result.current.mutate(change({ id: 40, watched: true }))
      result.current.mutate({ watched: false, targets: [] })
    })
    await waitFor(() => expect(seen).toEqual([1]))
    first.answer()
    await waitFor(() => expect(seen).toEqual([1, 0]))
  })
})
