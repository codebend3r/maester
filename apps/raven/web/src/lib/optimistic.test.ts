import { describe, expect, it } from 'bun:test'
import { MutationObserver, QueryClient } from '@tanstack/react-query'
import { waitFor } from '@testing-library/react'
import { type MediaItem, isMediaItem } from '@raven/core'
import { optimisticChange, patchEvery, patchQueries } from '@/lib/optimistic'
import { itemDetails, mediaItem } from '@/test/fixtures'
import { held } from '@/test/held'

const favourite = patchEvery({
  guard: isMediaItem,
  id: 7,
  patch: (media: MediaItem) => ({ ...media, favourite: true }),
})

describe('patchEvery', () => {
  it('reaches every copy of the video, however deep, and leaves the rest as they were', () => {
    const other = mediaItem({ id: 8 })
    const data = {
      listing: [mediaItem({ id: 7 }), other],
      entries: [{ media: mediaItem({ id: 7 }), poster: null }],
    }
    const patched = favourite(data)
    expect(patched).toEqual({
      listing: [mediaItem({ id: 7, favourite: true }), other],
      entries: [{ media: mediaItem({ id: 7, favourite: true }), poster: null }],
    })
  })

  it('hands back the very same data where the video is not', () => {
    // An item with the same id as the video is not the video.
    const data = {
      listing: [mediaItem({ id: 8 })],
      details: itemDetails({ id: 7, versions: [mediaItem({ id: 9 })] }),
    }
    expect(favourite(data)).toBe(data)
  })
})

describe('patchQueries', () => {
  it('changes only the queries holding the video, and says what they held', async () => {
    const client = new QueryClient()
    const before = [mediaItem({ id: 7 })]
    client.setQueryData(['holding'], before)
    client.setQueryData(['other'], [mediaItem({ id: 8 })])
    const untouchedAt = client.getQueryState(['other'])?.dataUpdatedAt
    const snapshot = await patchQueries({
      queryClient: client,
      filters: [{ queryKey: ['holding'] }, { queryKey: ['other'] }],
      patch: favourite,
    })
    expect(snapshot).toEqual([[['holding'], before]])
    expect(client.getQueryData<MediaItem[]>(['holding'])).toEqual([
      mediaItem({ id: 7, favourite: true }),
    ])
    expect(client.getQueryState(['other'])?.dataUpdatedAt).toBe(untouchedAt)
  })
})

describe('optimisticChange', () => {
  /** A stored count of 1, and a way to change it that `save` sends on. */
  const setUp = () => {
    const client = new QueryClient()
    client.setQueryData(['count'], 1)
    const settled: string[] = []
    const change = ({ to, save }: { to: number; save: () => Promise<number> }) =>
      new MutationObserver(client, {
        mutationFn: save,
        ...optimisticChange<number>({
          queryClient: client,
          mutationKey: ['count'],
          apply: (n) =>
            patchQueries({
              queryClient: client,
              filters: [{ queryKey: ['count'] }],
              patch: () => n,
            }),
          settle: async () => {
            settled.push('read again')
          },
        }),
      }).mutate(to)
    const count = () => client.getQueryData<number>(['count'])
    return { change, count, settled }
  }

  it('shows the change at once and puts it back when the server refuses it', async () => {
    const { change, count, settled } = setUp()
    const answer = held<number>()
    const saving = change({ to: 2, save: () => answer.promise })
    await waitFor(() => expect(count()).toBe(2))
    answer.refuse(new Error('No.'))
    await expect(saving).rejects.toThrow('No.')
    expect(count()).toBe(1)
    expect(settled).toEqual(['read again'])
  })

  it('reads again once the last change in flight settles, whatever order the answers come in', async () => {
    const { change, count, settled } = setUp()
    const first = held<number>()
    const second = held<number>()
    const firstSave = change({ to: 2, save: () => first.promise })
    const secondSave = change({ to: 3, save: () => second.promise })
    second.answer(3)
    await secondSave
    expect(settled).toEqual([])
    first.answer(2)
    await firstSave
    expect(settled).toEqual(['read again'])
    expect(count()).toBe(3)
  })
})
