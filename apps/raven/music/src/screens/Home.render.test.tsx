import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import { MUSIC_SORTS } from '@raven/core'
import type * as Native from '@raven/native'
import { fireEvent, renderRouter, screen } from 'expo-router/testing-library'

import { queryClient } from '@/queryClient'
import { WREN_ROUTES } from '@/routes'
import { useWrenAccount } from '@/session'
import { LISTENER, MUSIC, OK_COMPUTER, musicApi } from '@/test/music'
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

describe('Home', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    queryClient.clear()
    useWrenAccount.setState({ session: LISTENER })
  })

  it("shows each music library's twenty newest albums, and opens one", async () => {
    const router = await renderRouter(WREN_TREE, { initialUrl: WREN_ROUTES.home })
    const tile = await screen.findByRole('button', { name: `${OK_COMPUTER.title}, Radiohead` })
    expect(screen.getByRole('header', { name: 'Recently added' })).toBeTruthy()
    expect(mockApi.listAlbums).toHaveBeenCalledTimes(1)
    expect(mockApi.listAlbums).toHaveBeenCalledWith({
      libraryId: MUSIC.id,
      sort: MUSIC_SORTS.added,
      limit: 20,
    })

    await fireEvent.press(tile)
    expect(await screen.findByRole('header', { name: OK_COMPUTER.title })).toBeTruthy()
    expect(router.getPathname()).toBe(`/album/${OK_COMPUTER.id}`)
  })

  it('says so when raven holds no music', async () => {
    mockApi.listLibraries.mockResolvedValue([])
    await renderRouter(WREN_TREE, { initialUrl: WREN_ROUTES.home })
    expect(await screen.findByText('raven has no music library yet.')).toBeTruthy()
  })
})
