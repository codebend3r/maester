import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import type * as Native from '@raven/native'
import { fireEvent, renderRouter, screen } from 'expo-router/testing-library'

import { queryClient } from '@/queryClient'
import { useWrenAccount } from '@/session'
import { LISTENER, OK_COMPUTER, RADIOHEAD, musicApi } from '@/test/music'
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

describe('Artist', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    queryClient.clear()
    useWrenAccount.setState({ session: LISTENER })
  })

  it("shows the artist's albums, opens one, and marks the artist a favourite", async () => {
    const router = await renderRouter(WREN_TREE, { initialUrl: `/artist/${RADIOHEAD.id}` })
    expect(await screen.findByRole('header', { name: RADIOHEAD.name })).toBeTruthy()

    await fireEvent.press(screen.getByRole('switch', { name: 'Favourite' }))
    expect(mockApi.setArtistFavourite).toHaveBeenCalledWith({
      artistId: RADIOHEAD.id,
      favourite: true,
    })

    await fireEvent.press(screen.getByRole('button', { name: `${OK_COMPUTER.title}, Radiohead` }))
    expect(await screen.findByRole('header', { name: OK_COMPUTER.title })).toBeTruthy()
    expect(router.getPathname()).toBe(`/album/${OK_COMPUTER.id}`)
  })
})
