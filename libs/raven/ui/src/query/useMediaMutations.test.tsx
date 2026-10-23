import { afterEach, describe, expect, it, spyOn } from 'bun:test'
import { QueryClient, type QueryKey } from '@tanstack/react-query'
import { act, cleanup, waitFor } from '@testing-library/react'
import {
  type ItemDetails,
  MEDIA_SORTS,
  type MediaItem,
  type PosterEntry,
  WATCH_TARGET_KINDS,
} from '@raven/core'
import { queryKeys } from '@/query/queryClient'
import { HISTORY_SHOWS } from '@/query/ravenQueries'
import { mediaMutationsFor } from '@/query/useMediaMutations'
import { itemDetails, matchedMovie, mediaItem } from '@/test/fixtures'
import { recordingApi } from '@/test/recordingApi'
import { renderQueryHook } from '@/test/renderQueryHook'

const { api } = recordingApi({ body: null })
const { useMediaMutations } = mediaMutationsFor({ api })

/** The tabs beside library 2's listing, every one of them showing the video's menu, each as it is cached with nothing in it. */
const TABS: ReadonlyArray<readonly [QueryKey, unknown]> = [
  [queryKeys.inProgress(2), []],
  [queryKeys.unmatched(2), []],
  [queryKeys.sagas(2), []],
  [queryKeys.history({ libraryId: 2, show: HISTORY_SHOWS.all, limit: 50 }), []],
  [queryKeys.libraryFavourites(2), []],
  [queryKeys.showLists(2), { shows: [], unmatched: [] }],
]

/** The hook for video 7 of library 2, its library's tabs already cached. */
const setUp = ({ media = mediaItem() }: { media?: MediaItem } = {}) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  TABS.forEach(([key, empty]) => client.setQueryData(key, empty))
  client.setQueryData(queryKeys.inProgress(3), [])
  const { result } = renderQueryHook({ client, hook: () => useMediaMutations({ media }) })
  const isStale = (key: QueryKey) => client.getQueryState(key)?.isInvalidated ?? false
  return { result, isStale, client }
}

describe('useMediaMutations', () => {
  const spies = {
    favourite: spyOn(api, 'setFavourite'),
    watched: spyOn(api, 'setWatched'),
    refresh: spyOn(api, 'refreshItem'),
    remove: spyOn(api, 'deleteMedia'),
  }

  afterEach(() => {
    cleanup()
    Object.values(spies).forEach((spy) => spy.mockReset())
  })

  it('reads every tab of the library again after favouriting, so none keeps a stale menu', async () => {
    spies.favourite.mockImplementation(async ({ favourite }) => mediaItem({ favourite }))
    const { result, isStale } = setUp()
    act(() => result.current.favourite.mutate(true))
    await waitFor(() => expect(TABS.filter(([key]) => !isStale(key))).toEqual([]))
  })

  /** Library 2's listing, sorted by title. */
  const LISTING = queryKeys.media({ libraryId: 2, search: '', sort: MEDIA_SORTS.title, seed: 0 })

  it('marks the video a favourite wherever it is cached, before the server answers', async () => {
    const answer = Promise.withResolvers<MediaItem>()
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
    answer.resolve({ ...movie, favourite: true })
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
    const later = Promise.withResolvers<MediaItem>()
    spies.favourite.mockImplementation(async ({ id }) => {
      if (id === 7) throw new Error('The server is away.')
      return later.promise
    })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const elsewhere = queryKeys.media({
      libraryId: 3,
      search: '',
      sort: MEDIA_SORTS.title,
      seed: 0,
    })
    client.setQueryData(LISTING, [mediaItem()])
    client.setQueryData(elsewhere, [mediaItem({ id: 9, libraryId: 3 })])
    const { result } = renderQueryHook({
      client,
      hook: () => ({
        seven: useMediaMutations({ media: mediaItem() }),
        nine: useMediaMutations({ media: mediaItem({ id: 9, libraryId: 3 }) }),
      }),
    })
    act(() => {
      result.current.seven.favourite.mutate(true)
      result.current.nine.favourite.mutate(true)
    })
    await waitFor(() =>
      expect(result.current.seven.favourite.failure?.message).toBe('The server is away.'),
    )
    later.resolve(mediaItem({ id: 9, libraryId: 3, favourite: true }))
    await waitFor(() =>
      expect([LISTING, elsewhere].map((key) => client.getQueryState(key)?.isInvalidated)).toEqual([
        true,
        true,
      ]),
    )
  })

  it('takes an unmarked favourite off the favourites at once', async () => {
    spies.favourite.mockImplementation(() => Promise.withResolvers<MediaItem>().promise)
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

  it('marks the card watched wherever it is cached, before the server answers', async () => {
    const answer = Promise.withResolvers<void>()
    spies.watched.mockImplementation(() => answer.promise)
    const movie = matchedMovie({ position: 30 })
    const { result, client } = setUp({ media: movie })
    client.setQueryData(LISTING, [movie])
    client.setQueryData(queryKeys.inProgress(2), [{ media: movie, poster: null }])
    act(() => result.current.watched.mutate(true))
    await waitFor(() =>
      expect(client.getQueryData<MediaItem[]>(LISTING)).toEqual([
        { ...movie, watched: true, position: 0 },
      ]),
    )
    expect(client.getQueryData<PosterEntry[]>(queryKeys.inProgress(2))).toEqual([])
    expect(spies.watched).toHaveBeenCalledWith({
      watched: true,
      targets: [{ kind: WATCH_TARGET_KINDS.media, id: 7 }],
    })
    answer.resolve()
  })

  it('takes the mark back when the server refuses it', async () => {
    spies.watched.mockImplementation(async () => {
      throw new Error('The server is away.')
    })
    const { result, client } = setUp()
    client.setQueryData(LISTING, [mediaItem()])
    act(() => result.current.watched.mutate(true))
    await waitFor(() => expect(result.current.watched.failure?.message).toBe('The server is away.'))
    expect(client.getQueryData<MediaItem[]>(LISTING)).toEqual([mediaItem()])
  })

  it('reads every tab of the library and the item pages again after marking', async () => {
    spies.watched.mockImplementation(async () => undefined)
    const { result, isStale, client } = setUp()
    client.setQueryData(queryKeys.item(40), itemDetails())
    act(() => result.current.watched.mutate(true))
    await waitFor(() => expect(TABS.filter(([key]) => !isStale(key))).toEqual([]))
    expect(isStale(queryKeys.item(40))).toBe(true)
  })

  it('reads every tab of the library again after a refresh', async () => {
    spies.refresh.mockImplementation(async () => itemDetails())
    const { result, isStale } = setUp()
    act(() => result.current.refresh.mutate(40))
    await waitFor(() => expect(result.current.refresh.isSuccess).toBe(true))
    expect(TABS.filter(([key]) => !isStale(key))).toEqual([])
    expect(isStale(queryKeys.inProgress(3))).toBe(false)
  })

  it('drops a deleted video from every cache, then reads every library and home again', async () => {
    spies.remove.mockImplementation(async () => undefined)
    const { result, isStale, client } = setUp()
    const entries: PosterEntry[] = [
      { media: mediaItem({ favourite: true }), poster: null },
      { media: mediaItem({ id: 8, favourite: true }), poster: null },
    ]
    client.setQueryData(LISTING, [mediaItem(), mediaItem({ id: 8 })])
    client.setQueryData(queryKeys.mediaItem(7), mediaItem())
    client.setQueryData(queryKeys.favourites, entries)
    client.setQueryData(queryKeys.libraries, [])
    client.setQueryData(queryKeys.item(40), itemDetails())
    client.setQueryData(queryKeys.home, {})
    act(() => result.current.remove.mutate())
    await waitFor(() => expect(result.current.remove.isSuccess).toBe(true))
    expect(spies.remove).toHaveBeenCalledWith(7)
    expect(client.getQueryData(queryKeys.mediaItem(7))).toBeUndefined()
    expect(client.getQueryData<MediaItem[]>(LISTING)).toEqual([mediaItem({ id: 8 })])
    expect(client.getQueryData<PosterEntry[]>(queryKeys.favourites)).toEqual(entries.slice(1))
    expect([queryKeys.libraries, queryKeys.item(40), queryKeys.home].map(isStale)).toEqual([
      true,
      true,
      true,
    ])
  })
})
