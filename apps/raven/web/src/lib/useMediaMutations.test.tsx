import { afterEach, describe, expect, it, spyOn } from 'bun:test'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ItemDetails, MediaItem, PosterEntry } from '@raven/core'
import type { ReactNode } from 'react'
import { api } from '@/lib/api'
import { queryKeys } from '@/lib/queryClient'
import { useMediaMutations } from '@/lib/useMediaMutations'
import { itemDetails, matchedMovie, mediaItem } from '@/test/fixtures'
import { held } from '@/test/held'

/** The tabs beside library 2's listing, every one of them showing the video's menu, each as it is cached with nothing in it. */
const TABS: ReadonlyArray<readonly [readonly unknown[], unknown]> = [
  [queryKeys.inProgress(2), []],
  [queryKeys.unmatched(2), []],
  [queryKeys.sagas(2), []],
  [queryKeys.history({ libraryId: 2, show: '', limit: 50 }), []],
  [queryKeys.libraryFavourites(2), []],
  [queryKeys.showLists(2), { shows: [], unmatched: [] }],
]

/** The hook for video 7 of library 2, its library's tabs already cached. */
const setUp = ({ media = mediaItem() }: { media?: MediaItem } = {}) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  TABS.forEach(([key, empty]) => client.setQueryData(key, empty))
  client.setQueryData(queryKeys.inProgress(3), [])
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  const { result } = renderHook(() => useMediaMutations({ media }), { wrapper })
  const isStale = (key: readonly unknown[]) => !!client.getQueryState(key)?.isInvalidated
  return { result, isStale, client }
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
    await waitFor(() => expect(TABS.filter(([key]) => !isStale(key))).toEqual([]))
  })

  /** Library 2's listing, sorted by title. */
  const LISTING = queryKeys.media({ libraryId: 2, search: '', sort: 'title', seed: 0 })

  it('marks the video a favourite wherever it is cached, before the server answers', async () => {
    const answer = held<MediaItem>()
    spies.favourite.mockImplementation(() => answer.promise)
    const movie = matchedMovie()
    const { result, client } = setUp({ media: movie })
    client.setQueryData(LISTING, [movie, mediaItem({ id: 8 })])
    client.setQueryData(queryKeys.item(40), itemDetails({ id: 40, versions: [movie] }))
    act(() => result.current.favourite.mutate(true))
    await waitFor(() =>
      expect(client.getQueryData<MediaItem[]>(LISTING)).toEqual([
        { ...movie, favourite: true },
        mediaItem({ id: 8 }),
      ]),
    )
    expect(client.getQueryData<ItemDetails>(queryKeys.item(40))?.versions).toEqual([
      { ...movie, favourite: true },
    ])
    answer.answer({ ...movie, favourite: true })
  })

  it('takes the favourite back when the server refuses it', async () => {
    spies.favourite.mockImplementation(async () => {
      throw new Error('The server is away.')
    })
    const { result, client } = setUp()
    client.setQueryData(LISTING, [mediaItem()])
    act(() => result.current.favourite.mutate(true))
    await waitFor(() =>
      expect(result.current.favourite.failure?.message).toBe('The server is away.'),
    )
    expect(client.getQueryData<MediaItem[]>(LISTING)).toEqual([mediaItem()])
  })

  it('reads again every library a run of favourites touched, the refused one too', async () => {
    const later = held<MediaItem>()
    spies.favourite.mockImplementation(async ({ id }) => {
      if (id === 7) throw new Error('The server is away.')
      return later.promise
    })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const elsewhere = queryKeys.media({ libraryId: 3, search: '', sort: 'title', seed: 0 })
    client.setQueryData(LISTING, [mediaItem()])
    client.setQueryData(elsewhere, [mediaItem({ id: 9, libraryId: 3 })])
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )
    const { result } = renderHook(
      () => ({
        seven: useMediaMutations({ media: mediaItem() }),
        nine: useMediaMutations({ media: mediaItem({ id: 9, libraryId: 3 }) }),
      }),
      { wrapper },
    )
    act(() => {
      result.current.seven.favourite.mutate(true)
      result.current.nine.favourite.mutate(true)
    })
    await waitFor(() =>
      expect(result.current.seven.favourite.failure?.message).toBe('The server is away.'),
    )
    later.answer(mediaItem({ id: 9, libraryId: 3, favourite: true }))
    await waitFor(() =>
      expect([LISTING, elsewhere].map((key) => client.getQueryState(key)?.isInvalidated)).toEqual([
        true,
        true,
      ]),
    )
  })

  it('takes an unmarked favourite off the favourites at once', async () => {
    spies.favourite.mockImplementation(() => held<MediaItem>().promise)
    const { result, client } = setUp()
    const entries: PosterEntry[] = [
      { media: mediaItem({ favourite: true }), poster: null },
      { media: mediaItem({ id: 8, favourite: true }), poster: null },
    ]
    client.setQueryData(queryKeys.favourites, entries)
    client.setQueryData(queryKeys.libraryFavourites(2), entries)
    act(() => result.current.favourite.mutate(false))
    await waitFor(() =>
      expect(client.getQueryData<PosterEntry[]>(queryKeys.favourites)).toEqual(entries.slice(1)),
    )
    expect(client.getQueryData<PosterEntry[]>(queryKeys.libraryFavourites(2))).toEqual(
      entries.slice(1),
    )
  })

  it('reads every tab of the library again after a refresh', async () => {
    spies.refresh.mockImplementation(async () => itemDetails())
    const { result, isStale } = setUp()
    act(() => result.current.refresh.mutate(40))
    await waitFor(() => expect(result.current.refresh.isSuccess).toBe(true))
    expect(TABS.filter(([key]) => !isStale(key))).toEqual([])
    expect(isStale(queryKeys.inProgress(3))).toBe(false)
  })
})
