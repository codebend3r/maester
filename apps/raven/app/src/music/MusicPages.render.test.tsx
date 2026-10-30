import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import { APP_CALL_METHODS, APP_CLIENT_CALLS } from '@raven/core'
import { fireEvent, screen, waitFor } from '@testing-library/react-native'
import { Alert } from 'react-native'

import { APP_ROUTE_PARAMS, ROUTE_TARGETS, hrefOf } from '@/routes'
import { Library } from '@/screens/Library'
import { useActiveServer } from '@/stores/activeServer'
import { NAS } from '@/test/homeServer'
import type { HeardRequest } from '@/test/fixtureFetch'
import {
  MIXTAPE,
  MUSIC,
  NEW_PLAYLIST_ID,
  OK_COMPUTER,
  PORTISHEAD,
  RADIOHEAD,
  musicApi,
} from '@/test/musicServer'
import { createScreenClient, renderScreen, untilIdle } from '@/test/renderScreen'

const mockPush = jest.fn()
const mockParams = jest.fn((): Record<string, string> => ({
  [APP_ROUTE_PARAMS.id]: String(MUSIC.id),
}))
const mockHeard: HeardRequest[] = []
const mockApi = jest.fn(() => musicApi({ hear: (request) => mockHeard.push(request) }))

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn() }),
  useLocalSearchParams: () => mockParams(),
}))
jest.mock('@/servers/serverClient', () => ({
  apiFor: () => mockApi(),
  openEventsFor: () => () => ({ addEventListener: () => {}, close: () => {} }),
  cookieJar: { read: async () => ({}), forget: async () => {} },
  secretStore: {
    getItemAsync: async () => null,
    setItemAsync: async () => {},
    deleteItemAsync: async () => {},
  },
}))

describe('a music library', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.restoreAllMocks()
    mockHeard.splice(0)
    useActiveServer.setState({ servers: [NAS], activeId: NAS.id })
  })

  it('opens on its albums, with the way to its artists', async () => {
    await renderScreen({ ui: <Library /> })
    expect(await screen.findByText(OK_COMPUTER.title)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Show Artists' })).toBeTruthy()
  })

  it('lists its artists by name, each opening their page, and goes back to the albums', async () => {
    await renderScreen({ ui: <Library /> })
    await fireEvent.press(await screen.findByRole('button', { name: 'Show Artists' }))
    expect(await screen.findByText(RADIOHEAD.name)).toBeTruthy()
    expect(screen.getByText(PORTISHEAD.name)).toBeTruthy()
    expect(screen.getByText('2 albums · 1 track')).toBeTruthy()
    expect(screen.getByText('Music, 2 artists')).toBeTruthy()

    await fireEvent.press(screen.getByRole('button', { name: RADIOHEAD.name }))
    expect(mockPush).toHaveBeenCalledWith(
      hrefOf({ kind: ROUTE_TARGETS.artist, artistId: RADIOHEAD.id }),
    )

    await fireEvent.press(screen.getByRole('button', { name: 'Show Albums' }))
    expect(await screen.findByText(OK_COMPUTER.title)).toBeTruthy()
  })

  it("lists the account's playlists, each opening its page", async () => {
    await renderScreen({ ui: <Library /> })
    await fireEvent.press(await screen.findByRole('button', { name: 'Show Playlists' }))
    expect(await screen.findByText(MIXTAPE.name)).toBeTruthy()
    expect(screen.getByText('3 tracks · 15 min')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Show Albums' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Show Artists' })).toBeTruthy()

    await fireEvent.press(screen.getByRole('button', { name: MIXTAPE.name }))
    expect(mockPush).toHaveBeenCalledWith(
      hrefOf({ kind: ROUTE_TARGETS.playlist, playlistId: MIXTAPE.id }),
    )
  })

  it('makes a playlist named in the system prompt, and opens it', async () => {
    jest.spyOn(Alert, 'prompt').mockImplementation((_title, _message, buttons) => {
      if (Array.isArray(buttons)) buttons[1]?.onPress?.('Road trip')
    })
    const client = createScreenClient()
    await renderScreen({ ui: <Library />, client })
    await fireEvent.press(await screen.findByRole('button', { name: 'Show Playlists' }))
    await fireEvent.press(await screen.findByRole('button', { name: 'New playlist' }))
    await waitFor(() =>
      expect(mockPush).toHaveBeenCalledWith(
        hrefOf({ kind: ROUTE_TARGETS.playlist, playlistId: NEW_PLAYLIST_ID }),
      ),
    )
    expect(mockHeard.filter(({ method }) => method !== APP_CALL_METHODS.get)).toEqual([
      {
        method: APP_CALL_METHODS.post,
        path: APP_CLIENT_CALLS.createPlaylist.path,
        body: { name: 'Road trip' },
      },
    ])
    await untilIdle(client)
  })
})
