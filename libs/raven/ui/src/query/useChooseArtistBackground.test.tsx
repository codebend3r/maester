import { afterEach, describe, expect, it, mock, spyOn } from 'bun:test'
import type { ArtistDetails } from '@raven/core'
import { QueryClient } from '@tanstack/react-query'
import { act, waitFor } from '@testing-library/react'
import { queryKeys } from '@/query/queryClient'
import { useChooseArtistBackground } from '@/query/useChooseArtistBackground'
import { recordingApi } from '@/test/recordingApi'
import { renderQueryHook } from '@/test/renderQueryHook'

const ARTIST_PAGE: ArtistDetails = {
  artist: {
    id: 1,
    name: 'Radiohead',
    sortName: 'Radiohead',
    mbid: null,
    photoVersion: 'v2',
    albumCount: 0,
    trackCount: 0,
  },
  albums: [],
  appearsOn: [],
  isFavourite: false,
}

const { api } = recordingApi({ body: null })

const freshClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } })

describe('useChooseArtistBackground', () => {
  const spy = spyOn(api, 'setArtistBackground')

  afterEach(() => spy.mockReset())

  it("sets the choice, puts the answer on the artist's page, reads the options again and closes", async () => {
    spy.mockImplementation(async () => ARTIST_PAGE)
    const client = freshClient()
    client.setQueryData(queryKeys.artistBackgrounds(ARTIST_PAGE.artist.id), [])
    const onChosen = mock()
    const { result } = renderQueryHook({
      client,
      hook: () =>
        useChooseArtistBackground({
          api,
          artistId: ARTIST_PAGE.artist.id,
          onChosen,
          onFailure: mock(),
        }),
    })

    act(() => result.current.mutate('cover-7'))

    await waitFor(() => expect(onChosen).toHaveBeenCalledTimes(1))
    expect(spy).toHaveBeenCalledWith({ artistId: ARTIST_PAGE.artist.id, key: 'cover-7' })
    expect(client.getQueryData(queryKeys.artist(ARTIST_PAGE.artist.id))).toEqual(ARTIST_PAGE)
    expect(
      client.getQueryState(queryKeys.artistBackgrounds(ARTIST_PAGE.artist.id))!.isInvalidated,
    ).toBe(true)
  })

  it('hands a refusal to onFailure and stays open', async () => {
    const refusal = new Error('refused')
    spy.mockImplementation(() => Promise.reject(refusal))
    const onChosen = mock()
    const onFailure = mock()
    const { result } = renderQueryHook({
      client: freshClient(),
      hook: () =>
        useChooseArtistBackground({ api, artistId: ARTIST_PAGE.artist.id, onChosen, onFailure }),
    })

    act(() => result.current.mutate(null))

    await waitFor(() => expect(onFailure).toHaveBeenCalled())
    expect(onFailure.mock.calls[0]![0]).toBe(refusal)
    expect(onChosen).not.toHaveBeenCalled()
  })
})
