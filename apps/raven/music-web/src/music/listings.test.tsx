import { describe, expect, it } from 'bun:test'
import { LIBRARY_KINDS } from '@raven/core'
import { RECENT_SORTS, queryListStateOf } from '@raven/wren'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import {
  useAllAlbums,
  useAllArtists,
  usePlaylists,
  useRecentAlbums,
  useSongCount,
} from '@/music/listings'
import { useMusicLibraries } from '@/music/musicLibraries'
import { useWrenPrefs } from '@/stores/wrenPrefs'
import { FILMS, MIXTAPE, MUSIC, OK_COMPUTER, RADIOHEAD, mockMusicApiEach } from '@/test/music'
import { testQueryClient } from '@/test/render'

type WrapperProps = { children: ReactNode }

const withQueries = () => {
  const client = testQueryClient()
  return ({ children }: WrapperProps) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
}

/** A second music library, so there is one to switch to. */
const VINYL = { ...MUSIC, id: 6, name: 'Vinyl' }

const KID_A = { ...OK_COMPUTER, id: 8, libraryId: VINYL.id, title: 'Kid A', sortTitle: 'Kid A' }

describe('the lists over the music library worn', () => {
  const music = mockMusicApiEach()

  it('reads only the libraries raven lists by album', async () => {
    const { result } = renderHook(() => useMusicLibraries(), { wrapper: withQueries() })

    await waitFor(() => expect(result.current.isRead).toBe(true))

    expect(result.current.libraries).toEqual([MUSIC])
    expect(result.current.all).toEqual([MUSIC])
    expect(result.current.failure).toBeNull()
    expect(FILMS.settings.kind).toBe(LIBRARY_KINDS.movies)
  })

  it("lists the first library's albums until another is picked, then that one's alone", async () => {
    music().listLibraries.mockResolvedValue([MUSIC, VINYL])
    music().listAlbums.mockImplementation(async ({ libraryId }) =>
      libraryId === VINYL.id ? [KID_A] : [OK_COMPUTER],
    )
    const { result } = renderHook(() => useAllAlbums({ search: '' }), { wrapper: withQueries() })

    await waitFor(() => expect(result.current.listing.isRead).toBe(true))
    expect(result.current.albums.map((album) => album.title)).toEqual(['OK Computer'])

    act(() => useWrenPrefs.getState().change({ libraryId: VINYL.id }))

    await waitFor(() =>
      expect(result.current.albums.map((album) => album.title)).toEqual(['Kid A']),
    )
    expect(result.current.listing).toMatchObject({ failure: null, hasNoMusic: false })
  })

  it('offers every music library to pick from, and wears the first when the pick is gone', async () => {
    music().listLibraries.mockResolvedValue([MUSIC, VINYL])
    useWrenPrefs.getState().change({ libraryId: 404 })
    const { result } = renderHook(() => useMusicLibraries(), { wrapper: withQueries() })

    await waitFor(() => expect(result.current.isRead).toBe(true))

    expect(result.current.all).toEqual([MUSIC, VINYL])
    expect(result.current.libraries).toEqual([MUSIC])
  })

  it('asks for nothing while a search has nothing typed', async () => {
    const { result } = renderHook(() => useAllAlbums({ search: '', isEnabled: false }), {
      wrapper: withQueries(),
    })

    await waitFor(() => expect(music().listLibraries).toHaveBeenCalled())

    expect(music().listAlbums).not.toHaveBeenCalled()
    expect(result.current.albums).toEqual([])
  })

  it('says raven holds no music when it has no music library', async () => {
    music().listLibraries.mockResolvedValue([FILMS])
    const { result } = renderHook(() => useAllArtists({ search: '' }), { wrapper: withQueries() })

    await waitFor(() => expect(result.current.listing.isRead).toBe(true))

    expect(result.current.listing.hasNoMusic).toBe(true)
    expect(result.current.artists).toEqual([])
  })

  it("lists the library's artists, and says why when raven cannot be read", async () => {
    const { result, unmount } = renderHook(() => useAllArtists({ search: 'radio' }), {
      wrapper: withQueries(),
    })
    await waitFor(() => expect(result.current.artists).toEqual([RADIOHEAD]))
    expect(music().listArtists).toHaveBeenCalledWith(
      expect.objectContaining({ libraryId: MUSIC.id, search: 'radio' }),
    )
    unmount()

    const failure = new TypeError('Failed to fetch')
    music().listLibraries.mockRejectedValue(failure)
    const failed = renderHook(() => useAllArtists({ search: '' }), { wrapper: withQueries() })

    await waitFor(() => expect(failed.result.current.listing.failure).toBe(failure))
  })

  it('asks the library for its newest albums, as many as the place shows', async () => {
    const { result } = renderHook(() => useRecentAlbums({ sort: RECENT_SORTS.added, limit: 12 }), {
      wrapper: withQueries(),
    })

    await waitFor(() => expect(result.current.listing.isRead).toBe(true))

    expect(result.current.albums).toEqual([OK_COMPUTER])
  })

  it("counts the worn library's songs alone, and guesses no count before it has answered", async () => {
    music().listLibraries.mockResolvedValue([MUSIC, VINYL])
    const { result } = renderHook(() => useSongCount({ search: '' }), { wrapper: withQueries() })
    expect(result.current).toBeNull()

    await waitFor(() => expect(result.current).toBe(3))
  })

  it("reads the account's playlists, a list no music library holds", async () => {
    const { result } = renderHook(() => usePlaylists(), { wrapper: withQueries() })

    await waitFor(() => expect(result.current.data).toEqual([MIXTAPE]))

    expect(queryListStateOf(result.current)).toEqual({
      failure: null,
      isRead: true,
      hasNoMusic: false,
    })
  })
})
