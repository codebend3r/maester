import { afterEach, describe, expect, it, spyOn } from 'bun:test'
import { QueryClient } from '@tanstack/react-query'
import { act, waitFor } from '@testing-library/react'
import type { AlbumDetails, AlbumSummary, Artist, ArtistDetails } from '@raven/core'
import { queryKeys } from '@/query/queryClient'
import { musicFavouritesFor } from '@/query/useMusicFavourite'
import { recordingApi } from '@/test/recordingApi'
import { renderQueryHook } from '@/test/renderQueryHook'
import { track } from '@/test/fixtures'

const ALBUM: AlbumSummary = {
  id: 7,
  libraryId: 3,
  title: 'OK Computer',
  sortTitle: 'OK Computer',
  releaseDate: null,
  year: 1997,
  type: 'album',
  artists: [{ id: 1, name: 'Radiohead' }],
  isCompilation: false,
  trackCount: 1,
  duration: 200,
  coverVersion: null,
  match: 'matched',
  addedAt: '2026-01-01T00:00:00Z',
}

const ALBUM_PAGE: AlbumDetails = {
  album: ALBUM,
  label: null,
  genres: [],
  mbid: null,
  discCount: 1,
  tracks: [track()],
  isFavourite: true,
}

const ARTIST: Artist = {
  id: 1,
  name: 'Radiohead',
  sortName: 'Radiohead',
  mbid: null,
  albumCount: 1,
  trackCount: 1,
}

const ARTIST_PAGE: ArtistDetails = {
  artist: ARTIST,
  albums: [ALBUM],
  appearsOn: [],
  isFavourite: false,
}

const { api } = recordingApi({ body: null })
const { useAlbumFavourite, useArtistFavourite } = musicFavouritesFor({ api })

const freshClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } })

describe('useAlbumFavourite', () => {
  const spy = spyOn(api, 'setAlbumFavourite')

  afterEach(() => spy.mockReset())

  it('unmarks the album on its page and takes it off the favourites before the server answers', async () => {
    const answer = Promise.withResolvers<AlbumDetails>()
    spy.mockImplementation(() => answer.promise)
    const client = freshClient()
    client.setQueryData(queryKeys.album(ALBUM.id), ALBUM_PAGE)
    client.setQueryData(queryKeys.favouriteAlbums, [ALBUM])
    const { result } = renderQueryHook({
      client,
      hook: () => useAlbumFavourite({ albumId: ALBUM.id }),
    })

    act(() => result.current.mutate(false))

    await waitFor(() =>
      expect(
        client.getQueryData<AlbumDetails>(queryKeys.album(ALBUM.id))?.isFavourite ?? null,
      ).toBe(false),
    )
    expect(client.getQueryData<AlbumSummary[]>(queryKeys.favouriteAlbums)).toEqual([])
    expect(spy).toHaveBeenCalledWith({ albumId: ALBUM.id, favourite: false })
    answer.resolve({ ...ALBUM_PAGE, isFavourite: false })
  })

  it('puts the page back when the server refuses', async () => {
    spy.mockImplementation(() => Promise.reject(new Error('No')))
    const client = freshClient()
    client.setQueryData(queryKeys.album(ALBUM.id), ALBUM_PAGE)
    const { result } = renderQueryHook({
      client,
      hook: () => useAlbumFavourite({ albumId: ALBUM.id }),
    })

    act(() => result.current.mutate(false))

    await waitFor(() => expect(result.current.failure?.message ?? null).toBe('No'))
    expect(client.getQueryData<AlbumDetails>(queryKeys.album(ALBUM.id))?.isFavourite ?? null).toBe(
      true,
    )
  })
})

describe('useArtistFavourite', () => {
  const spy = spyOn(api, 'setArtistFavourite')

  afterEach(() => spy.mockReset())

  it('marks the artist on their page before the server answers, then asks the server', async () => {
    const answer = Promise.withResolvers<ArtistDetails>()
    spy.mockImplementation(() => answer.promise)
    const client = freshClient()
    client.setQueryData(queryKeys.artist(ARTIST.id), ARTIST_PAGE)
    const { result } = renderQueryHook({
      client,
      hook: () => useArtistFavourite({ artistId: ARTIST.id }),
    })

    act(() => result.current.mutate(true))

    await waitFor(() =>
      expect(
        client.getQueryData<ArtistDetails>(queryKeys.artist(ARTIST.id))?.isFavourite ?? null,
      ).toBe(true),
    )
    expect(spy).toHaveBeenCalledWith({ artistId: ARTIST.id, favourite: true })
    answer.resolve({ ...ARTIST_PAGE, isFavourite: true })
  })
})
