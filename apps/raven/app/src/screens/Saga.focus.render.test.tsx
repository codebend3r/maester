import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import type { ApiForProps } from '@raven/native'
import type * as Native from '@raven/native'
import { fireEvent, screen } from '@testing-library/react-native'

import { APP_ROUTE_PARAMS, APP_ROUTES } from '@/routes'
import { SAGA_COPY } from '@/screens/copy'
import { Saga } from '@/screens/Saga'
import { useActiveServer } from '@/stores/activeServer'
import { FILMS, NAS } from '@/test/homeServer'
import { ASHFALL_GATE, NIGHT_SAGA, NIGHT_TRAIN, libraryApi } from '@/test/libraryServer'
import type * as NavigationFocus from '@/test/navigationFocus'
import { resetTestScreen } from '@/test/navigationFocus'
import { NATIVE_EVENTS } from '@/test/nativeEvents'
import { renderScreen } from '@/test/renderScreen'

const mockPush = jest.fn()
const mockApi = jest.fn(() => libraryApi())
const mockParams = jest.fn((): Record<string, string> => ({
  [APP_ROUTE_PARAMS.id]: NIGHT_SAGA.tmdbId,
  [APP_ROUTE_PARAMS.library]: String(FILMS.id),
}))

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
  useRouter: () => ({ push: mockPush, back: jest.fn() }),
  useLocalSearchParams: () => mockParams(),
}))
jest.mock(
  '@/layouts/tvFocus',
  () => jest.requireActual<typeof NavigationFocus>('@/test/navigationFocus').tvFocusMocks,
)
jest.mock('@raven/native', () => ({
  ...jest.requireActual<typeof Native>('@raven/native'),
  apiFor: (_props: ApiForProps) => mockApi(),
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
  await screen.findByRole('header', { name: NIGHT_SAGA.name })
  const layout = { nativeEvent: { layout: { x: 0, y: 0, width: 1920, height: 800 } } }
  // One at a time: each event is an act() of its own, and they may not overlap.
  await screen.container
    .queryAll((node) => typeof node.props.onLayout === 'function')
    .reduce<Promise<void>>(async (before, node) => {
      await before
      await fireEvent(node, NATIVE_EVENTS.layout, layout)
    }, Promise.resolve())
}

describe('Saga on a TV', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    resetTestScreen()
    useActiveServer.setState({ servers: [NAS], activeId: NAS.id })
  })

  it("lists the saga's movies for the remote to open, with Play all", async () => {
    await renderScreen({ ui: <Saga /> })
    await layOut()

    expect(
      await screen.findByRole('button', { name: `${ASHFALL_GATE.item?.title}, Watched` }),
    ).toBeTruthy()
    expect(screen.getByRole('button', { name: NIGHT_TRAIN.item?.title })).toBeTruthy()
    await fireEvent.press(screen.getByRole('button', { name: SAGA_COPY.playAll }))
    expect(mockPush).toHaveBeenCalledWith(
      expect.objectContaining({
        pathname: APP_ROUTES.play,
        params: expect.objectContaining({ [APP_ROUTE_PARAMS.mediaId]: String(NIGHT_TRAIN.id) }),
      }),
    )
  })
})
