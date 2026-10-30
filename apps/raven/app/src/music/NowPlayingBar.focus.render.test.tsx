import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import { useAudioQueue } from '@raven/ui/headless'
import { act, fireEvent, screen } from '@testing-library/react-native'

import { NowPlayingBar } from '@/music/NowPlayingBar'
import { APP_ROUTES, APP_SCREENS } from '@/routes'
import { settleScreen } from '@/stores/screenFocus'
import { NAS, homeApi } from '@/test/homeServer'
import { AIRBAG } from '@/test/musicServer'
import type * as NavigationFocus from '@/test/navigationFocus'
import { askedFor, resetTestScreen } from '@/test/navigationFocus'
import { renderScreen } from '@/test/renderScreen'

const mockPush = jest.fn()
const mockSegments = jest.fn<() => string[]>(() => [])

/** The screen in front, as the root navigator's state names it. */
const mockFront = 'album-route-key'

// The layouts pick their variant once, as they load, so the TV is set before anything does.
jest.mock('react-native/Libraries/Utilities/Platform', () => {
  const platform = jest.requireActual<{ default: object }>(
    'react-native/Libraries/Utilities/Platform',
  )
  Object.defineProperty(platform.default, 'isTV', { get: () => true })
  return platform
})
jest.mock('expo-router', () => ({
  useRouter: () => ({ back: jest.fn(), push: mockPush }),
  useSegments: () => mockSegments(),
  useRootNavigationState: () => ({ index: 0, routes: [{ key: mockFront }] }),
}))
jest.mock(
  '@/layouts/tvFocus',
  () => jest.requireActual<typeof NavigationFocus>('@/test/navigationFocus').tvFocusMocks,
)

const renderBar = () =>
  renderScreen({ ui: <NowPlayingBar session={{ server: NAS, api: homeApi() }} /> })

/** Whether each of the strip's controls is in the remote's reach. */
const reach = (): unknown[] => screen.getAllByRole('button').map((node) => node.props.focusable)

describe('NowPlayingBar on a TV', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    resetTestScreen()
    mockSegments.mockReturnValue([])
    useAudioQueue.getState().clear()
  })

  it('shows the playing track under the screens, with Play or Pause and Next', async () => {
    useAudioQueue.getState().playTracks({ tracks: [AIRBAG] })
    await renderBar()
    expect(screen.getByText('Airbag')).toBeTruthy()
    expect(screen.getByText('Radiohead')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Next' })).toBeTruthy()
  })

  it('stays out of reach until the screen in front has had its opening focus', async () => {
    useAudioQueue.getState().playTracks({ tracks: [AIRBAG] })
    await renderBar()
    expect(reach()).toEqual([false, false, false])

    await act(() => settleScreen({ screen: mockFront }))
    expect(reach()).toEqual([true, true, true])
  })

  it('opens Now Playing, and takes the focus back when it is drawn again', async () => {
    useAudioQueue.getState().playTracks({ tracks: [AIRBAG] })
    const { unmount } = await renderBar()
    await act(() => settleScreen({ screen: mockFront }))
    await fireEvent.press(screen.getByRole('button', { name: 'Open Now Playing' }))
    expect(mockPush).toHaveBeenCalledWith(APP_ROUTES.nowPlaying)
    expect(askedFor()).toEqual([])

    await unmount()
    await renderBar()
    expect(askedFor()).toEqual(['Open Now Playing'])
  })

  it.each([APP_SCREENS.nowPlaying, APP_SCREENS.play])('stays off %s', async (screenName) => {
    useAudioQueue.getState().playTracks({ tracks: [AIRBAG] })
    mockSegments.mockReturnValue(screenName.split('/'))
    await renderBar()
    expect(screen.queryByText('Airbag')).toBeNull()
  })
})
