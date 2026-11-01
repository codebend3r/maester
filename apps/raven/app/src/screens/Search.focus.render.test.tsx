import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'
import { SEARCH_DELAY_MS } from '@raven/core'
import type { ApiForProps } from '@raven/native'
import type * as Native from '@raven/native'
import type { AppServer } from '@raven/native/headless'
import { act, fireEvent, screen } from '@testing-library/react-native'

import { Search } from '@/screens/Search'
import { useActiveServer } from '@/stores/activeServer'
import type { HeardRequest } from '@/test/fixtureFetch'
import { NAS } from '@/test/homeServer'
import type * as NavigationFocus from '@/test/navigationFocus'
import {
  askedFor,
  leaveTestScreen,
  resetTestScreen,
  returnToTestScreen,
} from '@/test/navigationFocus'
import { DUNE_QUERY, isSearch, searchApi, searchPathFor } from '@/test/searchServer'
import { renderScreen } from '@/test/renderScreen'
import { NATIVE_EVENTS } from '@/test/nativeEvents'

/** What the server heard, per test. */
const mockServer: { heard: HeardRequest[] } = { heard: [] }
const mockApi = jest.fn((_server: AppServer) =>
  searchApi({
    hear: (request) => {
      mockServer.heard = [...mockServer.heard, request]
    },
  }),
)

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
  useLocalSearchParams: () => ({}),
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

const FIELD = 'Search every library'

const searches = (): string[] => mockServer.heard.map(({ path }) => path).filter(isSearch)

/** The labels of whatever on screen asks for the remote's focus as it mounts. */
const preferred = (): unknown[] =>
  [
    screen.getByLabelText(FIELD),
    ...screen.queryAllByRole('button'),
    ...screen.queryAllByRole('link'),
  ]
    .filter((node) => node.props.hasTVPreferredFocus === true)
    .map((node) => node.props.accessibilityLabel)

const pause = async (ms: number) => {
  await act(async () => {
    jest.advanceTimersByTime(ms)
  })
}

describe('Search on a TV', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    jest.clearAllMocks()
    resetTestScreen()
    mockServer.heard = []
    useActiveServer.setState({ servers: [NAS], activeId: NAS.id })
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('opens with the remote on the field, and only the field', async () => {
    await renderScreen({ ui: <Search /> })
    expect(preferred()).toEqual([FIELD])
    expect(askedFor()).toEqual([FIELD])
  })

  it('lets go of the opening focus once the field has had it, and gives the results none', async () => {
    await renderScreen({ ui: <Search /> })
    const field = screen.getByLabelText(FIELD)
    await fireEvent(field, NATIVE_EVENTS.focus)
    expect(preferred()).toEqual([])

    await fireEvent.changeText(field, DUNE_QUERY)
    await fireEvent(field, NATIVE_EVENTS.submitEditing, { nativeEvent: { text: DUNE_QUERY } })
    expect(searches()).toEqual([searchPathFor(DUNE_QUERY)])
    expect(await screen.findByRole('button', { name: 'Dune' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Dune: Prophecy' })).toBeTruthy()
    expect(preferred()).toEqual([])
  })

  it('searches once typing pauses on the platform keyboard', async () => {
    await renderScreen({ ui: <Search /> })
    const field = screen.getByLabelText(FIELD)
    await [...DUNE_QUERY].reduce(async (typed, _, index) => {
      await typed
      await fireEvent.changeText(field, DUNE_QUERY.slice(0, index + 1))
    }, Promise.resolve())
    expect(searches()).toEqual([])
    await pause(SEARCH_DELAY_MS)
    expect(searches()).toEqual([searchPathFor(DUNE_QUERY)])
  })

  it('drops what was typed when Menu cancels the keyboard, and asks nothing', async () => {
    await renderScreen({ ui: <Search /> })
    const field = screen.getByLabelText(FIELD)
    await fireEvent.changeText(field, 'du')
    // tvOS reports each key as it is typed, then puts the field back on Menu, saying so only
    // as the edit ends.
    await fireEvent(field, NATIVE_EVENTS.endEditing, { nativeEvent: { text: '' } })
    expect(screen.getByLabelText(FIELD).props.value).toBe('')
    await pause(SEARCH_DELAY_MS * 5)
    expect(searches()).toEqual([])
  })

  it('takes the focus back to the result a page was opened from', async () => {
    await renderScreen({ ui: <Search /> })
    const field = screen.getByLabelText(FIELD)
    await fireEvent(field, NATIVE_EVENTS.focus)
    await fireEvent.changeText(field, DUNE_QUERY)
    await fireEvent(field, NATIVE_EVENTS.submitEditing, { nativeEvent: { text: DUNE_QUERY } })
    const show = await screen.findByRole('button', { name: 'Dune: Prophecy' })
    await fireEvent(show, NATIVE_EVENTS.focus)
    await fireEvent.press(show)
    await leaveTestScreen()
    await returnToTestScreen()
    // The field asked as the screen opened; the return asks only for the result.
    expect(askedFor()).toEqual([FIELD, 'Dune: Prophecy'])
    expect(preferred()).toEqual([])
  })
})
