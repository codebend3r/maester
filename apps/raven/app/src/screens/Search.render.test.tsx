import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'
import { SEARCH_DELAY_MS } from '@raven/core'
import { act, fireEvent, screen } from '@testing-library/react-native'

import { APP_ROUTE_PARAMS, APP_ROUTES, ROUTE_TARGETS, hrefOf } from '@/routes'
import { Search } from '@/screens/Search'
import type { AppServer } from '@/servers/serverList'
import { useActiveServer } from '@/stores/activeServer'
import type { HeardRequest } from '@/test/fixtureFetch'
import { FILMS, NAS } from '@/test/homeServer'
import {
  DUNE,
  DUNE_QUERY,
  FAILING_SEARCH,
  isSearch,
  searchApi,
  searchPathFor,
} from '@/test/searchServer'
import { heldAnswer } from '@/test/heldAnswer'
import { keyboardTapsAbove, renderScreen } from '@/test/renderScreen'
import { NATIVE_EVENTS } from '@/test/nativeEvents'

const mockPush = jest.fn()
const mockBack = jest.fn()
/** What the server heard, and what its answers wait on, per test. */
const mockServer: { heard: HeardRequest[]; reads: (path: string) => Promise<void> } = {
  heard: [],
  reads: async () => undefined,
}
const mockApi = jest.fn((_server: AppServer) =>
  searchApi({
    hear: (request) => {
      mockServer.heard = [...mockServer.heard, request]
    },
    reads: (path) => mockServer.reads(path),
  }),
)

jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush, back: mockBack }) }))
jest.mock('@/servers/serverClient', () => ({
  apiFor: (server: AppServer) => mockApi(server),
  openEventsFor: () => () => ({ addEventListener: () => {}, close: () => {} }),
  cookieJar: { read: async () => ({}), forget: async () => {} },
  credentialsFor: async () => ({ cookies: {}, token: null }),
  secretStore: {
    getItemAsync: async () => null,
    setItemAsync: async () => {},
    deleteItemAsync: async () => {},
  },
}))

const FIELD = 'Search every library'

/** The searches the server heard, by path. */
const searches = (): string[] => mockServer.heard.map(({ path }) => path).filter(isSearch)

/** Types `text` into the field one key at a time, as a keyboard reports it. */
const type = async (text: string) => {
  const field = screen.getByLabelText(FIELD)
  await [...text].reduce(async (typed, _, index) => {
    await typed
    await fireEvent.changeText(field, text.slice(0, index + 1))
  }, Promise.resolve())
}

/** Lets the clock run on by `ms`, as a pause in typing does. */
const pause = async (ms: number) => {
  await act(async () => {
    jest.advanceTimersByTime(ms)
  })
}

describe('Search on a phone or tablet', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    jest.clearAllMocks()
    mockServer.heard = []
    mockServer.reads = async () => undefined
    useActiveServer.setState({ servers: [NAS], activeId: NAS.id })
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('asks the server once, when typing pauses, never for each key', async () => {
    await renderScreen({ ui: <Search /> })
    await type(DUNE_QUERY)
    await pause(SEARCH_DELAY_MS - 1)
    expect(searches()).toEqual([])

    await pause(1)
    expect(searches()).toEqual([searchPathFor(DUNE_QUERY)])
    expect(await screen.findByRole('header', { name: 'Films' })).toBeTruthy()
    expect(screen.getByRole('header', { name: 'Series' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Dune' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Dune: Prophecy' })).toBeTruthy()
    await pause(SEARCH_DELAY_MS * 5)
    expect(searches()).toEqual([searchPathFor(DUNE_QUERY)])
  })

  it('asks at once when the keyboard sends the search', async () => {
    await renderScreen({ ui: <Search /> })
    await type(DUNE_QUERY)
    await fireEvent(screen.getByLabelText(FIELD), NATIVE_EVENTS.submitEditing, {
      nativeEvent: { text: DUNE_QUERY },
    })
    expect(searches()).toEqual([searchPathFor(DUNE_QUERY)])
    expect(await screen.findByRole('button', { name: 'Dune' })).toBeTruthy()

    await pause(SEARCH_DELAY_MS)
    expect(searches()).toEqual([searchPathFor(DUNE_QUERY)])
  })

  it('shows nothing and asks nothing once the field is cleared', async () => {
    await renderScreen({ ui: <Search /> })
    await type(DUNE_QUERY)
    await pause(SEARCH_DELAY_MS)
    expect(await screen.findByRole('button', { name: 'Dune' })).toBeTruthy()

    await fireEvent.press(screen.getByRole('button', { name: 'Clear search' }))
    expect(screen.getByLabelText(FIELD).props.value).toBe('')
    expect(screen.queryByRole('header', { name: 'Films' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Dune' })).toBeNull()
    await pause(SEARCH_DELAY_MS * 5)
    expect(searches()).toEqual([searchPathFor(DUNE_QUERY)])
    expect(screen.queryByText(/matches/)).toBeNull()
  })

  it('leaves out a match in a library the viewer cannot see', async () => {
    await renderScreen({ ui: <Search /> })
    await type(DUNE_QUERY)
    await pause(SEARCH_DELAY_MS)
    await screen.findByRole('header', { name: 'Series' })
    expect(screen.getAllByRole('button', { name: 'Dune' })).toHaveLength(1)
  })

  it('says when nothing in any library matches', async () => {
    await renderScreen({ ui: <Search /> })
    await type('zzz')
    await pause(SEARCH_DELAY_MS)
    expect(await screen.findByText('Nothing in any library matches "zzz".')).toBeTruthy()
  })

  it('says nothing matches only once the server says so, not while the last search stands in', async () => {
    await renderScreen({ ui: <Search /> })
    await type('zzz')
    await pause(SEARCH_DELAY_MS)
    expect(await screen.findByText('Nothing in any library matches "zzz".')).toBeTruthy()

    const answer = heldAnswer()
    mockServer.reads = (path) =>
      path === searchPathFor(DUNE_QUERY) ? answer.answer : Promise.resolve()
    const field = screen.getByLabelText(FIELD)
    await fireEvent.changeText(field, DUNE_QUERY)
    await fireEvent(field, NATIVE_EVENTS.submitEditing, { nativeEvent: { text: DUNE_QUERY } })
    expect(searches()).toContain(searchPathFor(DUNE_QUERY))
    expect(screen.queryByText(/^Nothing in any library matches/)).toBeNull()
    expect(screen.getByText('Searching every library')).toBeTruthy()

    answer.release()
    expect(await screen.findByRole('header', { name: 'Films' })).toBeTruthy()
  })
  it('says what went wrong when the search fails', async () => {
    await renderScreen({ ui: <Search /> })
    await type(FAILING_SEARCH.query)
    await pause(SEARCH_DELAY_MS)
    // A failure is tried once more, after TanStack's own wait, before it is shown.
    await pause(5_000)
    expect(await screen.findByText(FAILING_SEARCH.message)).toBeTruthy()
  })

  it("opens a card's page, and a library's every match from its shelf", async () => {
    await renderScreen({ ui: <Search /> })
    await type(DUNE_QUERY)
    await pause(SEARCH_DELAY_MS)
    await fireEvent.press(await screen.findByRole('button', { name: 'Dune' }))
    expect(mockPush).toHaveBeenLastCalledWith(
      hrefOf({
        kind: ROUTE_TARGETS.item,
        itemId: DUNE.item?.id ?? -1,
        libraryId: FILMS.id,
        fileId: null,
      }),
    )

    await fireEvent.press(screen.getByRole('link', { name: 'See all in Films' }))
    expect(mockPush).toHaveBeenLastCalledWith({
      pathname: APP_ROUTES.library,
      params: { [APP_ROUTE_PARAMS.id]: String(FILMS.id), [APP_ROUTE_PARAMS.query]: DUNE_QUERY },
    })
  })

  it('lets a card take the first tap while the keyboard is still up', async () => {
    await renderScreen({ ui: <Search /> })
    await type(DUNE_QUERY)
    await pause(SEARCH_DELAY_MS)
    const card = await screen.findByRole('button', { name: 'Dune' })
    // The shelf's row, then the results under the field.
    expect(keyboardTapsAbove(card)).toEqual(['handled', 'handled'])
  })

  it('opens with the keyboard up on its field', async () => {
    await renderScreen({ ui: <Search /> })
    expect(screen.getByLabelText(FIELD).props.autoFocus).toBe(true)
  })

  it('goes back the way it came', async () => {
    await renderScreen({ ui: <Search /> })
    await fireEvent.press(screen.getByRole('button', { name: 'Back' }))
    expect(mockBack).toHaveBeenCalledTimes(1)
  })
})
