import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import { TRACK_STREAM_KINDS, type Track } from '@raven/core'
import { AUDIO_STATES, useAudioQueue } from '@raven/ui/headless'
import { fireEvent, screen } from '@testing-library/react-native'

import { NowPlayingBar } from '@/music/NowPlayingBar'
import { APP_ROUTES, APP_SCREENS } from '@/routes'
import { usePlayedStreams } from '@raven/native/headless'
import { NAS, homeApi } from '@/test/homeServer'
import { renderScreen } from '@/test/renderScreen'

const mockPush = jest.fn()
const mockSegments = jest.fn<() => string[]>(() => [])

/** The window the strip is laid out in: a phone's unless a test makes it a tablet's. */
const PHONE = { width: 390, height: 844 }
const TABLET = { width: 1180, height: 820 }
const mockWindow = jest.fn(() => PHONE)

jest.mock('expo-router', () => ({
  useRouter: () => ({ back: jest.fn(), push: mockPush, canGoBack: () => true }),
  useSegments: () => mockSegments(),
}))
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ ...mockWindow(), scale: 2, fontScale: 1 }),
}))

const TRACK: Track = {
  id: 1,
  libraryId: 1,
  albumId: 7,
  title: 'Airbag',
  disc: 1,
  number: 1,
  duration: 284,
  artists: [{ id: 1, name: 'Radiohead' }],
  container: 'flac',
  codec: 'flac',
  bitrate: 900000,
  sampleRate: 44100,
  bitDepth: 16,
  isLossless: true,
  mbid: null,
  addedAt: '2026-01-01T00:00:00Z',
  album: { title: 'OK Computer', coverVersion: null },
  gain: { track: null, album: null, trackPeak: null, albumPeak: null },
}

const renderBar = () =>
  renderScreen({ ui: <NowPlayingBar session={{ server: NAS, api: homeApi() }} /> })

describe('NowPlayingBar', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockSegments.mockReturnValue([])
    mockWindow.mockReturnValue(PHONE)
    useAudioQueue.getState().clear()
    usePlayedStreams.setState({ streams: {} })
  })

  it('draws nothing while nothing is queued', async () => {
    await renderBar()
    expect(screen.queryByText('Airbag')).toBeNull()
  })

  it('shows the playing track, and opens Now Playing when pressed', async () => {
    useAudioQueue.getState().playTracks({ tracks: [TRACK] })
    await renderBar()
    expect(screen.getByText('Airbag')).toBeTruthy()
    expect(screen.getByText('Radiohead')).toBeTruthy()
    await fireEvent.press(screen.getByRole('button', { name: 'Open Now Playing' }))
    expect(mockPush).toHaveBeenCalledWith(APP_ROUTES.nowPlaying)
  })

  it('stops the music and goes when its X is pressed', async () => {
    useAudioQueue.getState().playTracks({ tracks: [TRACK] })
    await renderBar()
    await fireEvent.press(
      screen.getByRole('button', { name: 'Stop the music and close the player' }),
    )
    expect(useAudioQueue.getState().state).toBe(AUDIO_STATES.empty)
    expect(screen.queryByText('Airbag')).toBeNull()
  })

  it.each([APP_SCREENS.nowPlaying, APP_SCREENS.play])('stays off %s', async (screenName) => {
    useAudioQueue.getState().playTracks({ tracks: [TRACK] })
    mockSegments.mockReturnValue(screenName.split('/'))
    await renderBar()
    expect(screen.queryByText('Airbag')).toBeNull()
  })

  it("says the format and quality of what plays on a tablet, where there is room, and not on a phone's small bar", async () => {
    useAudioQueue.getState().playTracks({ tracks: [TRACK] })
    usePlayedStreams
      .getState()
      .heard({ trackId: TRACK.id, stream: { kind: TRACK_STREAM_KINDS.file } })
    const phone = await renderBar()
    expect(screen.queryByText('FLAC')).toBeNull()
    await phone.unmount()

    mockWindow.mockReturnValue(TABLET)
    await renderBar()
    expect(screen.getByText('FLAC')).toBeTruthy()
    expect(screen.getByText('16-bit')).toBeTruthy()
    expect(screen.getByLabelText('Playing in FLAC, 16-bit, 44.1 kHz, 900 kbps.')).toBeTruthy()
  })
})
