import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import { AUTH_HEADERS, isRecord, isString } from '@raven/core'
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native'
import { StyleSheet } from 'react-native'

import { clearOnServerSwitch } from '@/queries/serverCache'
import { APP_ROUTES } from '@/routes'
import { Home } from '@/screens/Home'
import type { AppServer } from '@/servers/serverList'
import { useActiveServer } from '@/stores/activeServer'
import { bumpCookieVersion } from '@/stores/cookieVersion'
import { NAS, OTHER, homeApi } from '@/test/homeServer'
import { NATIVE_EVENTS } from '@/test/nativeEvents'
import { createScreenClient, renderScreen } from '@/test/renderScreen'

const mockPush = jest.fn()
const mockApi = jest.fn(homeApi)
const mockCookies = jest.fn<() => Record<string, string>>(() => ({}))
const PHONE_WIDTH = 390
const mockWindowWidth = jest.fn(() => PHONE_WIDTH)

jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }))
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: mockWindowWidth(), height: 844, scale: 3, fontScale: 1 }),
}))
jest.mock('@/servers/serverClient', () => ({
  apiFor: (server: AppServer) => mockApi(server),
  openEventsFor: () => () => ({ addEventListener: () => {}, close: () => {} }),
  cookieJar: { read: async () => mockCookies(), forget: async () => {} },
  secretStore: {
    getItemAsync: async () => null,
    setItemAsync: async () => {},
    deleteItemAsync: async () => {},
  },
}))

const renderHome = async () => renderScreen({ ui: <Home /> })

describe('Home on a phone or tablet', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockCookies.mockReturnValue({})
    mockWindowWidth.mockReturnValue(PHONE_WIDTH)
    useActiveServer.setState({ servers: [NAS], activeId: NAS.id })
  })

  it('shows Continue watching, then a shelf for each pinned library, under its name', async () => {
    await renderHome()
    expect(await screen.findByRole('header', { name: 'Continue watching' })).toBeTruthy()
    expect(screen.getByRole('header', { name: 'Films' })).toBeTruthy()
    expect(screen.getByRole('header', { name: 'Series' })).toBeTruthy()
  })

  it('names every card by its title', async () => {
    await renderHome()
    await screen.findByRole('header', { name: 'Films' })
    const cards = screen.getAllByRole('button').map((card) => card.props.accessibilityLabel)
    expect(cards).toEqual(['Busboys', 'Busboys', 'Night Train', 'Severance'])
  })

  it('opens the item a card is for', async () => {
    await renderHome()
    await fireEvent.press(await screen.findByRole('button', { name: 'Severance' }))
    expect(mockPush).toHaveBeenCalledWith({ pathname: APP_ROUTES.item, params: { id: '4' } })
  })

  it("opens a library from its shelf's title, as the web's shelf heading links to it", async () => {
    await renderHome()
    await fireEvent.press(await screen.findByRole('link', { name: 'See all in Films' }))
    expect(mockPush).toHaveBeenCalledWith({ pathname: APP_ROUTES.library, params: { id: '1' } })
    expect(screen.queryByRole('link', { name: 'See all in Continue watching' })).toBeNull()
  })

  it('opens the search through every library from its header', async () => {
    await renderHome()
    await fireEvent.press(await screen.findByRole('link', { name: 'Search every library' }))
    expect(mockPush).toHaveBeenCalledWith(APP_ROUTES.search)
  })

  it('draws each card as wide as its shape asks: a wide frame, then posters', async () => {
    await renderHome()
    await screen.findByRole('header', { name: 'Films' })
    const widths = screen
      .getAllByRole('button')
      .map((card) => StyleSheet.flatten(card.props.style)?.width ?? null)
    expect(widths).toEqual([248, 128, 128, 128])
  })

  it('draws the cards larger on a tablet', async () => {
    mockWindowWidth.mockReturnValue(1024)
    await renderHome()
    await screen.findByRole('header', { name: 'Films' })
    const widths = screen
      .getAllByRole('button')
      .map((card) => StyleSheet.flatten(card.props.style)?.width ?? null)
    expect(widths).toEqual([320, 168, 168, 168])
  })

  it('asks for no focus on a touch screen', async () => {
    await renderHome()
    await screen.findByRole('header', { name: 'Films' })
    const cards = screen.getAllByRole('button')
    expect(cards.some((card) => card.props.hasTVPreferredFocus === true)).toBe(false)
  })

  it("shows the new server's shelves on a switch, never the old one's", async () => {
    const client = createScreenClient()
    const stop = clearOnServerSwitch({ client, store: useActiveServer })
    useActiveServer.setState({ servers: [NAS, OTHER] })
    await renderScreen({ ui: <Home />, client })
    await screen.findByRole('header', { name: 'Films' })

    await act(async () => useActiveServer.setState({ activeId: OTHER.id }))
    expect(screen.queryByRole('header', { name: 'Films' })).toBeNull()
    expect(await screen.findByRole('header', { name: 'Cartoons' })).toBeTruthy()
    expect(screen.queryByRole('header', { name: 'Continue watching' })).toBeNull()
    expect(screen.getByText('Nothing here yet.')).toBeTruthy()
    stop()
  })

  it('sends the new cookie with every picture after an unlock, and retries one that failed', async () => {
    await renderHome()
    await screen.findByRole('header', { name: 'Films' })
    expect(pictures()).toHaveLength(4)
    expect(pictures().map(({ headers }) => headers)).toEqual([{}, {}, {}, {}])

    const [refused] = screen.container.queryAll((node) => isPicture(node.props.source))
    if (refused === undefined) throw new Error('No picture')
    await fireEvent(refused, NATIVE_EVENTS.error)
    expect(pictures()).toHaveLength(3)

    mockCookies.mockReturnValue({ raven_unlock: 'u.2' })
    await act(async () => bumpCookieVersion())
    await waitFor(() => expect(pictures()).toHaveLength(4))
    expect(pictures().map(({ headers }) => headers)).toEqual(
      Array.from({ length: 4 }, () => ({ [AUTH_HEADERS.cookie]: 'raven_unlock=u.2' })),
    )
  })
})

type Picture = { uri: string; headers: Record<string, string> }

const isPicture = (value: unknown): value is Picture =>
  isRecord(value) && isString(value.uri) && isRecord(value.headers)

/** The sources of the pictures on screen, as `Image` was handed them. */
const pictures = (): Picture[] =>
  screen.container
    .queryAll((node) => isPicture(node.props.source))
    .flatMap((node) => {
      const source: unknown = node.props.source
      return isPicture(source) ? [source] : []
    })
