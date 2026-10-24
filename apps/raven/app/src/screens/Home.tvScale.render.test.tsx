import { describe, expect, it, jest } from '@jest/globals'
import { isRecord } from '@raven/core'
import { screen } from '@testing-library/react-native'

import { FOCUS_CARD_WIDTHS } from '@/layouts/FocusCard'
import { Home } from '@/screens/Home'
import type { AppServer } from '@/servers/serverList'
import { useActiveServer } from '@/stores/activeServer'
import { FILMS, NAS, homeApi } from '@/test/homeServer'
import type * as NavigationFocus from '@/test/navigationFocus'
import { createScreenClient, renderScreen } from '@/test/renderScreen'

// The TV and its window are read once, as the layouts load, so both are set before they do.
jest.mock('react-native/Libraries/Utilities/Platform', () => {
  const platform = jest.requireActual<{ default: object }>(
    'react-native/Libraries/Utilities/Platform',
  )
  Object.defineProperty(platform.default, 'isTV', { get: () => true })
  return platform
})
jest.mock('react-native/Libraries/Utilities/Dimensions', () => {
  const dimensions = jest.requireActual<{
    default: { get: (dimension: string) => Record<string, number> }
  }>('react-native/Libraries/Utilities/Dimensions')
  const measured = dimensions.default.get
  return {
    ...dimensions,
    default: {
      ...dimensions.default,
      // A 1080p Android TV's window, in dp: half the width the TV layouts are drawn for.
      get: (dimension: string) => ({ ...measured(dimension), width: 960, height: 540 }),
    },
  }
})
const mockApi = jest.fn((server: AppServer) => homeApi(server))

jest.mock('expo-router', () => ({
  ...jest.requireActual<typeof NavigationFocus>('@/test/navigationFocus').navigationFocusMocks,
  useRouter: () => ({ push: jest.fn() }),
}))
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

/** The widths a style sets, through the arrays React Native styles nest in. */
const widthsOf = (style: unknown): unknown[] => {
  if (Array.isArray(style)) return style.flatMap((part) => widthsOf(part))
  return isRecord(style) && typeof style.width === 'number' ? [style.width] : []
}

/** The widths a view and every view inside it are drawn at, where one sets a number. */
const drawnWidths = (node: unknown): unknown[] => {
  if (!isRecord(node) || !isRecord(node.props)) return []
  const children = Array.isArray(node.children) ? node.children : []
  return [...widthsOf(node.props.style), ...children.flatMap((child) => drawnWidths(child))]
}

describe('Home on a 960 dp Android TV', () => {
  it('draws its cards at half the width they have on a 1920 point Apple TV', async () => {
    useActiveServer.setState({ servers: [NAS], activeId: NAS.id })
    await renderScreen({ ui: <Home />, client: createScreenClient() })
    expect(await screen.findByRole('header', { name: FILMS.name })).toBeTruthy()
    const widths = screen.getAllByRole('button').flatMap((card) => drawnWidths(card))
    expect(widths).toContain(FOCUS_CARD_WIDTHS.poster / 2)
    expect(widths).not.toContain(FOCUS_CARD_WIDTHS.poster)
  })
})
