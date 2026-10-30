import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'
import type * as Native from '@raven/native'
import { playingTrackOf, useAudioQueue } from '@raven/ui/headless'
import { fireEvent, screen } from '@testing-library/react-native'

import { APP_ROUTE_PARAMS } from '@/routes'
import { Playlist } from '@/screens/Playlist'
import { useActiveServer } from '@/stores/activeServer'
import { NAS } from '@/test/homeServer'
import { MIXTAPE, PARANOID, musicApi } from '@/test/musicServer'
import type * as NavigationFocus from '@/test/navigationFocus'
import { askedFor, resetTestScreen } from '@/test/navigationFocus'
import { createScreenClient, renderScreen, untilIdle } from '@/test/renderScreen'

const mockParams = jest.fn((): Record<string, string> => ({
  [APP_ROUTE_PARAMS.id]: String(MIXTAPE.id),
}))
const mockApi = jest.fn(musicApi)

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
  useLocalSearchParams: () => mockParams(),
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

/** The client this test's screen reads through. */
const shown = { client: createScreenClient() }

describe('Playlist on a TV', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    resetTestScreen()
    useAudioQueue.getState().clear()
    useActiveServer.setState({ servers: [NAS], activeId: NAS.id })
  })

  afterEach(async () => {
    await untilIdle(shown.client)
  })

  it('opens with the remote on Play, plays from a track, and leaves the edits to the thumb', async () => {
    shown.client = createScreenClient()
    await renderScreen({ ui: <Playlist />, client: shown.client })
    await screen.findByText(MIXTAPE.name)
    expect(askedFor()).toEqual(['Play'])
    expect(screen.getByRole('button', { name: 'Shuffle' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Rename playlist' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull()

    await fireEvent.press(screen.getByRole('button', { name: `2. ${PARANOID.title}` }))
    expect(playingTrackOf(useAudioQueue.getState())?.id ?? null).toBe(PARANOID.id)
  })
})
