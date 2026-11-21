import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import type { ApiForProps } from '@raven/native'
import type * as Native from '@raven/native'
import type { AppServer } from '@raven/native/headless'
import { fireEvent, screen } from '@testing-library/react-native'

import { HOME_NAV_COPY } from '@/layouts/copy'
import { APP_ROUTES } from '@/routes'
import { Binge } from '@/screens/Binge'
import { useActiveServer } from '@/stores/activeServer'
import { NAS, SEVERANCE_PAGE, homeApi } from '@/test/homeServer'
import type * as NavigationFocus from '@/test/navigationFocus'
import { resetTestScreen } from '@/test/navigationFocus'
import { renderScreen } from '@/test/renderScreen'

const mockPush = jest.fn()
const mockApi = jest.fn((server: AppServer) => {
  const api = homeApi(server)
  return { ...api, getBinge: async () => ({ ids: [SEVERANCE_PAGE.id], hasSeenTip: true }) }
})

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
  useRouter: () => ({ push: mockPush, back: jest.fn(), dismissTo: jest.fn() }),
}))
jest.mock(
  '@/layouts/tvFocus',
  () => jest.requireActual<typeof NavigationFocus>('@/test/navigationFocus').tvFocusMocks,
)
jest.mock('@raven/native', () => ({
  ...jest.requireActual<typeof Native>('@raven/native'),
  apiFor: ({ server }: ApiForProps) => mockApi(server),
  openEventsFor: () => () => ({ addEventListener: () => {}, close: () => {} }),
  cookieJar: { read: async () => ({}), forget: async () => {} },
  secretStore: {
    getItemAsync: async () => null,
    setItemAsync: async () => {},
    deleteItemAsync: async () => {},
  },
}))

describe('Binge on a TV', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    resetTestScreen()
    useActiveServer.setState({ servers: [NAS], activeId: NAS.id })
  })

  it('lists each binged show as a row the remote opens on, under a Home plate', async () => {
    await renderScreen({ ui: <Binge /> })
    const row = await screen.findByRole('button', { name: SEVERANCE_PAGE.title })
    expect(screen.getByRole('button', { name: HOME_NAV_COPY.home })).toBeTruthy()
    expect(row.props.hasTVPreferredFocus).toBe(true)
    expect(screen.getByText('0 of 9 episodes · 0%')).toBeTruthy()

    await fireEvent.press(row)
    expect(mockPush).toHaveBeenCalledWith(expect.objectContaining({ pathname: APP_ROUTES.item }))
  })
})
