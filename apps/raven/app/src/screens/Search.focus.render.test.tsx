import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'
import { SEARCH_DELAY_MS } from '@raven/core'
import { act, fireEvent, screen } from '@testing-library/react-native'

import { Search } from '@/screens/Search'
import type { AppServer } from '@/servers/serverList'
import { useActiveServer } from '@/stores/activeServer'
import type { HeardRequest } from '@/test/fixtureFetch'
import { NAS } from '@/test/homeServer'
import { DUNE_QUERY, isSearch, searchApi, searchPathFor } from '@/test/searchServer'
import { renderScreen } from '@/test/renderScreen'

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
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn(), back: jest.fn() }) }))
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
    mockServer.heard = []
    useActiveServer.setState({ servers: [NAS], activeId: NAS.id })
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('opens with the remote on the field, and only the field', async () => {
    await renderScreen({ ui: <Search /> })
    expect(preferred()).toEqual([FIELD])
  })

  it('lets go of the opening focus once the field has had it, and gives the results none', async () => {
    await renderScreen({ ui: <Search /> })
    const field = screen.getByLabelText(FIELD)
    await fireEvent(field, 'focus')
    expect(preferred()).toEqual([])

    await fireEvent.changeText(field, DUNE_QUERY)
    await fireEvent(field, 'submitEditing')
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
    await fireEvent(field, 'endEditing', { nativeEvent: { text: '' } })
    expect(screen.getByLabelText(FIELD).props.value).toBe('')
    await pause(SEARCH_DELAY_MS * 5)
    expect(searches()).toEqual([])
  })
})
