import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import { ravenQueriesFor } from '@raven/ui/headless'
import { act, fireEvent, screen } from '@testing-library/react-native'

import { TouchNav } from '@/layouts/TouchNav'
import { TouchTabs } from '@/layouts/TouchTabs'
import { TOUCH_NAV_COPY } from '@/layouts/touchMenuKit'
import { TOUCH_TABS_COPY } from '@/layouts/touchTabsKit'
import type * as DevicePlatform from '@/platform/devicePlatform'
import { NAV_KINDS, type NavKind } from '@/platform/platform'
import type { AppQueries } from '@/queries/useAppQueries'
import { APP_ROUTES, ROUTE_TARGETS, hrefOf, searchHrefOf } from '@/routes'
import { DEFAULT_APP_PREFS, useAppPrefs } from '@/stores/appPrefs'
import { useReduceMotion } from '@/stores/reduceMotion'
import { NAS, SERIES, homeApi } from '@/test/homeServer'
import { renderScreen } from '@/test/renderScreen'

const mockPush = jest.fn()
const mockReplace = jest.fn()
const mockDismissTo = jest.fn()
const mockPathname = jest.fn<() => string>(() => APP_ROUTES.home)
const mockNavKind = jest.fn<() => NavKind>(() => NAV_KINDS.tabs)

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace, dismissTo: mockDismissTo }),
  usePathname: () => mockPathname(),
}))
jest.mock('@/platform/devicePlatform', () => ({
  ...jest.requireActual<typeof DevicePlatform>('@/platform/devicePlatform'),
  deviceNavKind: () => mockNavKind(),
}))

const api = homeApi()
const SESSION: AppQueries = {
  server: NAS,
  api,
  queries: ravenQueriesFor(api),
  useServerEvents: () => undefined,
}

const renderTabs = async () => renderScreen({ ui: <TouchTabs session={SESSION} /> })

const openMore = async () => {
  await renderTabs()
  await fireEvent.press(screen.getByRole('tab', { name: TOUCH_TABS_COPY.more }))
}

describe('the tab bar of an iPhone', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockPathname.mockReturnValue(APP_ROUTES.home)
    mockNavKind.mockReturnValue(NAV_KINDS.tabs)
    useReduceMotion.setState({ isReduced: true })
    useAppPrefs.setState(DEFAULT_APP_PREFS)
  })

  it('holds Home, Libraries, Favourites, Continue watching and More, Home lit on Home', async () => {
    await renderTabs()
    expect(screen.getByLabelText(TOUCH_TABS_COPY.bar)).toBeTruthy()
    expect(screen.getAllByRole('tab').map((tab) => tab.props.accessibilityLabel)).toEqual([
      'Home',
      'Libraries',
      'Favourites',
      'Continue watching',
      'More',
    ])
    expect(screen.getByRole('tab', { name: 'Home' }).props.accessibilityState).toMatchObject({
      selected: true,
    })
    expect(screen.getByRole('tab', { name: 'More' }).props.accessibilityState).toEqual({
      selected: false,
      expanded: false,
    })
  })

  it('opens a page on top of Home, and in place of any other', async () => {
    await renderTabs()
    await fireEvent.press(screen.getByRole('tab', { name: 'Favourites' }))
    expect(mockPush).toHaveBeenCalledWith({ pathname: APP_ROUTES.favourites, params: {} })
    mockPathname.mockReturnValue(APP_ROUTES.favourites)
    await renderTabs()
    expect(screen.getByRole('tab', { name: 'Favourites' }).props.accessibilityState).toMatchObject({
      selected: true,
    })
    await fireEvent.press(screen.getByRole('tab', { name: 'Continue watching' }))
    expect(mockReplace).toHaveBeenCalledWith({
      pathname: APP_ROUTES.continueWatching,
      params: {},
    })
  })

  it('goes back to Home without stacking another, and leaves the page showing as it is', async () => {
    mockPathname.mockReturnValue(APP_ROUTES.libraries)
    await renderTabs()
    await fireEvent.press(screen.getByRole('tab', { name: 'Libraries' }))
    expect(mockReplace).not.toHaveBeenCalled()
    await fireEvent.press(screen.getByRole('tab', { name: 'Home' }))
    expect(mockDismissTo).toHaveBeenCalledWith(APP_ROUTES.home)
  })

  it('stays off the video player', async () => {
    mockPathname.mockReturnValue('/play/20')
    await renderTabs()
    expect(screen.queryByLabelText(TOUCH_TABS_COPY.bar)).toBeNull()
  })
})

describe('the More sheet', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockPathname.mockReturnValue(APP_ROUTES.home)
    mockNavKind.mockReturnValue(NAV_KINDS.tabs)
    useReduceMotion.setState({ isReduced: true })
    useAppPrefs.setState(DEFAULT_APP_PREFS)
  })

  it('draws nothing until More is pressed', async () => {
    await renderTabs()
    expect(screen.queryByRole('header', { name: TOUCH_TABS_COPY.more })).toBeNull()
  })

  it('holds Search, Binge, Downloads, Settings and the pinned libraries under their heading, More lit and expanded', async () => {
    await openMore()
    expect(await screen.findByRole('link', { name: 'Films' })).toBeTruthy()
    expect(screen.getByRole('header', { name: TOUCH_TABS_COPY.more })).toBeTruthy()
    expect(screen.getByRole('header', { name: 'Pinned' })).toBeTruthy()
    expect(screen.getAllByRole('link').map((link) => link.props.accessibilityLabel)).toEqual([
      'Search',
      'Binge',
      'Downloads',
      'Settings',
      'Films',
      'Series',
    ])
    expect(screen.getByRole('tab', { name: 'More' }).props.accessibilityState).toEqual({
      selected: true,
      expanded: true,
    })
    expect(screen.getByRole('tab', { name: 'Home' }).props.accessibilityState).toMatchObject({
      selected: false,
    })
  })

  it('opens a pinned library on top of Home and shuts', async () => {
    await openMore()
    await fireEvent.press(await screen.findByRole('link', { name: 'Series' }))
    expect(mockPush).toHaveBeenCalledWith(
      hrefOf({ kind: ROUTE_TARGETS.library, libraryId: SERIES.id, query: '' }),
    )
    expect(screen.queryByRole('header', { name: TOUCH_TABS_COPY.more })).toBeNull()
  })

  it('opens Search and Settings in place of the page anywhere but Home', async () => {
    mockPathname.mockReturnValue('/library/1')
    await openMore()
    await fireEvent.press(screen.getByRole('link', { name: 'Search' }))
    expect(mockReplace).toHaveBeenCalledWith(searchHrefOf(''))
    await fireEvent.press(screen.getByRole('tab', { name: 'More' }))
    await fireEvent.press(screen.getByRole('link', { name: 'Settings' }))
    expect(mockReplace).toHaveBeenCalledWith({ pathname: APP_ROUTES.settings, params: {} })
    expect(mockPush).not.toHaveBeenCalled()
  })

  it('shuts when the scrim is pressed, or More again', async () => {
    await openMore()
    await fireEvent.press(
      screen.getByRole('button', { name: TOUCH_TABS_COPY.closeMore, hidden: true }),
    )
    expect(screen.queryByRole('header', { name: TOUCH_TABS_COPY.more })).toBeNull()
    await fireEvent.press(screen.getByRole('tab', { name: 'More' }))
    expect(screen.getByRole('header', { name: TOUCH_TABS_COPY.more })).toBeTruthy()
    await fireEvent.press(screen.getByRole('tab', { name: 'More' }))
    expect(screen.queryByRole('header', { name: TOUCH_TABS_COPY.more })).toBeNull()
  })

  it('shuts when a tab is chosen under it', async () => {
    await openMore()
    await fireEvent.press(screen.getByRole('tab', { name: 'Libraries' }))
    expect(mockPush).toHaveBeenCalledWith({ pathname: APP_ROUTES.libraries, params: {} })
    expect(screen.queryByRole('header', { name: TOUCH_TABS_COPY.more })).toBeNull()
  })

  it('shuts on the accessibility escape', async () => {
    await openMore()
    await act(async () =>
      screen.getByLabelText(TOUCH_TABS_COPY.moreSheet).props.onAccessibilityEscape(),
    )
    expect(screen.queryByRole('header', { name: TOUCH_TABS_COPY.more })).toBeNull()
  })
})

describe('the touch header', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockPathname.mockReturnValue(APP_ROUTES.libraries)
    useAppPrefs.setState(DEFAULT_APP_PREFS)
  })

  it('has no menu button on an iPhone, which moves by its tab bar', async () => {
    mockNavKind.mockReturnValue(NAV_KINDS.tabs)
    await renderScreen({ ui: <TouchNav /> })
    expect(screen.queryByRole('button', { name: TOUCH_NAV_COPY.menu })).toBeNull()
    expect(screen.getByRole('button', { name: TOUCH_NAV_COPY.home })).toBeTruthy()
  })

  it('keeps the menu button on an iPad, whose side menu stays', async () => {
    mockNavKind.mockReturnValue(NAV_KINDS.drawer)
    await renderScreen({ ui: <TouchNav /> })
    expect(screen.getByRole('button', { name: TOUCH_NAV_COPY.menu })).toBeTruthy()
  })
})
