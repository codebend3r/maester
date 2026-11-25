import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'
import { APP_CLIENT_CALLS, HTTP_METHODS, TRACK_STREAM_KINDS } from '@raven/core'
import type * as Native from '@raven/native'
import { AUDIO_STATES, useAudioQueue, usePlayerPrefs } from '@raven/ui/headless'
import { act, fireEvent, screen } from '@testing-library/react-native'
import { type HeardRequest, pathWithId } from '@raven/native/testing'

import { NowPlaying } from '@/screens/NowPlaying'
import { useActiveServer } from '@/stores/activeServer'
import { usePlayedStreams } from '@raven/native/headless'
import { heldAnswer } from '@/test/heldAnswer'
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
import { createScreenClient, renderScreen, untilIdle, untilSettled } from '@/test/renderScreen'

const mockHeard: HeardRequest[] = []
const mockServer = { writes: async (): Promise<void> => undefined }
const mockApi = jest.fn(() =>
  musicApi({ hear: (request) => mockHeard.push(request), writes: () => mockServer.writes() }),
)

/** The window the screen is laid out in: a phone's unless a test makes it a tablet's. */
const PHONE = { width: 390, height: 844 }
const TABLET = { width: 1180, height: 820 }
const mockWindow = jest.fn(() => PHONE)

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
}))
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ ...mockWindow(), scale: 2, fontScale: 1 }),
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
    mockWindow.mockReturnValue(PHONE)
    mockServer.writes = async () => undefined
    useAudioQueue.getState().clear()
    usePlayedStreams.setState({ streams: {} })
    usePlayerPrefs.getState().setAudiobookSpeed(1)
    useActiveServer.setState({ servers: [NAS], activeId: NAS.id })
  })

  afterEach(async () => {
    await untilIdle(shown.client)
  })

  it('skips on a double tap either side of the cover, climbing 10, 20 and 30, and says how far in its middle', async () => {
    useAudioQueue.getState().playTracks({ tracks: [AIRBAG, PARANOID] })
    await renderPlayingAt({ at: 60 })
    const cover = screen.getByRole('button', { name: /equalizer/ })
    const right = { nativeEvent: { locationX: 10_000 } }
    const left = { nativeEvent: { locationX: 0 } }
    await fireEvent.press(cover, right)
    expect(useAudioQueue.getState().seek).toBeNull()
    await fireEvent.press(cover, right)
    expect(useAudioQueue.getState().seek?.seconds).toBe(70)
    expect(screen.getByText('10s')).toBeTruthy()
    await fireEvent.press(cover, right)
    expect(useAudioQueue.getState().seek?.seconds).toBe(90)
    expect(screen.getByText('20s')).toBeTruthy()
    await fireEvent.press(cover, right)
    expect(useAudioQueue.getState().seek?.seconds).toBe(120)
    expect(screen.getByLabelText('Forward 30 seconds')).toBeTruthy()
    await fireEvent.press(cover, left)
    await fireEvent.press(cover, left)
    expect(useAudioQueue.getState().seek?.seconds).toBe(110)
    expect(screen.getByLabelText('Back 10 seconds')).toBeTruthy()
  })

  it('says how long each track in the queue runs', async () => {
    useAudioQueue.getState().playTracks({ tracks: [AIRBAG, PARANOID] })
    await renderPlayingAt({ at: 0 })
    expect(screen.getAllByText('Radiohead · 5:00').length).toBeGreaterThan(0)
  })

  it('marks the synced line being sung', async () => {
    useAudioQueue.getState().playTracks({ tracks: [AIRBAG, PARANOID, LUCKY] })
    await renderPlayingAt({ at: 13 })
    await fireEvent.press(screen.getByRole('button', { name: 'Lyrics' }))
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
    await fireEvent.press(screen.getByRole('button', { name: 'Lyrics' }))
    expect(await screen.findByText(PARANOID_LYRICS.text)).toBeTruthy()

    await fireEvent.press(screen.getByRole('button', { name: 'Next' }))
    expect(await screen.findByText('No lyrics for this track.')).toBeTruthy()
  })

  it("lists an audiobook's chapters, the one playing marked, and jumps between them", async () => {
    useAudioQueue.getState().playTracks({ tracks: [DUNE_BOOK] })
    await renderPlayingAt({ at: 700 })
    await fireEvent.press(await screen.findByRole('button', { name: 'Chapters' }))
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
    const offered = answerSheet({ answer: MIXTAPE.name })
    useAudioQueue.getState().playTracks({ tracks: [AIRBAG] })
    await renderPlayingAt({ at: 0 })
    await untilSettled(shown.client)
    await fireEvent.press(screen.getByRole('button', { name: 'Add to playlist' }))
    expect(offered).toEqual([[MIXTAPE.name, 'New playlist', 'Cancel']])
    expect(await screen.findByText(`Added to ${MIXTAPE.name}.`)).toBeTruthy()
    expect(mockHeard.filter(({ method }) => method !== HTTP_METHODS.get)).toEqual([
      {
        method: HTTP_METHODS.post,
        path: pathWithId({ path: APP_CLIENT_CALLS.appendPlaylistTracks.path, id: MIXTAPE.id }),
        body: { mediaIds: [AIRBAG.id] },
      },
    ])
  })

  it('shows the time played at the start of the seek bar and the time left, with a minus, at its end', async () => {
    useAudioQueue.getState().playTracks({ tracks: [AIRBAG] })
    await renderPlayingAt({ at: 60 })
    expect(screen.getByText('1:00')).toBeTruthy()
    expect(screen.getByText('-4:00')).toBeTruthy()
  })

  it('keeps Shuffle, Repeat and Clear with the queue, under how much is queued, and off the lyrics tab', async () => {
    useAudioQueue.getState().playTracks({ tracks: [AIRBAG, PARANOID] })
    await renderPlayingAt({ at: 0 })
    expect(screen.getByText('2 tracks \u00B7 10:00')).toBeTruthy()
    await fireEvent.press(screen.getByRole('button', { name: 'Shuffle off' }))
    expect(screen.getByRole('button', { name: 'Shuffle on' })).toBeTruthy()
    await fireEvent.press(screen.getByRole('button', { name: 'Repeat off' }))
    expect(screen.getByRole('button', { name: 'Repeat all' })).toBeTruthy()

    await fireEvent.press(screen.getByRole('button', { name: 'Lyrics' }))
    expect(screen.getByRole('button', { name: 'Lyrics' }).props.accessibilityState).toMatchObject({
      selected: true,
    })
    expect(screen.queryByRole('button', { name: 'Shuffle on' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Clear' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Next' })).toBeTruthy()

    await fireEvent.press(screen.getByRole('button', { name: 'Up next' }))
    await fireEvent.press(screen.getByRole('button', { name: 'Clear' }))
    expect(useAudioQueue.getState().state).toBe(AUDIO_STATES.empty)
  })

  it('marks the playing track a favourite from the heart beside its name', async () => {
    useAudioQueue.getState().playTracks({ tracks: [AIRBAG] })
    await renderPlayingAt({ at: 0 })
    await untilSettled(shown.client)
    // The server keeps no edit, so the mark is looked at while its write is still out.
    const write = heldAnswer()
    mockServer.writes = () => write.answer
    await fireEvent.press(screen.getByRole('button', { name: 'Favourite' }))
    expect(
      screen.getByRole('button', { name: 'Favourite' }).props.accessibilityState,
    ).toMatchObject({ selected: true })
    await act(async () => write.release())
    expect(mockHeard.filter(({ method }) => method !== HTTP_METHODS.get)).toEqual([
      {
        method: HTTP_METHODS.put,
        path: pathWithId({ path: APP_CLIENT_CALLS.setFavourite.path, id: AIRBAG.id }),
        body: { favourite: true },
      },
    ])
  })

  it('says the format and quality of what plays once the host has chosen its stream, as one sentence', async () => {
    useAudioQueue.getState().playTracks({ tracks: [AIRBAG] })
    await renderPlayingAt({ at: 0 })
    expect(screen.queryByText('FLAC')).toBeNull()

    await act(() =>
      usePlayedStreams
        .getState()
        .heard({ trackId: AIRBAG.id, stream: { kind: TRACK_STREAM_KINDS.file } }),
    )
    expect(screen.getByLabelText('Playing in FLAC, 16-bit, 44.1 kHz, 900 kbps.')).toBeTruthy()
    expect(screen.getByText('FLAC')).toBeTruthy()
    expect(screen.getByText('16-bit')).toBeTruthy()
    expect(screen.getByText('44.1 kHz \u00B7 900 kbps')).toBeTruthy()

    await act(() =>
      usePlayedStreams
        .getState()
        .heard({ trackId: AIRBAG.id, stream: { kind: TRACK_STREAM_KINDS.download, kbps: 256 } }),
    )
    expect(screen.getByText('AAC')).toBeTruthy()
    expect(screen.getByText('256 kbps \u00B7 Downloaded')).toBeTruthy()
  })

  it('keeps the same groups on a tablet, the pane beside the player switched by its tabs', async () => {
    mockWindow.mockReturnValue(TABLET)
    useAudioQueue.getState().playTracks({ tracks: [PARANOID, LUCKY] })
    await renderPlayingAt({ at: 60 })
    expect(screen.getByText('-4:00')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Favourite' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Add to playlist' })).toBeTruthy()
    expect(screen.getByText('2 tracks \u00B7 10:00')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Shuffle off' })).toBeTruthy()
    expect(screen.getByRole('button', { name: LUCKY.title })).toBeTruthy()

    await fireEvent.press(screen.getByRole('button', { name: 'Lyrics' }))
    expect(await screen.findByText(PARANOID_LYRICS.text)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Shuffle off' })).toBeNull()
    expect(screen.queryByRole('button', { name: LUCKY.title })).toBeNull()
    expect(screen.getByRole('button', { name: 'Pause' })).toBeTruthy()
  })
})
