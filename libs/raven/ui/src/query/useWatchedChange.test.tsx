import { afterEach, describe, expect, it, spyOn } from 'bun:test'
import { QueryClient } from '@tanstack/react-query'
import { act, waitFor } from '@testing-library/react'
import { WATCHED_STATES, WATCH_TARGET_KINDS, type WatchedState } from '@raven/core'
import { queryKeys } from '@/query/queryClient'
import { watchedChangeFor } from '@/query/useWatchedChange'
import { recordingApi } from '@/test/recordingApi'
import { renderQueryHook } from '@/test/renderQueryHook'

const { api } = recordingApi({ body: null })
const { useWatchedChange, useWatchedToggle } = watchedChangeFor({ api })

const setUp = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(queryKeys.item(40), {})
  const { result } = renderQueryHook({ client, hook: () => useWatchedChange() })
  return { result, client }
}

type ChangeProps = { id: number; watched: boolean }

const change = ({ id, watched }: ChangeProps) => ({
  watched,
  targets: [{ kind: WATCH_TARGET_KINDS.item, id, libraryId: null }],
})

describe('useWatchedChange', () => {
  const spy = spyOn(api, 'setWatched')

  afterEach(() => spy.mockReset())

  it('reads what it touched again once the server has answered, not before', async () => {
    const answer = Promise.withResolvers<void>()
    spy.mockImplementation(() => answer.promise)
    const { result, client } = setUp()
    act(() => result.current.mutate(change({ id: 40, watched: true })))
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1))
    expect(client.getQueryState(queryKeys.item(40))!.isInvalidated).toBe(false)
    answer.resolve()
    await waitFor(() => expect(client.getQueryState(queryKeys.item(40))!.isInvalidated).toBe(true))
  })

  it('keeps marks in the order they were made', async () => {
    const first = Promise.withResolvers<void>()
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
    first.resolve()
    await waitFor(() => expect(seen).toEqual([1, 0]))
  })

  /** What pressing a toggle in `state` over show 40 sends. */
  const sentBy = async (state: WatchedState) => {
    spy.mockImplementation(async () => undefined)
    const targets = change({ id: 40, watched: true }).targets
    const { result } = renderQueryHook({
      client: new QueryClient(),
      hook: () => useWatchedToggle({ state, targets }),
    })
    expect(result.current.state).toBe(state)
    act(() => result.current.onToggle())
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1))
    return spy.mock.calls[0]![0]
  }

  it('has a toggle mark everything watched unless it all is already', async () => {
    expect(await sentBy(WATCHED_STATES.partly)).toEqual(change({ id: 40, watched: true }))
  })

  it('has a toggle mark everything unwatched once it all is watched', async () => {
    expect(await sentBy(WATCHED_STATES.watched)).toEqual(change({ id: 40, watched: false }))
  })
})
