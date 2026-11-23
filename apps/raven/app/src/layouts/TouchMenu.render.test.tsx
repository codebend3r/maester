import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import type { FetchLike } from '@raven/core'
import type * as Native from '@raven/native'
import type { ApiForProps } from '@raven/native'
import type * as Headless from '@raven/native/headless'
import { RAVEN_SERVER } from '@raven/native/headless'
import { ravenQueriesFor } from '@raven/ui/headless'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native'

import { SERVER_SWITCHER_COPY } from '@/layouts/copy'
import { TouchMenu } from '@/layouts/TouchMenu'
import { TOUCH_NAV_COPY } from '@/layouts/touchMenuKit'
import type { AppQueries } from '@/queries/useAppQueries'
import { APP_ROUTES, ROUTE_TARGETS, hrefOf } from '@/routes'
import { useActiveServer } from '@/stores/activeServer'
import { DEFAULT_APP_PREFS, useAppPrefs } from '@/stores/appPrefs'
import { useReduceMotion } from '@/stores/reduceMotion'
import { useTouchMenu } from '@/stores/touchMenu'
import {
  type AccountData,
  HOME_SERVER_ID,
  MELEYS,
  accountDataOf,
  accountFetchOf,
  signInTestAccount,
} from '@/test/accountData'
import { FILMS, NAS, SERIES, homeApi } from '@/test/homeServer'
import { renderScreen } from '@/test/renderScreen'
import { useAccountSession } from '@/account/session'

const mockPush = jest.fn()
const mockReplace = jest.fn()
const mockDismissTo = jest.fn()
let mockPathname: string = APP_ROUTES.home

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace, dismissTo: mockDismissTo }),
  usePathname: () => mockPathname,
}))

/** Meleys' own library 1, named as home's is, which only its server's name tells apart. */
const MELEYS_FILMS = { ...FILMS, id: 5 }

let mockAccount: AccountData = accountDataOf()
const mockAccountFetch: FetchLike = (url, init) => accountFetchOf(mockAccount)(url, init)
const mockApiOf = (server: Headless.AppServer) => ({
  ...homeApi(server),
  listLibraries: async () => (server.id === MELEYS.id ? [MELEYS_FILMS] : [FILMS, SERIES]),
})

jest.mock('@raven/native', () => ({
  ...jest.requireActual<typeof Native>('@raven/native'),
  apiFor: ({ server }: ApiForProps) => mockApiOf(server),
  openFetch: ((url, init) => mockAccountFetch(url, init)) satisfies FetchLike,
}))

const api = homeApi()
const SESSION: AppQueries = {
  server: NAS,
  api,
  queries: ravenQueriesFor(api),
  useServerEvents: () => undefined,
}

const SHEET = 'Menu'

/** Both servers' pins of a library named as Films, once the second server's libraries have answered too. */
const findFilmsPinsOfBothServers = async () => {
  await waitFor(() => expect(screen.getAllByRole('link', { name: FILMS.name })).toHaveLength(2))
  return screen.getAllByRole('link', { name: FILMS.name })
}

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
    useActiveServer.setState({ servers: [NAS], activeId: NAS.id, homeServerId: null })
    mockAccount = accountDataOf({
      pins: [
        { serverId: NAS.id, libraryId: FILMS.id, pinnedAt: '1' },
        { serverId: NAS.id, libraryId: SERIES.id, pinnedAt: '2' },
      ],
    })
    signInTestAccount()
  })

  it('draws nothing while it is shut', async () => {
    await renderScreen({ ui: <TouchMenu session={SESSION} /> })
    expect(screen.queryByLabelText(SHEET)).toBeNull()
    expect(screen.queryByLabelText(TOUCH_NAV_COPY.closeMenu)).toBeNull()
  })

  it("holds the web's menu: Home, Continue watching, Binge, Coming soon, Favourites, Downloads, Libraries, the pinned libraries, Settings, no theme row", async () => {
    await openMenu()
    expect(await screen.findByRole('link', { name: 'Films' })).toBeTruthy()
    expect(screen.queryByLabelText('Search every library')).toBeNull()
    expect(screen.getByRole('header', { name: 'Pinned' })).toBeTruthy()
    expect(screen.getAllByRole('link').map((link) => link.props.accessibilityLabel)).toEqual([
      'Home',
      'Continue watching',
      'Binge',
      'Coming soon',
      'Favourites',
      'Downloads',
      'Libraries',
      'Films',
      'Series',
      'Settings',
    ])
    expect(screen.queryByRole('button', { name: 'Search every library' })).toBeNull()
  })

  it('lists only what the account pinned, in the server order', async () => {
    mockAccount.pins = [{ serverId: NAS.id, libraryId: SERIES.id, pinnedAt: '1' }]
    await openMenu()
    expect(await screen.findByRole('link', { name: 'Series' })).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Films' })).toBeNull()
  })

  it('lists no pinned libraries, and no heading, while nobody is signed in', async () => {
    useAccountSession.setState({ session: null })
    await openMenu()
    expect(await screen.findByRole('link', { name: 'Libraries' })).toBeTruthy()
    expect(screen.queryByRole('header', { name: 'Pinned' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Films' })).toBeNull()
  })

  describe('with several servers', () => {
    beforeEach(() => {
      useActiveServer.setState({
        home: RAVEN_SERVER,
        servers: [RAVEN_SERVER, MELEYS],
        activeId: RAVEN_SERVER.id,
        homeServerId: HOME_SERVER_ID,
      })
      mockAccount.pins = [
        { serverId: HOME_SERVER_ID, libraryId: FILMS.id, pinnedAt: '1' },
        { serverId: MELEYS.id, libraryId: MELEYS_FILMS.id, pinnedAt: '2' },
      ]
    })

    it('lists the pins of every server, each over its server name in small type', async () => {
      await openMenu()
      const [onHome, onMeleys] = await findFilmsPinsOfBothServers()
      expect(within(onHome).getByText(RAVEN_SERVER.name)).toBeTruthy()
      expect(within(onMeleys).getByText(MELEYS.name)).toBeTruthy()
    })

    it('switches to the server of a pin on another and opens its library', async () => {
      await openMenu()
      const [, onMeleys] = await findFilmsPinsOfBothServers()
      await fireEvent.press(onMeleys)
      expect(useActiveServer.getState().activeId).toBe(MELEYS.id)
      expect(mockPush).toHaveBeenCalledWith(
        hrefOf({ kind: ROUTE_TARGETS.library, libraryId: MELEYS_FILMS.id, query: '' }),
      )
    })

    it('switches servers from the head of the menu, the one in use checked', async () => {
      await openMenu()
      expect(screen.getByRole('header', { name: SERVER_SWITCHER_COPY.servers })).toBeTruthy()
      expect(
        screen.getByRole('button', { name: SERVER_SWITCHER_COPY.inUse(RAVEN_SERVER.name) }),
      ).toBeTruthy()
      await fireEvent.press(
        screen.getByRole('button', { name: SERVER_SWITCHER_COPY.row(MELEYS.name) }),
      )
      expect(useActiveServer.getState().activeId).toBe(MELEYS.id)
      expect(useTouchMenu.getState().isOpen).toBe(false)
    })
  })

  it('shows no server switcher with one server', async () => {
    await openMenu()
    expect(await screen.findByRole('link', { name: 'Films' })).toBeTruthy()
    expect(screen.queryByRole('header', { name: SERVER_SWITCHER_COPY.servers })).toBeNull()
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

  it('opens Continue watching on top of Home', async () => {
    await openMenu()
    await fireEvent.press(
      await screen.findByRole('link', { name: TOUCH_NAV_COPY.continueWatching }),
    )
    expect(mockPush).toHaveBeenCalledWith({ pathname: APP_ROUTES.continueWatching, params: {} })
    expect(useTouchMenu.getState().isOpen).toBe(false)
  })

  it('opens Downloads on top of Home', async () => {
    await openMenu()
    await fireEvent.press(await screen.findByRole('link', { name: TOUCH_NAV_COPY.downloads }))
    expect(mockPush).toHaveBeenCalledWith({ pathname: APP_ROUTES.downloads, params: {} })
    expect(useTouchMenu.getState().isOpen).toBe(false)
  })

  it('opens every library on top of Home', async () => {
    await openMenu()
    await fireEvent.press(await screen.findByRole('link', { name: TOUCH_NAV_COPY.libraries }))
    expect(mockPush).toHaveBeenCalledWith({ pathname: APP_ROUTES.libraries, params: {} })
    expect(useTouchMenu.getState().isOpen).toBe(false)
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
