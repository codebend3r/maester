import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import type { ApiForProps } from '@raven/native'
import type * as Native from '@raven/native'
import type { AppServer } from '@raven/native/headless'
import { fireEvent, screen } from '@testing-library/react-native'

import { HOME_NAV_COPY } from '@/layouts/copy'
import { ROUTE_TARGETS, hrefOf } from '@/routes'
import { LIBRARIES_COPY } from '@/screens/copy'
import { Libraries } from '@/screens/Libraries'
import { useActiveServer } from '@/stores/activeServer'
import { FILMS, NAS, SERIES, homeApi } from '@/test/homeServer'
import type * as NavigationFocus from '@/test/navigationFocus'
import {
  askedFor,
  leaveTestScreen,
  resetTestScreen,
  returnToTestScreen,
} from '@/test/navigationFocus'
import { NATIVE_EVENTS } from '@/test/nativeEvents'
import { renderScreen } from '@/test/renderScreen'

/** A library no one pinned, which the side menu leaves out and this screen lists. */
const ARCHIVE = {
  ...SERIES,
  id: 3,
  name: 'Archive',
  settings: { ...SERIES.settings, pinned: false },
}

const mockPush = jest.fn()
const mockApi = jest.fn((server: AppServer) => ({
  ...homeApi(server),
  listLibraries: async () => [FILMS, ARCHIVE, SERIES],
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
  await screen.findByRole('header', { name: LIBRARIES_COPY.title })
  const layout = { nativeEvent: { layout: { x: 0, y: 0, width: 1920, height: 800 } } }
  // One at a time: each event is an act() of its own, and they may not overlap.
  await screen.container
    .queryAll((node) => typeof node.props.onLayout === 'function')
    .reduce<Promise<void>>(async (before, node) => {
      await before
      await fireEvent(node, NATIVE_EVENTS.layout, layout)
    }, Promise.resolve())
}

describe('Libraries on a TV', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    resetTestScreen()
    useActiveServer.setState({ servers: [NAS], activeId: NAS.id })
  })

  it('lists every library for the remote to open, the first focused, under a Home plate', async () => {
    await renderScreen({ ui: <Libraries /> })
    await layOut()
    expect(screen.getByRole('button', { name: HOME_NAV_COPY.home })).toBeTruthy()
    const first = await screen.findByRole('button', { name: 'Films' })
    expect(first.props.hasTVPreferredFocus).toBe(true)
    const archive = screen.getByRole('button', { name: 'Archive' })
    expect(archive.props.hasTVPreferredFocus).not.toBe(true)
    await fireEvent.press(archive)
    expect(mockPush).toHaveBeenCalledWith(
      hrefOf({ kind: ROUTE_TARGETS.library, libraryId: ARCHIVE.id, query: '' }),
    )
  })

  it('takes the focus back to the library that was opened on return', async () => {
    await renderScreen({ ui: <Libraries /> })
    await layOut()
    const archive = await screen.findByRole('button', { name: 'Archive' })
    await fireEvent(archive, NATIVE_EVENTS.focus)
    await fireEvent.press(archive)
    await leaveTestScreen()
    await returnToTestScreen()
    expect(askedFor()).toContain('Archive')
  })
})
