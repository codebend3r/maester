import { afterEach, describe, expect, it, mock, spyOn } from 'bun:test'
import type { MediaItem } from '@raven/core'
import { QueryClient } from '@tanstack/react-query'
import { act, waitFor } from '@testing-library/react'
import { queryKeys } from '@/query/queryClient'
import { ravenQueriesFor } from '@/query/ravenQueries'
import { useTrackFavourite } from '@/query/useTrackFavourite'
import { mediaItem, track } from '@/test/fixtures'
import { recordingApi } from '@/test/recordingApi'
import { renderQueryHook } from '@/test/renderQueryHook'

const SONG = track()

const { api } = recordingApi({ body: [] })
const queries = ravenQueriesFor(api)

const clientWith = (favourites: readonly MediaItem[]) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(
    queryKeys.libraryFavourites(SONG.libraryId),
    favourites.map((media) => ({ media, poster: null })),
  )
  return client
}

describe('useTrackFavourite', () => {
  const spy = spyOn(api, 'setFavourite')

  afterEach(() => spy.mockReset())

  it("reads the song's favourite from its library's favourites", () => {
    const client = clientWith([mediaItem({ id: SONG.id })])
    const { result } = renderQueryHook({
      client,
      hook: () => useTrackFavourite({ api, queries, track: SONG, onFailure: mock() }),
    })
    expect(result.current.isLiked).toBe(true)
  })

  it('shows the new state before the server answers, and marks the song', async () => {
    const answer = Promise.withResolvers<MediaItem>()
    spy.mockImplementation(() => answer.promise)
    const client = clientWith([])
    const { result } = renderQueryHook({
      client,
      hook: () => useTrackFavourite({ api, queries, track: SONG, onFailure: mock() }),
    })

    act(() => result.current.onToggle())

    await waitFor(() => expect(result.current.isLiked).toBe(true))
    expect(spy).toHaveBeenCalledWith({ id: SONG.id, favourite: true })
    await act(async () => answer.resolve(mediaItem({ id: SONG.id })))
  })

  it('hands a refusal to onFailure', async () => {
    const refusal = new Error('refused')
    spy.mockImplementation(() => Promise.reject(refusal))
    const onFailure = mock()
    const { result } = renderQueryHook({
      client: clientWith([]),
      hook: () => useTrackFavourite({ api, queries, track: SONG, onFailure }),
    })

    act(() => result.current.onToggle())

    await waitFor(() => expect(onFailure).toHaveBeenCalledWith(refusal))
  })
})
