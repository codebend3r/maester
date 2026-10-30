import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'
import { APP_CALL_METHODS, APP_CLIENT_CALLS } from '@raven/core'
import { playingTrackOf, useAudioQueue } from '@raven/ui/headless'
import { fireEvent, screen, waitFor } from '@testing-library/react-native'
import { Alert } from 'react-native'

import { APP_ROUTE_PARAMS } from '@/routes'
import { Playlist } from '@/screens/Playlist'
import { useActiveServer } from '@/stores/activeServer'
import { type HeardRequest, pathFor } from '@/test/fixtureFetch'
import { NAS } from '@/test/homeServer'
import { AIRBAG, LUCKY, MIXTAPE, PARANOID, musicApi } from '@/test/musicServer'
import { createScreenClient, renderScreen, untilIdle } from '@/test/renderScreen'

const mockBack = jest.fn()
const mockParams = jest.fn((): Record<string, string> => ({
  [APP_ROUTE_PARAMS.id]: String(MIXTAPE.id),
}))
const mockHeard: HeardRequest[] = []
const mockApi = jest.fn(() => musicApi({ hear: (request) => mockHeard.push(request) }))

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: mockBack }),
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

const MIXTAPE_TRACKS = pathFor({
  path: APP_CLIENT_CALLS.replacePlaylistTracks.path,
  id: MIXTAPE.id,
})

/** The writes the screen sent, as method, path and body. */
const writes = (): HeardRequest[] =>
  mockHeard.filter((request) => request.method !== APP_CALL_METHODS.get)

/** The client this test's screen reads through. */
const shown = { client: createScreenClient() }

const renderPlaylist = async () => {
  shown.client = createScreenClient()
  await renderScreen({ ui: <Playlist />, client: shown.client })
  await screen.findByText(MIXTAPE.name)
}

describe('Playlist', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.restoreAllMocks()
    mockHeard.splice(0)
    useAudioQueue.getState().clear()
    useActiveServer.setState({ servers: [NAS], activeId: NAS.id })
  })

  afterEach(async () => {
    await untilIdle(shown.client)
  })

  it('shows the playlist with its tracks, and plays from the start or from a track', async () => {
    await renderPlaylist()
    expect(screen.getByText('3 tracks · 15 min')).toBeTruthy()

    await fireEvent.press(screen.getByRole('button', { name: 'Play' }))
    expect(playingTrackOf(useAudioQueue.getState())?.id ?? null).toBe(AIRBAG.id)

    await fireEvent.press(screen.getByRole('button', { name: `3. ${LUCKY.title}` }))
    expect(playingTrackOf(useAudioQueue.getState())?.id ?? null).toBe(LUCKY.id)
  })

  it('moves a track up and takes one out, sending the whole new order each time', async () => {
    // The test server keeps no edit, so each order is worked out from the one it answers.
    await renderPlaylist()
    expect(screen.queryByRole('button', { name: `Move ${AIRBAG.title} up` })).toBeNull()

    await fireEvent.press(screen.getByRole('button', { name: `Move ${LUCKY.title} up` }))
    await waitFor(() =>
      expect(writes()).toEqual([
        {
          method: APP_CALL_METHODS.put,
          path: MIXTAPE_TRACKS,
          body: { mediaIds: [AIRBAG.id, LUCKY.id, PARANOID.id] },
        },
      ]),
    )

    await fireEvent.press(
      screen.getByRole('button', { name: `Remove ${AIRBAG.title} from the playlist` }),
    )
    await waitFor(() =>
      expect(writes()[1]).toEqual({
        method: APP_CALL_METHODS.put,
        path: MIXTAPE_TRACKS,
        body: { mediaIds: [PARANOID.id, LUCKY.id] },
      }),
    )
  })

  it('renames the playlist from the system prompt', async () => {
    jest.spyOn(Alert, 'prompt').mockImplementation((_title, _message, buttons) => {
      if (Array.isArray(buttons)) buttons[1]?.onPress?.('  Road trip ')
    })
    await renderPlaylist()
    await fireEvent.press(screen.getByRole('button', { name: 'Rename playlist' }))
    await waitFor(() =>
      expect(writes()).toEqual([
        {
          method: APP_CALL_METHODS.put,
          path: pathFor({ path: APP_CLIENT_CALLS.renamePlaylist.path, id: MIXTAPE.id }),
          body: { name: 'Road trip' },
        },
      ]),
    )
  })

  it('deletes the playlist only once the alert is answered Delete, and goes back', async () => {
    const answers = { delete: false }
    jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
      const chosen = buttons?.find(
        (button) => button.text === (answers.delete ? 'Delete' : 'Cancel'),
      )
      chosen?.onPress?.()
    })
    await renderPlaylist()
    await fireEvent.press(screen.getByRole('button', { name: 'Delete' }))
    expect(writes()).toEqual([])

    answers.delete = true
    await fireEvent.press(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(mockBack).toHaveBeenCalled())
    expect(writes()).toEqual([
      {
        method: APP_CALL_METHODS.delete,
        path: pathFor({ path: APP_CLIENT_CALLS.deletePlaylist.path, id: MIXTAPE.id }),
        body: null,
      },
    ])
  })
})
