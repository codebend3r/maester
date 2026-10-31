import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import type * as Native from '@raven/native'
import { playingTrackOf, useAudioQueue } from '@raven/ui/headless'
import { APP_CALL_METHODS, APP_CLIENT_CALLS } from '@raven/core'
import { fireEvent, screen, waitFor } from '@testing-library/react-native'
import { Alert } from 'react-native'

import { APP_ROUTE_PARAMS, ROUTE_TARGETS, hrefOf } from '@/routes'
import { Album } from '@/screens/Album'
import { useActiveServer } from '@/stores/activeServer'
import { NAS } from '@/test/homeServer'
import { type HeardRequest, pathFor } from '@/test/fixtureFetch'
import { heldAnswer } from '@/test/heldAnswer'
import {
  AIRBAG,
  LUCKY,
  MIXTAPE,
  NEW_PLAYLIST_ID,
  OK_COMPUTER,
  PARANOID,
  RADIOHEAD,
  musicApi,
} from '@/test/musicServer'
import { answerSheet } from '@/test/actionSheet'
import { NATIVE_EVENTS } from '@/test/nativeEvents'
import { createScreenClient, renderScreen, untilIdle } from '@/test/renderScreen'

const mockPush = jest.fn()
const mockParams = jest.fn((): Record<string, string> => ({
  [APP_ROUTE_PARAMS.id]: String(OK_COMPUTER.id),
}))
const mockHeard: HeardRequest[] = []
const mockServer = { writes: async (): Promise<void> => undefined }
const mockApi = jest.fn(() =>
  musicApi({ hear: (request) => mockHeard.push(request), writes: () => mockServer.writes() }),
)

/** The writes the screen sent, as method, path and body. */
const writes = (): HeardRequest[] =>
  mockHeard.filter((request) => request.method !== APP_CALL_METHODS.get)

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn() }),
  useLocalSearchParams: () => mockParams(),
}))
jest.mock('@raven/native', () => ({
  ...jest.requireActual<typeof Native>('@raven/native'),
  apiFor: () => mockApi(),
  openEventsFor: () => () => ({ addEventListener: () => {}, close: () => {} }),
  cookieJar: { read: async () => ({}), forget: async () => {} },
  secretStore: {
    getItemAsync: async () => null,
    setItemAsync: async () => {},
    deleteItemAsync: async () => {},
  },
}))

describe('Album', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.restoreAllMocks()
    mockHeard.splice(0)
    mockServer.writes = async () => undefined
    useAudioQueue.getState().clear()
    useActiveServer.setState({ servers: [NAS], activeId: NAS.id })
  })

  it('shows the album with its tracks by disc, and plays from the track pressed', async () => {
    await renderScreen({ ui: <Album /> })
    expect(await screen.findByText(OK_COMPUTER.title)).toBeTruthy()
    expect(screen.getByText('Disc 2')).toBeTruthy()

    await fireEvent.press(screen.getByRole('button', { name: `3. ${LUCKY.title}` }))
    expect(playingTrackOf(useAudioQueue.getState())?.id ?? null).toBe(LUCKY.id)
  })

  it('plays the album from the start, queues it next, and opens its artist', async () => {
    await renderScreen({ ui: <Album /> })
    await fireEvent.press(await screen.findByRole('button', { name: 'Play' }))
    expect(playingTrackOf(useAudioQueue.getState())?.id ?? null).toBe(AIRBAG.id)

    await fireEvent.press(screen.getByRole('button', { name: 'Add to queue' }))
    expect(useAudioQueue.getState().queue.items).toHaveLength(6)

    await fireEvent.press(screen.getByRole('link', { name: RADIOHEAD.name }))
    expect(mockPush).toHaveBeenCalledWith(
      hrefOf({ kind: ROUTE_TARGETS.artist, artistId: RADIOHEAD.id }),
    )
  })

  it('marks the album a favourite before the server answers', async () => {
    const { answer, release } = heldAnswer()
    mockServer.writes = () => answer
    const client = createScreenClient()
    await renderScreen({ ui: <Album />, client })
    const favourite = await screen.findByRole('button', { name: 'Favourite' })
    expect(favourite.props.accessibilityState).toMatchObject({ selected: false })

    await fireEvent.press(favourite)
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Favourite' }).props.accessibilityState,
      ).toMatchObject({ selected: true }),
    )
    const path = pathFor({ path: APP_CLIENT_CALLS.setAlbumFavourite.path, id: OK_COMPUTER.id })
    expect(writes()).toEqual([{ method: APP_CALL_METHODS.put, path, body: { favourite: true } }])
    release()
    await untilIdle(client)
  })

  it('adds the album to one of its own playlists picked from the sheet, and says where it went', async () => {
    const offered = answerSheet({ answer: MIXTAPE.name })
    const client = createScreenClient()
    await renderScreen({ ui: <Album />, client })
    await screen.findByText(OK_COMPUTER.title)
    await waitFor(() => expect(client.isFetching()).toBe(0))

    await fireEvent.press(screen.getByRole('button', { name: 'Add to playlist' }))
    expect(offered).toEqual([[MIXTAPE.name, 'New playlist', 'Cancel']])
    expect(await screen.findByText(`Added to ${MIXTAPE.name}.`)).toBeTruthy()
    expect(writes()).toEqual([
      {
        method: APP_CALL_METHODS.post,
        path: pathFor({ path: APP_CLIENT_CALLS.appendPlaylistTracks.path, id: MIXTAPE.id }),
        body: { mediaIds: [AIRBAG.id, PARANOID.id, LUCKY.id] },
      },
    ])
    await untilIdle(client)
  })

  it('adds one track, held, to a new playlist named in the prompt', async () => {
    answerSheet({ answer: 'New playlist' })
    jest.spyOn(Alert, 'prompt').mockImplementation((_title, _message, buttons) => {
      if (Array.isArray(buttons)) buttons[1]?.onPress?.('Road trip')
    })
    const client = createScreenClient()
    await renderScreen({ ui: <Album />, client })
    await fireEvent(
      await screen.findByRole('button', { name: `2. ${PARANOID.title}` }),
      NATIVE_EVENTS.longPress,
    )
    expect(await screen.findByText('Added to Road trip.')).toBeTruthy()
    expect(writes()).toEqual([
      {
        method: APP_CALL_METHODS.post,
        path: APP_CLIENT_CALLS.createPlaylist.path,
        body: { name: 'Road trip' },
      },
      {
        method: APP_CALL_METHODS.post,
        path: pathFor({ path: APP_CLIENT_CALLS.appendPlaylistTracks.path, id: NEW_PLAYLIST_ID }),
        body: { mediaIds: [PARANOID.id] },
      },
    ])
    await untilIdle(client)
  })
})
