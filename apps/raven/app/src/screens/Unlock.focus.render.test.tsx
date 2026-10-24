import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import { screen } from '@testing-library/react-native'

import { Unlock } from '@/screens/Unlock'
import type { AppServer } from '@/servers/serverList'
import { useActiveServer } from '@/stores/activeServer'
import { NAS, homeApi } from '@/test/homeServer'
import type * as NavigationFocus from '@/test/navigationFocus'
import { askedFor, resetTestScreen } from '@/test/navigationFocus'
import { renderScreen } from '@/test/renderScreen'

const mockApi = jest.fn(homeApi)

// The layouts pick their variant once, as they load, so the TV is set before anything does.
jest.mock('react-native/Libraries/Utilities/Platform', () => {
  const platform = jest.requireActual<{ default: object }>(
    'react-native/Libraries/Utilities/Platform',
  )
  Object.defineProperty(platform.default, 'isTV', { get: () => true })
  return platform
})
jest.mock('expo-router', () => ({ useRouter: () => ({ back: jest.fn() }) }))
jest.mock(
  '@/layouts/tvFocus',
  () => jest.requireActual<typeof NavigationFocus>('@/test/navigationFocus').tvFocusMocks,
)
jest.mock('@/servers/serverClient', () => ({
  apiFor: (server: AppServer) => mockApi(server),
  openEventsFor: () => () => ({ addEventListener: () => {}, close: () => {} }),
  cookieJar: { read: async () => ({}), forget: async () => {} },
  secretStore: {
    getItemAsync: async () => null,
    setItemAsync: async () => {},
    deleteItemAsync: async () => {},
  },
}))

describe('Unlock on a TV', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    resetTestScreen()
    useActiveServer.setState({ servers: [NAS], activeId: NAS.id })
  })

  // Asked for as it mounts, the preferred focus comes before the field is in the window, which
  // on Android TV left the PIN screen with nothing focused.
  it('asks for the remote on the PIN field once it is drawn, and on nothing else', async () => {
    await renderScreen({ ui: <Unlock /> })
    expect(screen.getByRole('header', { name: NAS.name })).toBeTruthy()
    expect(askedFor()).toEqual(['PIN'])
  })
})
