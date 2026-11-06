import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import type { ApiForProps } from '@raven/native'
import type * as Native from '@raven/native'
import { fireEvent, screen } from '@testing-library/react-native'

import { HOME_NAV_COPY } from '@/layouts/copy'
import { APP_ROUTES } from '@/routes'
import { ContinueWatching } from '@/screens/ContinueWatching'
import { useActiveServer } from '@/stores/activeServer'
import { NAS, homeApi } from '@/test/homeServer'
import type * as NavigationFocus from '@/test/navigationFocus'
import { resetTestScreen } from '@/test/navigationFocus'
import { NATIVE_EVENTS } from '@/test/nativeEvents'
import { renderScreen } from '@/test/renderScreen'

const mockPush = jest.fn()
const mockApi = jest.fn(homeApi)

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

/** The TV's list waits for the height left under the header, which jest never lays out. */
const layOut = async () => {
  await screen.findByRole('header', { name: 'Continue watching' })
  const layout = { nativeEvent: { layout: { x: 0, y: 0, width: 1920, height: 800 } } }
  // One at a time: each event is an act() of its own, and they may not overlap.
  await screen.container
    .queryAll((node) => typeof node.props.onLayout === 'function')
    .reduce<Promise<void>>(async (before, node) => {
      await before
      await fireEvent(node, NATIVE_EVENTS.layout, layout)
    }, Promise.resolve())
}

describe('Continue watching on a TV', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    resetTestScreen()
    useActiveServer.setState({ servers: [NAS], activeId: NAS.id })
  })

  it('lists every video in progress for the remote to open, under a Home plate', async () => {
    await renderScreen({ ui: <ContinueWatching /> })
    await layOut()
    expect(screen.getByRole('button', { name: HOME_NAV_COPY.home })).toBeTruthy()
    const card = await screen.findByRole('button', { name: 'Busboys' })
    expect(card.props.hasTVPreferredFocus).toBe(true)
    await fireEvent.press(card)
    expect(mockPush).toHaveBeenCalledWith(expect.objectContaining({ pathname: APP_ROUTES.item }))
  })
})
