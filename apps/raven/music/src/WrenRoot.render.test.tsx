import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import type * as Native from '@raven/native'
import { queryKeys } from '@raven/ui/headless'
import { act, renderRouter, screen } from 'expo-router/testing-library'

import { queryClient } from '@/queryClient'
import { WREN_ROUTES } from '@/routes'
import { useWrenAccount } from '@/session'
import { LISTENER, MIXTAPE, musicApi } from '@/test/music'
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

describe('WrenRoot', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    queryClient.clear()
    useWrenAccount.setState({ session: LISTENER })
  })

  it("forgets what one account read once another signs in, so it never shows the last one's playlists", async () => {
    await renderRouter(WREN_TREE, { initialUrl: WREN_ROUTES.settings })
    await screen.findByText(`Signed in as ${LISTENER.email}`)
    queryClient.setQueryData(queryKeys.playlistList, [MIXTAPE])

    await act(async () =>
      useWrenAccount.setState({ session: { ...LISTENER, accessToken: 'renewed' } }),
    )
    expect(queryClient.getQueryData(queryKeys.playlistList)).toEqual([MIXTAPE])

    await act(async () => useWrenAccount.setState({ session: { ...LISTENER, userId: 'u2' } }))
    expect(queryClient.getQueryData(queryKeys.playlistList)).toBeUndefined()

    queryClient.setQueryData(queryKeys.playlistList, [MIXTAPE])
    await act(async () => useWrenAccount.setState({ session: null }))
    expect(queryClient.getQueryData(queryKeys.playlistList)).toBeUndefined()
    expect(mockApi.listPlaylists).not.toHaveBeenCalled()
  })
})
