import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import { ravenQueriesFor } from '@raven/ui/headless'
import { act, fireEvent, screen } from '@testing-library/react-native'

import { TouchMenu } from '@/layouts/TouchMenu'
import { TOUCH_NAV_COPY } from '@/layouts/touchMenuKit'
import type { AppQueries } from '@/queries/useAppQueries'
import { APP_ROUTES, ROUTE_TARGETS, hrefOf } from '@/routes'
import { DEFAULT_APP_PREFS, useAppPrefs } from '@/stores/appPrefs'
import { useReduceMotion } from '@/stores/reduceMotion'
import { useTouchMenu } from '@/stores/touchMenu'
import { NAS, SERIES, homeApi } from '@/test/homeServer'
import { renderScreen } from '@/test/renderScreen'

const mockPush = jest.fn()
const mockReplace = jest.fn()
const mockDismissTo = jest.fn()
let mockPathname = APP_ROUTES.home as string

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace, dismissTo: mockDismissTo }),
  usePathname: () => mockPathname,
}))

const api = homeApi()
const SESSION: AppQueries = {
  server: NAS,
  api,
  queries: ravenQueriesFor(api),
  useServerEvents: () => undefined,
}

const SHEET = 'Menu'

const openMenu = async () => {
  await renderScreen({ ui: <TouchMenu session={SESSION} /> })
  await act(async () => useTouchMenu.getState().open())
}

describe('the side menu of a phone or tablet', () => {
  beforeEach(() => {
    jest.restoreAllMocks()
    jest.clearAllMocks()
    mockPathname = APP_ROUTES.home
    useTouchMenu.setState({ isOpen: false })
    useReduceMotion.setState({ isReduced: true })
    useAppPrefs.setState(DEFAULT_APP_PREFS)
  })

  it('draws nothing while it is shut', async () => {
    await renderScreen({ ui: <TouchMenu session={SESSION} /> })
    expect(screen.queryByLabelText(SHEET)).toBeNull()
    expect(screen.queryByLabelText(TOUCH_NAV_COPY.closeMenu)).toBeNull()
  })

  it("holds the web's menu: Home, Favourites, the pinned libraries, Settings, no theme row", async () => {
    await openMenu()
    expect(await screen.findByRole('link', { name: 'Films' })).toBeTruthy()
    expect(screen.queryByLabelText('Search every library')).toBeNull()
    expect(screen.getByRole('header', { name: 'Pinned' })).toBeTruthy()
    expect(screen.getAllByRole('link').map((link) => link.props.accessibilityLabel)).toEqual([
      'Home',
      'Favourites',
      'Films',
      'Series',
      'Settings',
    ])
    expect(screen.queryByRole('button', { name: 'Search every library' })).toBeNull()
  })

  it('shuts when the scrim is pressed', async () => {
    await openMenu()
    await fireEvent.press(
      screen.getByRole('button', { name: TOUCH_NAV_COPY.closeMenu, hidden: true }),
    )
    expect(useTouchMenu.getState().isOpen).toBe(false)
    expect(screen.queryByLabelText(SHEET)).toBeNull()
  })

  it('opens a library on top of Home and shuts', async () => {
    await openMenu()
    await fireEvent.press(await screen.findByRole('link', { name: 'Series' }))
    expect(mockPush).toHaveBeenCalledWith(
      hrefOf({ kind: ROUTE_TARGETS.library, libraryId: SERIES.id, query: '' }),
    )
    expect(useTouchMenu.getState().isOpen).toBe(false)
  })

  it('takes the place of the page it is chosen from anywhere but Home', async () => {
    mockPathname = '/library/1'
    await openMenu()
    await fireEvent.press(await screen.findByRole('link', { name: 'Favourites' }))
    expect(mockReplace).toHaveBeenCalledWith({ pathname: APP_ROUTES.favourites, params: {} })
    expect(mockPush).not.toHaveBeenCalled()
  })

  it('goes to Settings, and back to Home without stacking another', async () => {
    mockPathname = '/library/1'
    await openMenu()
    await fireEvent.press(screen.getByRole('link', { name: 'Settings' }))
    expect(mockReplace).toHaveBeenCalledWith({ pathname: APP_ROUTES.settings, params: {} })
    await act(async () => useTouchMenu.getState().open())
    await fireEvent.press(screen.getByRole('link', { name: 'Home' }))
    expect(mockDismissTo).toHaveBeenCalledWith(APP_ROUTES.home)
  })

  it('keeps off the video player, and shuts when it opens', async () => {
    await openMenu()
    mockPathname = '/play/20'
    await renderScreen({ ui: <TouchMenu session={SESSION} /> })
    expect(useTouchMenu.getState().isOpen).toBe(false)
    expect(screen.queryByLabelText(SHEET)).toBeNull()
  })
})
