import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'
import { APP_CALL_METHODS, APP_CLIENT_CALLS } from '@raven/core'
import { useAudioQueue, usePlayerPrefs } from '@raven/ui/headless'
import { fireEvent, screen, waitFor } from '@testing-library/react-native'

import { NowPlaying } from '@/screens/NowPlaying'
import { useActiveServer } from '@/stores/activeServer'
import { type HeardRequest, pathFor } from '@/test/fixtureFetch'
import { NAS } from '@/test/homeServer'
import {
  AIRBAG,
  DUNE_BOOK,
  LUCKY,
  MIXTAPE,
  PARANOID,
  PARANOID_LYRICS,
  musicApi,
} from '@/test/musicServer'
import { answerSheet } from '@/test/actionSheet'
import { createScreenClient, renderScreen, untilIdle } from '@/test/renderScreen'

const mockHeard: HeardRequest[] = []
const mockApi = jest.fn(() => musicApi({ hear: (request) => mockHeard.push(request) }))

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
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

/** The client this test's screen reads through. */
const shown = { client: createScreenClient() }

type RenderPlayingAtProps = { at: number }

/** Puts the clock `at` seconds into the playing track, and opens Now Playing on it. */
const renderPlayingAt = async ({ at }: RenderPlayingAtProps) => {
  useAudioQueue.getState().engine.time({ position: at, duration: 300 })
  shown.client = createScreenClient()
  await renderScreen({ ui: <NowPlaying />, client: shown.client })
}

describe('Now Playing under the thumb', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.restoreAllMocks()
    mockHeard.splice(0)
    useAudioQueue.getState().clear()
    usePlayerPrefs.getState().setAudiobookSpeed(1)
    useActiveServer.setState({ servers: [NAS], activeId: NAS.id })
  })

  afterEach(async () => {
    await untilIdle(shown.client)
  })

  it('marks the synced line being sung', async () => {
    useAudioQueue.getState().playTracks({ tracks: [AIRBAG, PARANOID, LUCKY] })
    await renderPlayingAt({ at: 13 })
    const sung = await screen.findByText('In a jackknifed juggernaut')
    expect(sung.props.accessibilityState).toEqual({ selected: true })
    expect(screen.getByText('In the next world war').props.accessibilityState).toEqual({
      selected: false,
    })
    expect(screen.queryByText('Chapters')).toBeNull()
  })

  it('shows plain lyrics as they are, and says quietly when a track has none', async () => {
    useAudioQueue.getState().playTracks({ tracks: [PARANOID, LUCKY] })
    await renderPlayingAt({ at: 0 })
    expect(await screen.findByText(PARANOID_LYRICS.text)).toBeTruthy()

    await fireEvent.press(screen.getByRole('button', { name: 'Next' }))
    expect(await screen.findByText('No lyrics for this track.')).toBeTruthy()
  })

  it("lists an audiobook's chapters, the one playing marked, and jumps between them", async () => {
    useAudioQueue.getState().playTracks({ tracks: [DUNE_BOOK] })
    await renderPlayingAt({ at: 700 })
    const playing = await screen.findByRole('button', { name: 'Arrakis, 10:00' })
    expect(playing.props.accessibilityState).toMatchObject({ selected: true })
    expect(screen.getByRole('button', { name: 'Chapter 3, 20:00' })).toBeTruthy()
    expect(screen.queryByText('Lyrics')).toBeNull()

    await fireEvent.press(screen.getByRole('button', { name: 'Next chapter' }))
    expect(useAudioQueue.getState().position).toBe(1200)
    await fireEvent.press(screen.getByRole('button', { name: 'Previous chapter' }))
    expect(useAudioQueue.getState().position).toBe(600)
    await fireEvent.press(screen.getByRole('button', { name: 'Opening, 0:00' }))
    expect(useAudioQueue.getState().position).toBe(0)
  })

  it("sets an audiobook's speed from the picker", async () => {
    answerSheet({ answer: '1.5×' })
    useAudioQueue.getState().playTracks({ tracks: [DUNE_BOOK] })
    await renderPlayingAt({ at: 0 })
    await fireEvent.press(await screen.findByRole('button', { name: 'Speed: 1×' }))
    expect(usePlayerPrefs.getState().audiobookSpeed).toBe(1.5)
    expect(screen.getByRole('button', { name: 'Speed: 1.5×' })).toBeTruthy()
  })

  it('adds the playing track to a playlist picked from the sheet', async () => {
    answerSheet({ answer: MIXTAPE.name })
    useAudioQueue.getState().playTracks({ tracks: [AIRBAG] })
    await renderPlayingAt({ at: 0 })
    await waitFor(() => expect(shown.client.isFetching()).toBe(0))
    await fireEvent.press(screen.getByRole('button', { name: 'Add to playlist' }))
    expect(await screen.findByText(`Added to ${MIXTAPE.name}.`)).toBeTruthy()
    expect(mockHeard.filter(({ method }) => method !== APP_CALL_METHODS.get)).toEqual([
      {
        method: APP_CALL_METHODS.post,
        path: pathFor({ path: APP_CLIENT_CALLS.appendPlaylistTracks.path, id: MIXTAPE.id }),
        body: { mediaIds: [AIRBAG.id] },
      },
    ])
  })
})
