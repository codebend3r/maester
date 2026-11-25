import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import { APP_CLIENT_CALLS, HTTP_METHODS, TRACK_STREAM_KINDS } from '@raven/core'
import type * as Native from '@raven/native'
import { type HeardRequest, pathWithId } from '@raven/native/testing'
import { playingTrackOf, useAudioQueue } from '@raven/ui/headless'
import { act, fireEvent, screen } from '@testing-library/react-native'

import { NowPlaying } from '@/screens/NowPlaying'
import { useActiveServer } from '@/stores/activeServer'
import { usePlayedStreams } from '@raven/native/headless'
import { heldAnswer } from '@/test/heldAnswer'
import { NAS } from '@/test/homeServer'
import { AIRBAG, DUNE_BOOK, LUCKY, MIXTAPE, PARANOID, musicApi } from '@/test/musicServer'
import type * as NavigationFocus from '@/test/navigationFocus'
import { askedFor, resetTestScreen } from '@/test/navigationFocus'
import { NATIVE_EVENTS } from '@/test/nativeEvents'
import { createScreenClient, renderScreen, untilIdle, untilSettled } from '@/test/renderScreen'

const mockHeard: HeardRequest[] = []
const mockServer = { writes: async (): Promise<void> => undefined }
const mockApi = jest.fn(() =>
  musicApi({ hear: (request) => mockHeard.push(request), writes: () => mockServer.writes() }),
)

// The layouts pick their variant once, as they load, so the TV is set before anything does.
jest.mock('react-native/Libraries/Utilities/Platform', () => {
  const platform = jest.requireActual<{ default: object }>(
    'react-native/Libraries/Utilities/Platform',
  )
  Object.defineProperty(platform.default, 'isTV', { get: () => true })
  return platform
})
jest.mock('expo-router', () => ({
  ...jest.requireActual<typeof NavigationFocus>('@/test/navigationFocus').navigationFocusMocks,
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
}))
jest.mock(
  '@/layouts/tvFocus',
  () => jest.requireActual<typeof NavigationFocus>('@/test/navigationFocus').tvFocusMocks,
)
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

/** The labels of whatever on screen asks for the remote's focus. */
const preferred = (): string[] =>
  screen
    .queryAllByRole('button')
    .filter((node) => node.props.hasTVPreferredFocus === true)
    .map((node) => node.props.accessibilityLabel)

describe('Now Playing on a TV', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    resetTestScreen()
    mockHeard.splice(0)
    mockServer.writes = async () => undefined
    useAudioQueue.getState().clear()
    usePlayedStreams.setState({ streams: {} })
    useActiveServer.setState({ servers: [NAS], activeId: NAS.id })
  })

  it('says so when nothing plays', async () => {
    await renderScreen({ ui: <NowPlaying /> })
    expect(screen.getByText('Nothing is playing.')).toBeTruthy()
    expect(preferred()).toEqual([])
  })

  it('opens with the remote on Play or Pause, and only as it opens', async () => {
    useAudioQueue.getState().playTracks({ tracks: [AIRBAG, PARANOID, LUCKY] })
    await renderScreen({ ui: <NowPlaying /> })
    expect(screen.getAllByText('Airbag').length).toBeGreaterThan(0)
    const [toggle] = preferred()
    expect(['Play', 'Pause']).toContain(toggle)
    expect(askedFor()).toEqual([toggle])

    await fireEvent(screen.getByRole('button', { name: 'Next' }), NATIVE_EVENTS.focus)
    expect(preferred()).toEqual([])
  })

  it('steps through the queue with Next and Previous, and plays from a queued track', async () => {
    useAudioQueue.getState().playTracks({ tracks: [AIRBAG, PARANOID, LUCKY] })
    await renderScreen({ ui: <NowPlaying /> })

    await fireEvent.press(screen.getByRole('button', { name: 'Next' }))
    expect(playingTrackOf(useAudioQueue.getState())?.id ?? null).toBe(PARANOID.id)
    await fireEvent.press(screen.getByRole('button', { name: 'Previous' }))
    expect(playingTrackOf(useAudioQueue.getState())?.id ?? null).toBe(AIRBAG.id)

    await fireEvent.press(screen.getByRole('button', { name: LUCKY.title }))
    expect(playingTrackOf(useAudioQueue.getState())?.id ?? null).toBe(LUCKY.id)
    expect(screen.getByRole('button', { name: LUCKY.title }).props.accessibilityState).toEqual({
      selected: true,
    })
  })

  it('turns shuffle on and steps the repeat mode from Up next, under how much is queued', async () => {
    useAudioQueue.getState().playTracks({ tracks: [AIRBAG, PARANOID, LUCKY] })
    await renderScreen({ ui: <NowPlaying /> })
    expect(screen.getByText('3 tracks \u00B7 15:00')).toBeTruthy()

    await fireEvent.press(screen.getByRole('button', { name: 'Shuffle off' }))
    expect(screen.getByRole('button', { name: 'Shuffle on' })).toBeTruthy()
    await fireEvent.press(screen.getByRole('button', { name: 'Repeat off' }))
    expect(screen.getByRole('button', { name: 'Repeat all' })).toBeTruthy()
  })

  it('marks the synced line being sung, with nothing in the lyrics for the remote to stop on', async () => {
    useAudioQueue.getState().playTracks({ tracks: [AIRBAG, PARANOID, LUCKY] })
    useAudioQueue.getState().engine.time({ position: 13, duration: 300 })
    const client = createScreenClient()
    await renderScreen({ ui: <NowPlaying />, client })
    await fireEvent.press(screen.getByRole('button', { name: 'Lyrics' }))
    expect(screen.queryByRole('button', { name: 'Shuffle off' })).toBeNull()
    const sung = await screen.findByText('In a jackknifed juggernaut')
    expect(sung.props.accessibilityState).toEqual({ selected: true })
    expect(screen.queryByRole('button', { name: 'In a jackknifed juggernaut' })).toBeNull()
    await untilIdle(client)
  })

  it("gives an audiobook its chapters to play from, the chapter after, and the speed's list", async () => {
    useAudioQueue.getState().playTracks({ tracks: [DUNE_BOOK] })
    useAudioQueue.getState().engine.time({ position: 700, duration: 1800 })
    const client = createScreenClient()
    await renderScreen({ ui: <NowPlaying />, client })
    await fireEvent.press(await screen.findByRole('button', { name: 'Chapters' }))
    const playing = await screen.findByRole('button', { name: 'Arrakis, 10:00' })
    expect(playing.props.accessibilityState).toMatchObject({ selected: true })
    expect(screen.getByRole('button', { name: 'Speed: 1\u00D7' })).toBeTruthy()

    await fireEvent.press(screen.getByRole('button', { name: 'Next chapter' }))
    expect(useAudioQueue.getState().position).toBe(1200)
    expect(screen.queryByRole('button', { name: 'Next chapter' })).toBeNull()
    await fireEvent.press(screen.getByRole('button', { name: 'Opening, 0:00' }))
    expect(useAudioQueue.getState().position).toBe(0)
    await untilIdle(client)
  })

  it("meets the groups in order: the transport, the track's own actions, then the pane's tabs and its queue", async () => {
    useAudioQueue.getState().playTracks({ tracks: [AIRBAG, PARANOID] })
    const client = createScreenClient()
    await renderScreen({ ui: <NowPlaying />, client })
    await untilSettled(client)
    const labels = screen
      .getAllByRole('button')
      .map((node): unknown => node.props.accessibilityLabel)
      .filter((label) => label !== 'Home' && !String(label).includes('equalizer'))
    expect(labels).toEqual([
      'Previous',
      'Pause',
      'Next',
      'Favourite',
      'Add to playlist',
      'Up next',
      'Lyrics',
      'Shuffle off',
      expect.stringMatching(/^Repeat /),
      'Crossfade: Off',
      'Clear',
      AIRBAG.title,
      PARANOID.title,
    ])
  })

  it('shows the time played and the time left, with a minus, either side of the line', async () => {
    useAudioQueue.getState().playTracks({ tracks: [AIRBAG] })
    useAudioQueue.getState().engine.time({ position: 60, duration: 300 })
    await renderScreen({ ui: <NowPlaying /> })
    expect(screen.getByText('1:00')).toBeTruthy()
    expect(screen.getByText('-4:00')).toBeTruthy()
  })

  it('marks the playing track a favourite, and adds it to a playlist picked from the sheet', async () => {
    useAudioQueue.getState().playTracks({ tracks: [AIRBAG] })
    const client = createScreenClient()
    await renderScreen({ ui: <NowPlaying />, client })
    await untilSettled(client)
    // The server keeps no edit, so the mark is looked at while its write is still out.
    const write = heldAnswer()
    mockServer.writes = () => write.answer
    await fireEvent.press(screen.getByRole('button', { name: 'Favourite' }))
    expect(
      screen.getByRole('button', { name: 'Favourite' }).props.accessibilityState,
    ).toMatchObject({ selected: true })
    await act(async () => write.release())
    await untilSettled(client)

    await fireEvent.press(screen.getByRole('button', { name: 'Add to playlist' }))
    const pick = screen.getByRole('button', { name: MIXTAPE.name })
    expect(pick.props.hasTVPreferredFocus).toBe(true)
    await fireEvent.press(pick)
    expect(await screen.findByText(`Added to ${MIXTAPE.name}.`)).toBeTruthy()
    expect(screen.queryByRole('button', { name: MIXTAPE.name })).toBeNull()
    expect(mockHeard.filter(({ method }) => method !== HTTP_METHODS.get)).toEqual([
      {
        method: HTTP_METHODS.put,
        path: pathWithId({ path: APP_CLIENT_CALLS.setFavourite.path, id: AIRBAG.id }),
        body: { favourite: true },
      },
      {
        method: HTTP_METHODS.post,
        path: pathWithId({ path: APP_CLIENT_CALLS.appendPlaylistTracks.path, id: MIXTAPE.id }),
        body: { mediaIds: [AIRBAG.id] },
      },
    ])
    await untilIdle(client)
  })

  it('says the format and quality of what plays under its name, as one sentence', async () => {
    useAudioQueue.getState().playTracks({ tracks: [AIRBAG] })
    await renderScreen({ ui: <NowPlaying /> })
    expect(screen.queryByText('FLAC')).toBeNull()
    await act(() =>
      usePlayedStreams
        .getState()
        .heard({ trackId: AIRBAG.id, stream: { kind: TRACK_STREAM_KINDS.file } }),
    )
    expect(screen.getByLabelText('Playing in FLAC, 16-bit, 44.1 kHz, 900 kbps.')).toBeTruthy()
    expect(screen.getByText('44.1 kHz \u00B7 900 kbps')).toBeTruthy()
  })
})
