import { afterAll, afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test'
import {
  type Account,
  ADMIN_LOCK_STATES,
  type AdminLock,
  DESKTOP_PATHS,
  DESKTOP_REPLIES,
  DESKTOP_REQUESTS,
  DOWNLOAD_STATUS_KINDS,
  isLibraryKind,
  KINDS,
  type LibraryPin,
  PAGE_PATHS,
} from '@raven/core'
import { act, cleanup, fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { AppShell } from '@/components/AppShell/AppShell'
import { api, apiAt } from '@/lib/api'
import { LESS_MOTION } from '@/lib/motion'
import { ravenVersion } from '@/lib/version'
import { usePageBackdrop } from '@/stores/pageBackdrop'
import { useAuthSession } from '@/stores/authSession'
import { useDesktopBridge } from '@/stores/desktop'
import { useDownloadsHostStore } from '@/stores/downloadsHost'
import { useServerReach } from '@/stores/serverReach'
import { useSideMenu } from '@/stores/sideMenu'
import { fakeAccount, readyConfig } from '@/test/authClient'
import { accountDataFor } from '@/lib/accountData'
import { MELEYS_ID, MELEYS_ORIGIN, meleysRow, pin } from '@/test/servers'
import { useActiveServer } from '@raven/ui/headless'
import { asBrowserDownloads, fakeEngine } from '@/test/browserDownloads'
import { FakeEventSource } from '@/test/eventSource'
import { asDesktop, DL_2, downloadsMain, fakeClient, viewOf } from '@/test/desktop'
import { library } from '@/test/fixtures'
import { musicLibrary } from '@/test/music'
import { renderWithProviders } from '@/test/render'
import { MEDIUM_SCREEN } from '@/components/AppShell/useIsMediumScreen'
import { APP_PATHS } from '@/lib/appPaths'

type RenderShellProps = {
  route: string
  adminLock?: AdminLock
  /** Who is signed in: the owner unless named, and no one, with accounts off, for null. */
  account?: Account | null
}

const OWNER = fakeAccount({ isOwner: true })

const renderShell = ({ route, adminLock, account = OWNER }: RenderShellProps) =>
  renderWithProviders({
    ui: (
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<p>home</p>} />
          <Route path="libraries" element={<p>libraries</p>} />
          <Route path="favourites" element={<p>favourites</p>} />
          <Route path="libraries/:id" element={<p>library</p>} />
          <Route
            path="search"
            element={
              <label>
                Search <input />
              </label>
            }
          />
        </Route>
      </Routes>
    ),
    route,
    adminLock,
    account,
  })

const nav = () => screen.getByRole('navigation', { name: 'Main' })
const tabs = () => screen.getByRole('navigation', { name: 'Tabs' })
const logo = () => screen.getByRole('link', { name: 'Raven' })
const toggle = () => screen.getByRole('button', { name: 'Side menu' })
const iconOf = (element: HTMLElement) => element.querySelector('svg')?.dataset.icon
const iconsOf = (element: HTMLElement) =>
  [...element.querySelectorAll('svg')].map((svg) => svg.dataset.icon)

const SCREEN_SIZES = { wide: 'wide', medium: 'medium' } as const

/*
 * `all` matches any screen and `not all` none, so only a medium screen
 * matches the side menu's query for one.
 */
const real = window.matchMedia.bind(window)
const screenOf =
  (size: (typeof SCREEN_SIZES)[keyof typeof SCREEN_SIZES]) =>
  (query: string): MediaQueryList =>
    real(size === SCREEN_SIZES.medium && query === MEDIUM_SCREEN ? 'all' : 'not all')

/** Opens the nine-dot button's fan and hands back its list of places. */
const openBrowse = async (): Promise<HTMLElement> => {
  await userEvent.hover(await within(nav()).findByRole('button', { name: 'Browse' }))
  return screen.getByRole('list', { name: 'Browse' })
}

describe('AppShell', () => {
  const list = spyOn(api, 'listLibraries')
  // The account pinned every library its home server lists, as each test's list says.
  const pinEveryListed = async (): Promise<LibraryPin[]> =>
    ((await list.getMockImplementation()?.()) ?? []).map((listed) => pin({ libraryId: listed.id }))
  const spies = {
    list,
    media: spyOn(window, 'matchMedia'),
    pins: spyOn(accountDataFor(readyConfig), 'listPins').mockImplementation(pinEveryListed),
    servers: spyOn(accountDataFor(readyConfig), 'listServers').mockImplementation(async () => []),
    meleys: spyOn(apiAt(MELEYS_ORIGIN), 'listLibraries'),
  }

  // Manage opens folded; the tests that read its links start with it open.
  beforeEach(() => {
    spies.media.mockImplementation(screenOf(SCREEN_SIZES.wide))
    useSideMenu.setState({ isManageOpen: true })
  })

  afterEach(() => {
    cleanup()
    spies.list.mockReset()
    useAuthSession.setState({ session: null })
  })

  afterAll(() => {
    spies.media.mockRestore()
    spies.pins.mockRestore()
    spies.servers.mockRestore()
    spies.meleys.mockRestore()
  })

  it('offers the music mode in the menu and the tabs once a music library exists', async () => {
    spies.list.mockImplementation(async () => [musicLibrary()])
    renderShell({ route: '/' })
    await within(tabs()).findByRole('link', { name: 'Music' })
    const music = within(await openBrowse()).getByRole('link', { name: 'Music' })
    expect(music).toHaveAttribute('href', '/music')
    expect(iconOf(music)).toBe('music')
    expect(within(tabs()).getByRole('link', { name: 'Music' })).toHaveAttribute('href', '/music')
  })

  it('has no music mode without a music library', async () => {
    spies.list.mockImplementation(async () => [library()])
    renderShell({ route: '/' })
    expect(await within(nav()).findByRole('link', { name: 'Movies' })).toBeInTheDocument()
    expect(within(await openBrowse()).queryByRole('link', { name: 'Music' })).toBeNull()
    expect(within(tabs()).queryByRole('link', { name: 'Music' })).toBeNull()
  })

  it('links home from the logo, named by its word alone', () => {
    spies.list.mockImplementation(async () => [])
    renderShell({ route: '/favourites' })
    const home = screen.getByRole('link', { name: 'Raven' })
    expect(home).toHaveAttribute('href', '/')
    expect(home.querySelector('img')).toHaveAttribute('src', '/brand/raven-mark-on-dark.svg')
  })

  it('leads with the logo, then Home, a house, marked on the page it opens on', () => {
    spies.list.mockImplementation(async () => [])
    renderShell({ route: '/' })
    const [brand, first] = within(nav()).getAllByRole('link')
    expect(brand).toBe(logo())
    expect(first).toHaveAccessibleName('Home')
    expect(first).toHaveAttribute('href', '/')
    expect(first).toHaveAttribute('aria-current', 'page')
    expect(first && iconOf(first)).toBe('home')
    expect(within(nav()).getByRole('link', { name: 'Libraries' })).not.toHaveAttribute(
      'aria-current',
    )
  })

  it('marks Libraries, not Home, on the list of libraries', () => {
    spies.list.mockImplementation(async () => [])
    renderShell({ route: '/libraries' })
    expect(within(nav()).getByRole('link', { name: 'Libraries' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(within(nav()).getByRole('link', { name: 'Home' })).not.toHaveAttribute('aria-current')
  })

  it('links to the libraries and the favourites, marking the current page', async () => {
    spies.list.mockImplementation(async () => [])
    renderShell({ route: '/favourites' })
    expect(within(nav()).getByRole('link', { name: 'Libraries' })).toHaveAttribute(
      'href',
      '/libraries',
    )
    expect(within(nav()).getByRole('button', { name: 'Browse' })).toHaveClass('current')
    const favourites = within(await openBrowse()).getByRole('link', { name: 'Favourites' })
    expect(favourites).toHaveAttribute('href', '/favourites')
    expect(favourites).toHaveAttribute('aria-current', 'page')
    expect(within(nav()).getByRole('link', { name: 'Libraries' })).not.toHaveAttribute(
      'aria-current',
    )
  })

  it('leads with the logo, Home and Favourites, then the pinned libraries, with Libraries, Streams, Bug reports, Notifications, Settings and Shortcuts last', async () => {
    spies.list.mockImplementation(async () => [library({ id: 3, name: 'Movies' })])
    renderShell({ route: '/' })
    await within(nav()).findByRole('link', { name: 'Movies' })
    expect(
      within(nav())
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual([
      'Raven',
      'Home',
      'Movies',
      'Libraries',
      'Admin',
      'Streams',
      'Bug reports',
      'Everyone’s history',
      'Play history',
      'Notifications',
      'Settings',
      'Shortcuts',
      'Design',
    ])
  })

  it('leaves Streams and Bug reports out of the menus and the tab bar while the admin lock is on', async () => {
    spies.list.mockImplementation(async () => [])
    renderShell({
      route: APP_PATHS.home,
      adminLock: { state: ADMIN_LOCK_STATES.on, available: true },
      account: null,
    })
    expect(await within(nav()).findByRole('link', { name: 'Settings' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Streams' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Bug reports' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Reports' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Admin' })).toBeNull()
  })

  it('opens a page a link leads to at its top', async () => {
    spies.list.mockImplementation(async () => [])
    const scroll = spyOn(window, 'scrollTo').mockImplementation(() => undefined)
    renderShell({ route: '/' })
    expect(scroll).not.toHaveBeenCalled()
    await userEvent.click(within(await openBrowse()).getByRole('link', { name: 'Favourites' }))
    expect(scroll).toHaveBeenCalledWith({ top: 0 })
    scroll.mockRestore()
  })

  it("marks a pinned library's own link, not Libraries, while it is open", async () => {
    spies.list.mockImplementation(async () => [library({ id: 3, name: 'Movies' })])
    renderShell({ route: '/libraries/3' })
    const movies = await within(nav()).findByRole('link', { name: 'Movies' })
    expect(movies).toHaveAttribute('aria-current', 'page')
    expect(within(nav()).getByRole('link', { name: 'Libraries' })).not.toHaveAttribute(
      'aria-current',
    )
  })

  it("gives each pinned library its type's icon", async () => {
    spies.list.mockImplementation(async () =>
      isLibraryKind.values.map((kind, index) =>
        library({ id: index + 1, name: kind, settings: { ...library().settings, kind } }),
      ),
    )
    renderShell({ route: '/' })
    const pinned = await within(nav()).findByRole('list', { name: 'Pinned' })
    expect(within(pinned).getAllByRole('link').map(iconOf)).toEqual([
      'film',
      'tv',
      'filmSpark',
      'tvSpark',
      'filmHeart',
      'tvHeart',
      'globe',
      'trophy',
      'youtube',
      'video',
      'music',
      'audiobook',
    ])
  })

  it('gives a pinned library the icon it picked, whatever its type', async () => {
    spies.list.mockImplementation(async () => [
      library({
        id: 1,
        name: 'UFC',
        settings: { ...library().settings, kind: 'sports', icon: 'octagon' },
      }),
      library({ id: 2, name: 'Music', settings: { ...library().settings, icon: 'disc' } }),
    ])
    renderShell({ route: '/' })
    const pinned = await within(nav()).findByRole('list', { name: 'Pinned' })
    expect(within(pinned).getAllByRole('link').map(iconOf)).toEqual(['octagon', 'disc'])
  })

  it("keeps a locked library's type icon, with a lock on it, whatever its type", async () => {
    spies.list.mockImplementation(async () =>
      isLibraryKind.values.map((kind, index) =>
        library({
          id: index + 1,
          name: kind,
          settings: { ...library().settings, kind, locked: true },
        }),
      ),
    )
    renderShell({ route: '/' })
    const pinned = await within(nav()).findByRole('list', { name: 'Pinned' })
    expect(within(pinned).getAllByRole('link').map(iconsOf)).toEqual(
      isLibraryKind.values.map((kind) => [KINDS[kind].icon, 'lock']),
    )
    expect(
      within(pinned)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(isLibraryKind.values.map((kind) => `${kind} (locked)`))
  })

  it('says a locked library is locked in its tooltip once the menu collapses', async () => {
    spies.list.mockImplementation(async () => [
      library({ id: 1, name: 'Tutorials', settings: { ...library().settings, locked: true } }),
      library({ id: 2, name: 'Clips' }),
    ])
    renderShell({ route: '/' })
    await within(nav()).findByRole('link', { name: 'Tutorials (locked)' })
    await userEvent.click(toggle())
    await userEvent.hover(within(nav()).getByRole('link', { name: 'Tutorials (locked)' }))
    expect(
      await screen.findByText('Tutorials (locked)', { selector: '[aria-hidden]' }),
    ).toBeVisible()
    expect(iconsOf(within(nav()).getByRole('link', { name: 'Clips' }))).toEqual(['video'])
    await userEvent.click(toggle())
  })

  it('collapses to its icons with the toggle, keeping every link named', async () => {
    spies.list.mockImplementation(async () => [library({ id: 3, name: 'Movies' })])
    renderShell({ route: '/' })
    await within(nav()).findByRole('link', { name: 'Movies' })
    expect(toggle()).toHaveAttribute('aria-expanded', 'true')

    await userEvent.click(toggle())
    expect(toggle()).toHaveAttribute('aria-expanded', 'false')
    const movies = within(nav()).getByRole('link', { name: 'Movies' })
    expect(movies).not.toHaveAttribute('title')
    await userEvent.hover(movies)
    expect(screen.getByText('Movies', { selector: '[aria-hidden]' })).toBeInTheDocument()
    await userEvent.unhover(movies)
    expect(screen.queryByText('Movies', { selector: '[aria-hidden]' })).toBeNull()
    expect(useSideMenu.getState().collapsed).toBe(true)

    await userEvent.click(toggle())
    expect(toggle()).toHaveAttribute('aria-expanded', 'true')
    await userEvent.hover(within(nav()).getByRole('link', { name: 'Home' }))
    expect(screen.queryByText('Home', { selector: '[aria-hidden]' })).toBeNull()
  })

  it('folds Shortcuts and Design with Manage, then opens Shortcuts when restored', async () => {
    spies.list.mockImplementation(async () => [])
    renderShell({ route: '/' })
    const shortcuts = await within(nav()).findByRole('link', { name: 'Shortcuts' })
    expect(shortcuts).toHaveAttribute('href', PAGE_PATHS.shortcuts)
    expect(iconOf(shortcuts)).toBe('keyboard')
    await userEvent.click(within(nav()).getByRole('button', { name: 'Manage' }))
    expect(within(nav()).queryByRole('link', { name: 'Shortcuts' })).toBeNull()
    await userEvent.click(within(nav()).getByRole('button', { name: 'Manage' }))
    expect(within(nav()).getByRole('link', { name: 'Shortcuts' })).toBeInTheDocument()
  })

  it("paints the fan's glow in debug colours only while the address says ?debug=true", async () => {
    spies.list.mockImplementation(async () => [])
    renderShell({ route: '/?debug=true' })
    await within(nav()).findByRole('button', { name: 'Browse' })
    const places = await openBrowse()
    expect(places.previousElementSibling).toHaveClass('debug')
  })

  it('keeps the night glow outside debug mode', async () => {
    spies.list.mockImplementation(async () => [])
    renderShell({ route: '/?debug=false' })
    await within(nav()).findByRole('button', { name: 'Browse' })
    const places = await openBrowse()
    expect(places.previousElementSibling).not.toHaveClass('debug')
  })

  it('fans the browsing places out of the nine-dot button, and folds them away again', async () => {
    spies.list.mockImplementation(async () => [])
    renderShell({ route: '/favourites' })
    const browse = await within(nav()).findByRole('button', { name: 'Browse' })
    expect(iconOf(browse)).toBe('apps')
    expect(browse).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('list', { name: 'Browse' })).toBeNull()

    const places = await openBrowse()
    expect(browse).toHaveAttribute('aria-expanded', 'true')
    expect(
      within(places)
        .getAllByRole('link')
        .map((link) => [link.textContent, link.getAttribute('href')]),
    ).toEqual([
      ['Continue watching', '/continue-watching'],
      ['Binge', '/binge'],
      ['Coming soon', '/coming-soon'],
      ['Favourites', '/favourites'],
    ])
    expect(within(places).getByRole('link', { name: 'Favourites' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    const [first, , , last] = within(places).getAllByRole('listitem')
    expect(first?.style.getPropertyValue('--angle')).toBe('-90deg')
    expect(last?.style.getPropertyValue('--angle')).toBe('90deg')

    await userEvent.unhover(browse)
    expect(browse).toHaveAttribute('aria-expanded', 'false')
    expect(places).toHaveClass('folding')
    fireEvent.animationEnd(first!)
    expect(places).toBeInTheDocument()
    fireEvent.animationEnd(places.previousElementSibling!)
    expect(screen.queryByRole('list', { name: 'Browse' })).toBeNull()
  })

  it('folds the fan away at once for a viewer who asks for less motion', async () => {
    spies.media.mockImplementation((query) => real(query === LESS_MOTION ? 'all' : 'not all'))
    spies.list.mockImplementation(async () => [])
    renderShell({ route: '/' })
    const browse = await within(nav()).findByRole('button', { name: 'Browse' })
    await openBrowse()
    await userEvent.unhover(browse)
    expect(screen.queryByRole('list', { name: 'Browse' })).toBeNull()
  })

  it('opens the fan on a press, steps through it with the arrows and closes it with Escape', async () => {
    spies.list.mockImplementation(async () => [])
    renderShell({ route: '/' })
    const browse = await within(nav()).findByRole('button', { name: 'Browse' })
    act(() => browse.focus())
    const places = screen.getByRole('list', { name: 'Browse' })
    await userEvent.keyboard('{ArrowDown}')
    expect(within(places).getByRole('link', { name: 'Continue watching' })).toHaveFocus()
    await userEvent.keyboard('{ArrowUp}')
    expect(within(places).getByRole('link', { name: 'Favourites' })).toHaveFocus()
    await userEvent.keyboard('{Escape}')
    expect(browse).toHaveFocus()
    expect(browse).toHaveAttribute('aria-expanded', 'false')
    fireEvent.animationEnd(places.previousElementSibling!)
    expect(screen.queryByRole('list', { name: 'Browse' })).toBeNull()
  })

  it('starts with Manage folded away', async () => {
    useSideMenu.setState(useSideMenu.getInitialState(), true)
    spies.list.mockImplementation(async () => [library({ id: 3, name: 'Movies' })])
    renderShell({ route: '/' })
    await within(nav()).findByRole('link', { name: 'Movies' })
    expect(within(nav()).getByRole('button', { name: 'Manage' })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
    expect(within(nav()).queryByRole('link', { name: 'Settings' })).toBeNull()
  })

  it('folds Libraries to Settings away under Manage, open or down to its icons, and keeps it so', async () => {
    spies.list.mockImplementation(async () => [library({ id: 3, name: 'Movies' })])
    renderShell({ route: '/' })
    await within(nav()).findByRole('link', { name: 'Movies' })
    const manage = within(nav()).getByRole('button', { name: 'Manage' })
    expect(manage).toHaveAttribute('aria-expanded', 'true')
    expect(within(nav()).getByRole('link', { name: 'Settings' })).toBeVisible()

    await userEvent.click(manage)
    expect(manage).toHaveAttribute('aria-expanded', 'false')
    expect(within(nav()).queryByRole('link', { name: 'Libraries' })).toBeNull()
    expect(within(nav()).queryByRole('link', { name: 'Settings' })).toBeNull()
    expect(within(nav()).getByRole('link', { name: 'Movies' })).toBeInTheDocument()
    expect(useSideMenu.getState().isManageOpen).toBe(false)

    await userEvent.click(toggle())
    const folded = within(nav()).getByRole('button', { name: 'Manage' })
    expect(folded).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(folded)
    expect(within(nav()).getByRole('link', { name: 'Settings' })).toBeInTheDocument()
    expect(useSideMenu.getState().isManageOpen).toBe(true)
    await userEvent.click(toggle())
  })

  it("shows raven's version beside the toggle while the menu is open", async () => {
    spies.list.mockImplementation(async () => [])
    renderShell({ route: '/' })
    expect(within(nav()).getByText(`v${ravenVersion}`)).toBeInTheDocument()

    await userEvent.click(toggle())
    expect(within(nav()).queryByText(`v${ravenVersion}`)).toBeNull()
  })

  it("frosts over once a card's picture is behind the page, and clears after", () => {
    spies.list.mockImplementation(async () => [])
    const { container } = renderShell({ route: '/' })
    expect(nav()).not.toHaveClass('frosted')

    // Asked for but still loading, nothing is behind the page yet.
    act(() => usePageBackdrop.getState().show('/api/items/1/backdrop'))
    expect(nav()).not.toHaveClass('frosted')

    fireEvent.load(container.querySelector('img[src="/api/items/1/backdrop"]') ?? document.body)
    expect(nav()).toHaveClass('frosted')

    act(() => usePageBackdrop.getState().hide('/api/items/1/backdrop'))
    expect(nav()).not.toHaveClass('frosted')
  })

  it('collapses and expands with B, but not while typing or with a modifier held', async () => {
    spies.list.mockImplementation(async () => [])
    renderShell({ route: '/search' })
    await userEvent.keyboard('b')
    expect(toggle()).toHaveAttribute('aria-expanded', 'false')
    await userEvent.keyboard('B')
    expect(toggle()).toHaveAttribute('aria-expanded', 'true')

    await userEvent.keyboard('{Control>}b{/Control}')
    expect(toggle()).toHaveAttribute('aria-expanded', 'true')
    await userEvent.type(screen.getByRole('textbox', { name: 'Search' }), 'bb')
    expect(toggle()).toHaveAttribute('aria-expanded', 'true')
  })

  it('tells of the B key on a first visit until the tip is put away', async () => {
    spies.list.mockImplementation(async () => [])
    const first = renderShell({ route: '/' })
    const tip = screen.getByRole('complementary', { name: 'Tip' })
    expect(tip).toHaveTextContent('Press B to collapse or expand the side menu.')
    await userEvent.click(within(tip).getByRole('button', { name: 'Got it' }))
    expect(screen.queryByRole('complementary', { name: 'Tip' })).toBeNull()

    first.unmount()
    renderShell({ route: '/' })
    expect(screen.queryByRole('complementary', { name: 'Tip' })).toBeNull()
  })

  it('puts the tip away once the shortcut has been used', async () => {
    spies.list.mockImplementation(async () => [])
    renderShell({ route: '/' })
    await userEvent.keyboard('b')
    expect(screen.queryByRole('complementary', { name: 'Tip' })).toBeNull()
  })

  it('reads the libraries again when the server says one changed or comes back, and hangs up on leaving', async () => {
    spies.list.mockImplementation(async () => [library({ id: 3, name: 'Movies' })])
    const shell = renderShell({ route: '/' })
    await within(nav()).findByRole('link', { name: 'Movies' })
    expect(spies.list).toHaveBeenCalledTimes(1)
    const [stream] = FakeEventSource.opened
    expect(stream?.url).toBe('/api/events')

    spies.list.mockImplementation(async () => [library({ id: 3, name: 'Films' })])
    stream?.send({ type: 'library', libraryId: 3 })
    await within(nav()).findByRole('link', { name: 'Films' })

    spies.list.mockImplementation(async () => [library({ id: 3, name: 'Features' })])
    stream?.reconnect()
    await within(nav()).findByRole('link', { name: 'Features' })

    shell.unmount()
    expect(stream?.closed).toBe(true)
  })

  it('heads the pinned libraries while open, leaving a rule in their place once collapsed', async () => {
    spies.list.mockImplementation(async () => [library({ id: 3, name: 'Movies' })])
    renderShell({ route: '/' })
    await within(nav()).findByRole('link', { name: 'Movies' })
    expect(within(nav()).getByText('Pinned')).toBeInTheDocument()
    expect(within(logo()).getByText('Raven')).not.toHaveClass('visually-hidden')

    await userEvent.click(toggle())
    expect(within(nav()).queryByText('Pinned')).toBeNull()
    expect(within(nav()).getByRole('list', { name: 'Pinned' })).toBeInTheDocument()
    expect(within(logo()).getByText('Raven')).toHaveClass('visually-hidden')
  })

  describe("with the account's second server", () => {
    const withMeleys = () => {
      spies.servers.mockImplementation(async () => [meleysRow()])
      spies.list.mockImplementation(async () => [
        library({ id: 3, name: 'Movies' }),
        library({ id: 4, name: 'Shows' }),
      ])
      spies.meleys.mockImplementation(async () => [
        library({ id: 3, name: 'Movies' }),
        library({ id: 8, name: 'Concerts' }),
      ])
      spies.pins.mockImplementation(async () => [
        pin({ libraryId: 3 }),
        pin({ serverId: MELEYS_ID, libraryId: 8 }),
        pin({ serverId: MELEYS_ID, libraryId: 3 }),
        // Deleted on Meleys since it was pinned: it is left out.
        pin({ serverId: MELEYS_ID, libraryId: 99 }),
      ])
    }

    afterEach(() => {
      spies.servers.mockImplementation(async () => [])
      spies.meleys.mockReset()
      spies.pins.mockImplementation(pinEveryListed)
    })

    it("lists the pins on every server, each server's in its order, with its server's name", async () => {
      withMeleys()
      renderShell({ route: APP_PATHS.home })
      await within(nav()).findByRole('link', { name: /Concerts/ })
      const pinned = within(nav()).getByRole('list', { name: 'Pinned' })
      const host = window.location.host
      expect(
        within(pinned)
          .getAllByRole('link')
          .map((link) => link.textContent),
      ).toEqual([`Movieson ${host}`, 'Movieson Meleys', 'Concertson Meleys'])
    })

    it('switches to a pin on another server as it opens it', async () => {
      withMeleys()
      renderShell({ route: APP_PATHS.home })
      await userEvent.click(await within(nav()).findByRole('link', { name: 'Concerts on Meleys' }))
      expect(useActiveServer.getState().active).toEqual({
        serverId: MELEYS_ID,
        origin: MELEYS_ORIGIN,
      })
      expect(screen.getByText('library')).toBeInTheDocument()
    })

    it('marks the server in use in the switcher, and switches home from another', async () => {
      withMeleys()
      useActiveServer.getState().choose({ serverId: MELEYS_ID, origin: MELEYS_ORIGIN })
      renderShell({ route: APP_PATHS.libraries })
      await userEvent.click(await within(nav()).findByRole('button', { name: 'Server: Meleys' }))
      const menu = screen.getByRole('menu', { name: 'Servers' })
      expect(within(menu).getByRole('menuitemradio', { name: 'Meleys' })).toHaveAttribute(
        'aria-checked',
        'true',
      )
      await userEvent.click(within(menu).getByRole('menuitemradio', { name: window.location.host }))
      expect(useActiveServer.getState().active).toBeNull()
      expect(screen.getByText('home')).toBeInTheDocument()
    })

    it("inside Raven, reads another server's pins through main and offers the switch", async () => {
      withMeleys()
      const concerts = [library({ id: 8, name: 'Concerts' })]
      const client = fakeClient({
        request: async (request) =>
          request.type === DESKTOP_REQUESTS.serverLibraries
            ? { type: DESKTOP_REPLIES.libraries, libraries: concerts }
            : { type: DESKTOP_REPLIES.done },
      })
      asDesktop(client)
      renderShell({ route: APP_PATHS.home })
      expect(
        await within(nav()).findByRole('link', { name: 'Concerts on Meleys' }),
      ).toBeInTheDocument()
      expect(within(nav()).getByRole('button', { name: 'Server: raven' })).toBeInTheDocument()
      expect(spies.meleys).not.toHaveBeenCalled()
      expect(client.request).toHaveBeenCalledWith({
        type: DESKTOP_REQUESTS.serverLibraries,
        serverId: MELEYS_ID,
      })
    })

    it('names no server under a pin, and offers no switch, with one server', async () => {
      spies.list.mockImplementation(async () => [library({ id: 3, name: 'Movies' })])
      renderShell({ route: APP_PATHS.home })
      expect(await within(nav()).findByRole('link', { name: 'Movies' })).toBeInTheDocument()
      expect(within(nav()).queryByRole('button', { name: /^Server:/ })).toBeNull()
    })
  })

  it('has no Pinned heading with nothing pinned', () => {
    spies.list.mockImplementation(async () => [])
    renderShell({ route: '/' })
    expect(within(nav()).queryByText('Pinned')).toBeNull()
  })

  it('keeps to its icons on a medium screen, where the toggle and B step aside', async () => {
    spies.media.mockImplementation(screenOf(SCREEN_SIZES.medium))
    spies.list.mockImplementation(async () => [
      library({ id: 1, name: 'Tutorials', settings: { ...library().settings, locked: true } }),
    ])
    renderShell({ route: '/' })
    await within(nav()).findByRole('link', { name: 'Tutorials (locked)' })
    await userEvent.hover(within(nav()).getByRole('link', { name: 'Tutorials (locked)' }))
    expect(
      screen.getByText('Tutorials (locked)', { selector: '[aria-hidden]' }),
    ).toBeInTheDocument()
    expect(within(logo()).getByText('Raven')).toHaveClass('visually-hidden')
    expect(within(nav()).queryByText('Pinned')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Side menu' })).toBeNull()
    expect(screen.queryByRole('complementary', { name: 'Tip' })).toBeNull()
    expect(within(nav()).queryByText(`v${ravenVersion}`)).toBeNull()

    await userEvent.keyboard('b')
    expect(useSideMenu.getState().collapsed).toBe(false)
  })

  it('gives a phone Home, Libraries, Favourites, Binge and More in a tab bar', () => {
    spies.list.mockImplementation(async () => [])
    renderShell({ route: '/favourites' })
    const links = within(tabs()).getAllByRole('link')
    expect(links.map((link) => [link.textContent, link.getAttribute('href')])).toEqual([
      ['Home', '/'],
      ['Libraries', '/libraries'],
      ['Favourites', '/favourites'],
      ['Binge', '/binge'],
    ])
    expect(links.map(iconOf)).toEqual(['home', 'libraries', 'heart', 'popcorn'])
    expect(within(tabs()).getByRole('button', { name: 'More' })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
    expect(within(tabs()).getByRole('link', { name: 'Favourites' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(within(tabs()).getByRole('link', { name: 'Home' })).not.toHaveAttribute('aria-current')
  })

  it('marks Libraries in the tab bar on any library, a pinned one too', async () => {
    spies.list.mockImplementation(async () => [library({ id: 3, name: 'Movies' })])
    renderShell({ route: '/libraries/3' })
    await within(nav()).findByRole('link', { name: 'Movies' })
    expect(within(tabs()).getByRole('link', { name: 'Libraries' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(within(nav()).getByRole('link', { name: 'Libraries' })).not.toHaveAttribute(
      'aria-current',
    )
  })

  it('puts the search through every library over every page', () => {
    spies.list.mockImplementation(async () => [])
    renderShell({ route: '/libraries' })
    expect(
      within(screen.getByRole('main')).getByRole('combobox', { name: 'Search every library' }),
    ).toHaveAttribute('placeholder', 'Search every library')
  })

  it('puts the theme button in the corner of every page', async () => {
    spies.list.mockImplementation(async () => [])
    renderShell({ route: '/libraries' })
    const theme = within(screen.getByRole('main')).getByRole('button', { name: 'Theme' })
    await userEvent.click(theme)
    expect(screen.getByRole('menu', { name: 'Theme' })).toBeInTheDocument()
  })

  it('has no account button while accounts are off', () => {
    spies.list.mockImplementation(async () => [])
    renderShell({ route: APP_PATHS.libraries, account: null })
    expect(screen.queryByRole('button', { name: 'Account' })).toBeNull()
  })

  it('puts the account button, with Sign out, after the theme button for whoever is signed in', async () => {
    spies.list.mockImplementation(async () => [])
    renderShell({ route: '/libraries', account: fakeAccount() })
    const main = within(screen.getByRole('main'))
    const [theme, account] = main.getAllByRole('button')
    expect(theme).toHaveAccessibleName('Theme')
    expect(account).toHaveAccessibleName('Account')
    await userEvent.click(main.getByRole('button', { name: 'Account' }))
    expect(screen.getByRole('menuitem', { name: 'Sign out' })).toBeInTheDocument()
  })

  it('adds Downloads over Settings inside Raven, the downloads under way counted', async () => {
    spies.list.mockImplementation(async () => [])
    asDesktop(downloadsMain({ downloads: [viewOf(), viewOf({ downloadId: DL_2 })] }))
    renderShell({ route: '/' })
    const downloads = await within(nav()).findByRole('link', { name: 'Downloads (2 in progress)' })
    expect(downloads).toHaveAttribute('href', DESKTOP_PATHS.downloads)
    expect(within(downloads).getByText('2')).toHaveAttribute('aria-hidden', 'true')
    expect(
      within(nav())
        .getAllByRole('link')
        .map((link) => link.getAttribute('href')),
    ).toEqual([
      '/',
      '/',
      '/libraries',
      '/admin',
      '/streams',
      '/reports',
      '/history/everyone',
      '/history',
      '/notifications',
      DESKTOP_PATHS.downloads,
      PAGE_PATHS.settings,
      PAGE_PATHS.shortcuts,
      APP_PATHS.design,
    ])
    await userEvent.click(within(tabs()).getByRole('button', { name: 'More' }))
    expect(
      within(screen.getByRole('dialog', { name: 'More' }))
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual([
      'Search',
      'Coming soon',
      'Play history',
      'Notifications',
      'Downloads',
      'Settings',
      'Admin',
      'Streams',
      'Reports',
    ])
  })

  it('has no badge with nothing under way, and no Downloads in a browser', async () => {
    spies.list.mockImplementation(async () => [])
    asDesktop(
      downloadsMain({ downloads: [viewOf({ status: { kind: DOWNLOAD_STATUS_KINDS.ready } })] }),
    )
    renderShell({ route: '/' })
    expect(await within(nav()).findByRole('link', { name: 'Downloads' })).toBeInTheDocument()
    cleanup()
    useDesktopBridge.setState({ desktop: null })
    useDownloadsHostStore.setState({ host: null })
    renderShell({ route: '/' })
    expect(within(nav()).queryByRole('link', { name: 'Downloads' })).toBeNull()
  })

  it('offers Downloads in a browser that keeps downloads', async () => {
    spies.list.mockImplementation(async () => [])
    const { engine } = await fakeEngine()
    asBrowserDownloads(engine)
    renderShell({ route: '/' })
    expect(await within(nav()).findByRole('link', { name: 'Downloads' })).toHaveAttribute(
      'href',
      DESKTOP_PATHS.downloads,
    )
    await userEvent.click(within(tabs()).getByRole('button', { name: 'More' }))
    const sheet = within(screen.getByRole('dialog', { name: 'More' }))
    expect(sheet.getByRole('link', { name: 'Downloads' })).toBeInTheDocument()
  })

  it('keeps only Downloads and what needs no server in a browser that cannot reach it', async () => {
    const { engine } = await fakeEngine()
    asBrowserDownloads(engine)
    useServerReach.setState({ isOffline: true })
    renderShell({ route: '/libraries' })
    expect(
      within(tabs())
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['Downloads', 'Settings'])
    expect(within(nav()).getByRole('link', { name: 'Downloads' })).toBeInTheDocument()
    expect(within(nav()).queryByRole('link', { name: 'Home' })).toBeNull()
  })

  it('keeps only what needs no server while Raven cannot reach it', () => {
    asDesktop(downloadsMain())
    useServerReach.setState({ isOffline: true })
    renderShell({ route: '/libraries' })
    expect(
      within(nav())
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['Raven', 'Downloads', 'Settings', 'Shortcuts', 'Design'])
    expect(
      within(tabs())
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['Downloads', 'Settings'])
    expect(screen.queryByRole('combobox')).toBeNull()
    expect(
      within(screen.getByRole('main')).getByRole('button', { name: 'Theme' }),
    ).toBeInTheDocument()
    expect(spies.list).not.toHaveBeenCalled()
    expect(FakeEventSource.opened).toEqual([])
  })
})
