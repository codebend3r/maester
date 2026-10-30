import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import type { Track } from '@raven/core'
import { useAudioQueue } from '@raven/ui/headless'
import { fireEvent, screen } from '@testing-library/react-native'

import { NowPlayingBar } from '@/music/NowPlayingBar'
import { APP_ROUTES, APP_SCREENS } from '@/routes'
import { NAS, homeApi } from '@/test/homeServer'
import { renderScreen } from '@/test/renderScreen'

const mockPush = jest.fn()
const mockSegments = jest.fn<() => string[]>(() => [])

jest.mock('expo-router', () => ({
  useRouter: () => ({ back: jest.fn(), push: mockPush, canGoBack: () => true }),
  useSegments: () => mockSegments(),
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
}

const renderBar = () =>
  renderScreen({ ui: <NowPlayingBar session={{ server: NAS, api: homeApi() }} /> })

describe('NowPlayingBar', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockSegments.mockReturnValue([])
    useAudioQueue.getState().clear()
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

  it.each([APP_SCREENS.nowPlaying, APP_SCREENS.play])('stays off %s', async (screenName) => {
    useAudioQueue.getState().playTracks({ tracks: [TRACK] })
    mockSegments.mockReturnValue(screenName.split('/'))
    await renderBar()
    expect(screen.queryByText('Airbag')).toBeNull()
  })
})
