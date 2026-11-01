import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import { AUTH_HEADERS, SERVER_COOKIES, THEMES, isRecord, isString, themeOf } from '@raven/core'
import type { ApiForProps } from '@raven/native'
import type * as Native from '@raven/native'
import { bumpCookieVersion } from '@raven/native/headless'
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native'
import { ActionSheetIOS, StyleSheet } from 'react-native'

import type { Picture } from '@/queries/cards'
import { clearOnServerSwitch } from '@/queries/serverCache'
import { TOUCH_NAV_COPY } from '@/layouts/touchMenuKit'
import { APP_ROUTES, APP_ROUTE_PARAMS, searchHrefOf } from '@/routes'
import { Home } from '@/screens/Home'
import { useActiveServer } from '@/stores/activeServer'
import { DEFAULT_APP_PREFS, useAppPrefs } from '@/stores/appPrefs'
import { useTouchMenu } from '@/stores/touchMenu'
import { SIZES } from '@/theme/appTheme'
import { NAS, OTHER, homeApi } from '@/test/homeServer'
import { NATIVE_EVENTS } from '@/test/nativeEvents'
import { createScreenClient, renderScreen } from '@/test/renderScreen'

const mockPush = jest.fn()
const NAV_LABELS: ReadonlySet<string | undefined> = new Set([
  TOUCH_NAV_COPY.menu,
  TOUCH_NAV_COPY.theme,
  TOUCH_NAV_COPY.runSearch,
])

/** The cards on the page: its buttons but the header's. */
const cardsOnPage = () =>
  screen.getAllByRole('button').filter((button) => !NAV_LABELS.has(button.props.accessibilityLabel))
const mockApi = jest.fn(homeApi)
const mockCookies = jest.fn<() => Record<string, string>>(() => ({}))
/** The first light theme, which the default is not. */
const LIGHT_THEME = THEMES.find((theme) => theme.tone !== themeOf(DEFAULT_APP_PREFS.theme).tone)
const PHONE_WIDTH = 390
const mockWindowWidth = jest.fn(() => PHONE_WIDTH)

jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }))
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: mockWindowWidth(), height: 844, scale: 3, fontScale: 1 }),
}))
jest.mock('@raven/native', () => ({
  ...jest.requireActual<typeof Native>('@raven/native'),
  apiFor: ({ server }: ApiForProps) => mockApi(server),
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
    jest.restoreAllMocks()
    jest.clearAllMocks()
    useTouchMenu.setState({ isOpen: false })
    useAppPrefs.setState(DEFAULT_APP_PREFS)
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
    const cards = cardsOnPage().map((card) => card.props.accessibilityLabel)
    expect(cards).toEqual(['Busboys', 'Busboys', 'Night Train', 'Severance'])
  })

  it('opens the item a card is for', async () => {
    await renderHome()
    await fireEvent.press(await screen.findByRole('button', { name: 'Severance' }))
    expect(mockPush).toHaveBeenCalledWith({
      pathname: APP_ROUTES.item,
      params: { [APP_ROUTE_PARAMS.id]: '4' },
    })
  })

  it("opens a library from its shelf's title, as the web's shelf heading links to it", async () => {
    await renderHome()
    await fireEvent.press(await screen.findByRole('link', { name: 'See all in Films' }))
    expect(mockPush).toHaveBeenCalledWith({
      pathname: APP_ROUTES.library,
      params: { [APP_ROUTE_PARAMS.id]: '1' },
    })
    expect(screen.queryByRole('link', { name: 'See all in Continue watching' })).toBeNull()
  })

  it('shows the search as a field with a button that runs it, and no search button of its own', async () => {
    await renderHome()
    await screen.findByRole('header', { name: 'Films' })
    expect(screen.getByLabelText('Search every library')).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Search every library' })).toBeNull()
    await fireEvent.changeText(screen.getByLabelText('Search every library'), ' dune ')
    expect(mockPush).not.toHaveBeenCalled()
    await fireEvent.press(screen.getByRole('button', { name: TOUCH_NAV_COPY.runSearch }))
    expect(mockPush).toHaveBeenCalledWith(searchHrefOf('dune'))
    expect(screen.getByLabelText('Search every library').props.value).toBe('')
  })

  it("runs the search at once on the keyboard's Search key", async () => {
    await renderHome()
    await screen.findByRole('header', { name: 'Films' })
    await fireEvent.changeText(screen.getByLabelText('Search every library'), 'dune')
    await fireEvent(screen.getByLabelText('Search every library'), NATIVE_EVENTS.submitEditing, {
      nativeEvent: { text: 'dune' },
    })
    expect(mockPush).toHaveBeenCalledWith(searchHrefOf('dune'))
  })

  it('draws the field in large type', async () => {
    await renderHome()
    await screen.findByRole('header', { name: 'Films' })
    const field = screen.getByLabelText('Search every library')
    expect(StyleSheet.flatten(field.props.style)?.fontSize).toBe(SIZES.textXl)
  })

  it('opens the side menu from the menu button, with no Home button on Home itself', async () => {
    await renderHome()
    await screen.findByRole('header', { name: 'Films' })
    expect(screen.queryByRole('button', { name: TOUCH_NAV_COPY.home })).toBeNull()
    await fireEvent.press(screen.getByRole('button', { name: TOUCH_NAV_COPY.menu }))
    expect(useTouchMenu.getState().isOpen).toBe(true)
  })

  it("swaps the theme from the header's button and wears it at once", async () => {
    const asked: string[][] = []
    jest.spyOn(ActionSheetIOS, 'showActionSheetWithOptions').mockImplementation((options, done) => {
      asked.push(options.options)
      done(options.options.indexOf(LIGHT_THEME?.name ?? ''))
    })
    await renderHome()
    await screen.findByRole('header', { name: 'Films' })
    await fireEvent.press(screen.getByRole('button', { name: TOUCH_NAV_COPY.theme }))
    expect(asked).toEqual([[...THEMES.map((theme) => theme.name), 'Cancel']])
    expect(useAppPrefs.getState().theme).toBe(LIGHT_THEME?.id)
  })

  it('draws each card as wide as its shape asks: a wide frame, then posters', async () => {
    await renderHome()
    await screen.findByRole('header', { name: 'Films' })
    const widths = cardsOnPage().map((card) => StyleSheet.flatten(card.props.style)?.width ?? null)
    expect(widths).toEqual([288, 128, 128, 128])
  })

  it('draws the cards larger on a tablet', async () => {
    mockWindowWidth.mockReturnValue(1024)
    await renderHome()
    await screen.findByRole('header', { name: 'Films' })
    const widths = cardsOnPage().map((card) => StyleSheet.flatten(card.props.style)?.width ?? null)
    expect(widths).toEqual([400, 168, 168, 168])
  })

  it('asks for no focus on a touch screen', async () => {
    await renderHome()
    await screen.findByRole('header', { name: 'Films' })
    const cards = cardsOnPage()
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

    mockCookies.mockReturnValue({ [SERVER_COOKIES.unlock]: 'u.2' })
    await act(async () => bumpCookieVersion())
    await waitFor(() => expect(pictures()).toHaveLength(4))
    expect(pictures().map(({ headers }) => headers)).toEqual(
      Array.from({ length: 4 }, () => ({ [AUTH_HEADERS.cookie]: 'raven_unlock=u.2' })),
    )
  })
})

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
