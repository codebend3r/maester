import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import { MUSIC_PAGE, MUSIC_SORTS } from '@raven/core'
import type * as Native from '@raven/native'
import { fireEvent, renderRouter, screen } from 'expo-router/testing-library'

import { queryClient } from '@/queryClient'
import { WREN_ROUTES } from '@/routes'
import { useWrenAccount } from '@/session'
import { LISTENER, MIXTAPE, MUSIC, OK_COMPUTER, RADIOHEAD, musicApi, trackFor } from '@/test/music'
import { WREN_TREE } from '@/test/wrenTree'

const mockApi = musicApi()

jest.mock('expo-splash-screen', () => ({
  preventAutoHideAsync: async () => true,
  hideAsync: async () => {},
}))
jest.mock('@raven/native', () => ({
  ...jest.requireActual<typeof Native>('@raven/native'),
  apiFor: () => mockApi,
  cookieJar: { read: async () => ({}), forget: async () => {} },
  secretStore: {
    getItemAsync: async () => null,
    setItemAsync: async () => {},
    deleteItemAsync: async () => {},
  },
}))

/** A full first page of a library holding more songs than one page. */
const FIRST_PAGE = Array.from({ length: MUSIC_PAGE.most }, (_, at) =>
  trackFor({ id: 1000 + at, title: `Song ${at + 1}` }),
)

describe('Library', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    queryClient.clear()
    useWrenAccount.setState({ session: LISTENER })
  })

  it("opens on the music libraries' albums, and lists the artists", async () => {
    await renderRouter(WREN_TREE, { initialUrl: WREN_ROUTES.library })
    expect(
      await screen.findByRole('button', { name: `${OK_COMPUTER.title}, Radiohead` }),
    ).toBeTruthy()
    expect(mockApi.listAlbums).toHaveBeenCalledWith({
      libraryId: MUSIC.id,
      search: '',
      sort: MUSIC_SORTS.title,
    })

    await fireEvent.press(screen.getByRole('tab', { name: 'Artists' }))
    expect(await screen.findByRole('button', { name: RADIOHEAD.name })).toBeTruthy()
  })

  it('lists the songs a page at a time, asking for the next page at the end of the list', async () => {
    mockApi.listTracks.mockImplementation(async ({ offset = 0 }) =>
      offset === 0
        ? { tracks: FIRST_PAGE, total: MUSIC_PAGE.most + 1 }
        : { tracks: [trackFor({ id: 9, title: 'Last song' })], total: MUSIC_PAGE.most + 1 },
    )
    await renderRouter(WREN_TREE, { initialUrl: WREN_ROUTES.library })
    await fireEvent.press(await screen.findByRole('tab', { name: 'Songs' }))

    expect(await screen.findByRole('button', { name: 'Song 1' })).toBeTruthy()
    expect(mockApi.listTracks).toHaveBeenCalledTimes(1)
    expect(mockApi.listTracks).toHaveBeenCalledWith({
      libraryId: MUSIC.id,
      search: '',
      sort: MUSIC_SORTS.title,
      limit: MUSIC_PAGE.most,
      offset: 0,
    })

    await fireEvent(screen.getByTestId('songs'), 'endReached')
    expect(mockApi.listTracks).toHaveBeenCalledTimes(2)
    expect(mockApi.listTracks).toHaveBeenLastCalledWith({
      libraryId: MUSIC.id,
      search: '',
      sort: MUSIC_SORTS.title,
      limit: MUSIC_PAGE.most,
      offset: MUSIC_PAGE.most,
    })
  })

  it("lists the listener's playlists, and opens one", async () => {
    const router = await renderRouter(WREN_TREE, { initialUrl: WREN_ROUTES.library })
    await fireEvent.press(await screen.findByRole('tab', { name: 'Playlists' }))
    await fireEvent.press(await screen.findByRole('button', { name: MIXTAPE.name }))
    expect(await screen.findByRole('header', { name: MIXTAPE.name })).toBeTruthy()
    expect(router.getPathname()).toBe(`/playlist/${MIXTAPE.id}`)
  })
})
