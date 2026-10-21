import { describe, expect, it } from 'bun:test'
import { QueryClient, queryOptions } from '@tanstack/react-query'
import { act, waitFor } from '@testing-library/react'
import { edit, editAll, editKey, useOptimisticMutation } from '@/query/optimistic'
import { renderQueryHook } from '@/test/renderQueryHook'

/** A stored count of 1, and a hook that changes it, sending each change through `save`. */
const setUp = (save: (n: number) => Promise<number>) => {
  const client = new QueryClient()
  client.setQueryData(['count'], 1)
  const settled: string[] = []
  const { result } = renderQueryHook({
    client,
    hook: () =>
      useOptimisticMutation({
        mutationKey: ['count'],
        mutationFn: save,
        edits: (n: number) => [
          editAll<number>({ filters: { queryKey: ['count'] }, update: () => n }),
        ],
        settle: async () => {
          settled.push('read again')
        },
      }),
  })
  const count = () => client.getQueryData<number>(['count'])
  return { result, count, settled }
}

describe('useOptimisticMutation', () => {
  it('shows a change at once, and puts it back and says why when the server refuses it', async () => {
    const answer = Promise.withResolvers<number>()
    const { result, count, settled } = setUp(() => answer.promise)
    act(() => result.current.mutate(2))
    await waitFor(() => expect(count()).toBe(2))
    answer.reject(new Error('The server is away.'))
    await waitFor(() => expect(result.current.failure?.message).toBe('The server is away.'))
    expect(count()).toBe(1)
    await waitFor(() => expect(settled).toEqual(['read again']))
    act(() => result.current.mutate(3))
    expect(result.current.failure).toBeNull()
    // The server still refuses, and the failure lands a few ticks later.
    await waitFor(() => expect(result.current.failure?.message).toBe('The server is away.'))
  })

  it('sends changes one at a time, in order, and reads again once the last settles', async () => {
    const first = Promise.withResolvers<number>()
    const second = Promise.withResolvers<number>()
    const sent: number[] = []
    const { result, count, settled } = setUp((n) => {
      sent.push(n)
      return (sent.length === 1 ? first : second).promise
    })
    act(() => {
      result.current.mutate(2)
      result.current.mutate(3)
    })
    await waitFor(() => expect(count()).toBe(3))
    expect(sent).toEqual([2])
    first.resolve(2)
    await waitFor(() => expect(sent).toEqual([2, 3]))
    expect(settled).toEqual([])
    second.resolve(3)
    await waitFor(() => expect(settled).toEqual(['read again']))
    expect(count()).toBe(3)
  })
})

describe('edit and editKey', () => {
  const count = queryOptions({ queryKey: ['count'], queryFn: async () => 1 })

  it('changes the one query a tagged key or a bare key names', () => {
    const client = new QueryClient()
    client.setQueryData(count.queryKey, 1)
    client.setQueryData(['count', 'other'], 1)
    const plans = [
      edit({ queryKey: count.queryKey, update: (n) => n + 1 }),
      editKey<number>({ queryKey: ['count'], update: (n) => n * 10 }),
    ].flatMap((change) => change.plan(client))
    plans.forEach(({ write }) => write())
    expect(client.getQueryData<number>(['count'])).toBe(20)
    expect(client.getQueryData<number>(['count', 'other'])).toBe(1)
  })

  it('types an edit by its key, or by the type a bare key is given', () => {
    // @ts-expect-error a tagged key holds numbers, so an update of strings does not fit
    expect(edit({ queryKey: count.queryKey, update: (text: string) => text })).toBeDefined()
    // @ts-expect-error a bare key with no type given takes no update
    expect(editKey({ queryKey: ['count'], update: (n: number) => n })).toBeDefined()
  })
})
