import { describe, expect, it } from 'bun:test'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { edit, useOptimisticMutation } from '@/lib/optimistic'
import { held } from '@/test/held'

/** A stored count of 1, and a hook that changes it, sending each change through `save`. */
const setUp = (save: (n: number) => Promise<number>) => {
  const client = new QueryClient()
  client.setQueryData(['count'], 1)
  const settled: string[] = []
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  const { result } = renderHook(
    () =>
      useOptimisticMutation({
        mutationKey: ['count'],
        mutationFn: save,
        edits: (n: number) => [edit<number>({ filters: { queryKey: ['count'] }, update: () => n })],
        settle: async () => {
          settled.push('read again')
        },
      }),
    { wrapper },
  )
  const count = () => client.getQueryData<number>(['count'])
  return { result, count, settled }
}

describe('useOptimisticMutation', () => {
  it('shows a change at once, and puts it back and says why when the server refuses it', async () => {
    const answer = held<number>()
    const { result, count, settled } = setUp(() => answer.promise)
    act(() => result.current.mutate(2))
    await waitFor(() => expect(count()).toBe(2))
    answer.refuse(new Error('The server is away.'))
    await waitFor(() => expect(result.current.failure?.message).toBe('The server is away.'))
    expect(count()).toBe(1)
    await waitFor(() => expect(settled).toEqual(['read again']))
    act(() => result.current.mutate(3))
    expect(result.current.failure).toBeNull()
  })

  it('sends changes one at a time, in order, and reads again once the last settles', async () => {
    const first = held<number>()
    const second = held<number>()
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
    first.answer(2)
    await waitFor(() => expect(sent).toEqual([2, 3]))
    expect(settled).toEqual([])
    second.answer(3)
    await waitFor(() => expect(settled).toEqual(['read again']))
    expect(count()).toBe(3)
  })
})
