import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import { MUSIC_PAGE, MUSIC_SORTS } from '@raven/core'
import type * as Native from '@raven/native'
import { fireEvent, renderRouter, screen } from 'expo-router/testing-library'

import { queryClient } from '@/queryClient'
import { WREN_ROUTES } from '@/routes'
import { useWrenAccount } from '@/session'
import { AIRBAG, LISTENER, MUSIC, OK_COMPUTER, RADIOHEAD, musicApi } from '@/test/music'
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

describe('Search', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    queryClient.clear()
    useWrenAccount.setState({ session: LISTENER })
  })

  it('shows the albums, artists and songs the search was answered with', async () => {
    mockApi.listTracks.mockResolvedValue({ tracks: [AIRBAG], total: 1 })
    await renderRouter(WREN_TREE, { initialUrl: WREN_ROUTES.search })
    const box = await screen.findByLabelText('Search your music')
    await fireEvent.changeText(box, 'radio')
    await fireEvent(box, 'submitEditing')

    expect(
      await screen.findByRole('button', { name: `${OK_COMPUTER.title}, Radiohead` }),
    ).toBeTruthy()
    expect(screen.getByRole('button', { name: RADIOHEAD.name })).toBeTruthy()
    expect(screen.getByRole('button', { name: AIRBAG.title })).toBeTruthy()
    const search = { libraryId: MUSIC.id, search: 'radio', sort: MUSIC_SORTS.title }
    expect(mockApi.listAlbums).toHaveBeenCalledWith(search)
    expect(mockApi.listArtists).toHaveBeenCalledWith({ libraryId: MUSIC.id, search: 'radio' })
    expect(mockApi.listTracks).toHaveBeenCalledWith({
      ...search,
      limit: MUSIC_PAGE.most,
      offset: 0,
    })
  })

  it('asks nothing until something is typed, and says when nothing matches', async () => {
    mockApi.listAlbums.mockResolvedValue([])
    mockApi.listArtists.mockResolvedValue([])
    mockApi.listTracks.mockResolvedValue({ tracks: [], total: 0 })
    await renderRouter(WREN_TREE, { initialUrl: WREN_ROUTES.search })
    const box = await screen.findByLabelText('Search your music')
    expect(mockApi.listAlbums).not.toHaveBeenCalled()

    await fireEvent.changeText(box, 'zz')
    await fireEvent(box, 'submitEditing')
    expect(await screen.findByText('Nothing in your music matches "zz".')).toBeTruthy()
  })
})
