import { afterAll, afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test'
import { type AdminLock, isLibraryKind } from '@raven/core'
import { act, cleanup, fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { AppShell } from '@/components/AppShell/AppShell'
import { api } from '@/lib/api'
import { KINDS } from '@/lib/libraryKinds'
import { ravenVersion } from '@/lib/version'
import { usePageBackdrop } from '@/stores/pageBackdrop'
import { useSideMenu } from '@/stores/sideMenu'
import { FakeEventSource } from '@/test/eventSource'
import { library } from '@/test/fixtures'
import { renderWithProviders } from '@/test/render'
import { MEDIUM_SCREEN } from '@/components/AppShell/useIsMediumScreen'

const renderShell = (route: string, adminLock?: AdminLock) =>
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
  })

const nav = () => screen.getByRole('navigation', { name: 'Main' })
const tabs = () => screen.getByRole('navigation', { name: 'Tabs' })
const logo = () => screen.getByRole('link', { name: 'raven' })
const toggle = () => screen.getByRole('button', { name: 'Side menu' })
const iconOf = (element: HTMLElement) => element.querySelector('svg')?.dataset.icon
const iconsOf = (element: HTMLElement) =>
  [...element.querySelectorAll('svg')].map((svg) => svg.dataset.icon)

const SCREEN_SIZES = { wide: 'wide', medium: 'medium' } as const

// `all` matches any screen and `not all` none, so only a medium screen
// matches the side menu's query for one.
const real = window.matchMedia.bind(window)
const screenOf =
  (size: (typeof SCREEN_SIZES)[keyof typeof SCREEN_SIZES]) =>
  (query: string): MediaQueryList =>
    real(size === SCREEN_SIZES.medium && query === MEDIUM_SCREEN ? 'all' : 'not all')

describe('AppShell', () => {
  const spies = { list: spyOn(api, 'listLibraries'), media: spyOn(window, 'matchMedia') }

  beforeEach(() => {
    spies.media.mockImplementation(screenOf(SCREEN_SIZES.wide))
  })

  afterEach(() => {
    cleanup()
    spies.list.mockReset()
  })

  afterAll(() => {
    spies.media.mockRestore()
  })

  it('links home from the logo, named by its word alone', () => {
    spies.list.mockImplementation(async () => [])
    renderShell('/favourites')
    const home = screen.getByRole('link', { name: 'raven' })
    expect(home).toHaveAttribute('href', '/')
    expect(home.querySelector('img')).toHaveAttribute('src', '/brand/raven-mark-on-dark.svg')
  })

  it('leads with the logo, then Home, a house, marked on the page it opens on', () => {
    spies.list.mockImplementation(async () => [])
    renderShell('/')
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
    renderShell('/libraries')
    expect(within(nav()).getByRole('link', { name: 'Libraries' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(within(nav()).getByRole('link', { name: 'Home' })).not.toHaveAttribute('aria-current')
  })

  it('links to the libraries and the favourites, marking the current page', () => {
    spies.list.mockImplementation(async () => [])
    renderShell('/favourites')
    expect(within(nav()).getByRole('link', { name: 'Libraries' })).toHaveAttribute(
      'href',
      '/libraries',
    )
    const favourites = within(nav()).getByRole('link', { name: 'Favourites' })
    expect(favourites).toHaveAttribute('href', '/favourites')
    expect(favourites).toHaveAttribute('aria-current', 'page')
    expect(within(nav()).getByRole('link', { name: 'Libraries' })).not.toHaveAttribute(
      'aria-current',
    )
  })

  it('leads with the logo, Home and Favourites, then the pinned libraries, with Libraries, Streams and Settings last', async () => {
    spies.list.mockImplementation(async () => [library({ id: 3, name: 'Movies' })])
    renderShell('/')
    await within(nav()).findByRole('link', { name: 'Movies' })
    expect(
      within(nav())
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['raven', 'Home', 'Favourites', 'Movies', 'Libraries', 'Streams', 'Settings'])
  })

  it('leaves Streams out of the menus and the tab bar while the admin lock is on', async () => {
    spies.list.mockImplementation(async () => [])
    renderShell('/', { state: 'on', available: true })
    expect(await within(nav()).findByRole('link', { name: 'Settings' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Streams' })).toBeNull()
  })

  it('opens a page a link leads to at its top', async () => {
    spies.list.mockImplementation(async () => [])
    const scroll = spyOn(window, 'scrollTo').mockImplementation(() => undefined)
    renderShell('/')
    expect(scroll).not.toHaveBeenCalled()
    await userEvent.click(within(nav()).getByRole('link', { name: 'Favourites' }))
    expect(scroll).toHaveBeenCalledWith({ top: 0 })
    scroll.mockRestore()
  })

  it('lists the pinned libraries and leaves the rest out', async () => {
    spies.list.mockImplementation(async () => [
      library({ id: 1, name: 'Anime' }),
      library({ id: 2, name: 'Clips', settings: { ...library().settings, pinned: false } }),
      library({ id: 3, name: 'Movies' }),
    ])
    renderShell('/')
    const pinned = await within(nav()).findByRole('list', { name: 'Pinned' })
    const links = within(pinned).getAllByRole('link')
    expect(links.map((link) => [link.textContent, link.getAttribute('href')])).toEqual([
      ['Anime', '/libraries/1'],
      ['Movies', '/libraries/3'],
    ])
  })

  it("marks a pinned library's own link, not Libraries, while it is open", async () => {
    spies.list.mockImplementation(async () => [library({ id: 3, name: 'Movies' })])
    renderShell('/libraries/3')
    const movies = await within(nav()).findByRole('link', { name: 'Movies' })
    expect(movies).toHaveAttribute('aria-current', 'page')
    expect(within(nav()).getByRole('link', { name: 'Libraries' })).not.toHaveAttribute(
      'aria-current',
    )
  })

  it('keeps Libraries marked while a library that is not pinned is open', async () => {
    spies.list.mockImplementation(async () => [
      library({ id: 3, name: 'Movies' }),
      library({ id: 4, name: 'Clips', settings: { ...library().settings, pinned: false } }),
    ])
    renderShell('/libraries/4')
    await within(nav()).findByRole('link', { name: 'Movies' })
    expect(within(nav()).getByRole('link', { name: 'Libraries' })).toHaveAttribute(
      'aria-current',
      'page',
    )
  })

  it("gives each pinned library its type's icon", async () => {
    spies.list.mockImplementation(async () =>
      isLibraryKind.values.map((kind, index) =>
        library({ id: index + 1, name: kind, settings: { ...library().settings, kind } }),
      ),
    )
    renderShell('/')
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
    renderShell('/')
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
    renderShell('/')
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
    renderShell('/')
    await within(nav()).findByRole('link', { name: 'Tutorials (locked)' })
    await userEvent.click(toggle())
    expect(within(nav()).getByRole('link', { name: 'Tutorials (locked)' })).toHaveAttribute(
      'title',
      'Tutorials (locked)',
    )
    expect(iconsOf(within(nav()).getByRole('link', { name: 'Clips' }))).toEqual(['video'])
    await userEvent.click(toggle())
  })

  it('collapses to its icons with the toggle, keeping every link named', async () => {
    spies.list.mockImplementation(async () => [library({ id: 3, name: 'Movies' })])
    renderShell('/')
    await within(nav()).findByRole('link', { name: 'Movies' })
    expect(toggle()).toHaveAttribute('aria-expanded', 'true')

    await userEvent.click(toggle())
    expect(toggle()).toHaveAttribute('aria-expanded', 'false')
    const favourites = within(nav()).getByRole('link', { name: 'Favourites' })
    expect(favourites).toHaveAttribute('title', 'Favourites')
    expect(within(nav()).getByRole('link', { name: 'Movies' })).toHaveAttribute('title', 'Movies')
    expect(useSideMenu.getState().collapsed).toBe(true)

    await userEvent.click(toggle())
    expect(toggle()).toHaveAttribute('aria-expanded', 'true')
    expect(within(nav()).getByRole('link', { name: 'Favourites' })).not.toHaveAttribute('title')
  })

  it("shows raven's version beside the toggle while the menu is open", async () => {
    spies.list.mockImplementation(async () => [])
    renderShell('/')
    expect(within(nav()).getByText(`v${ravenVersion}`)).toBeInTheDocument()

    await userEvent.click(toggle())
    expect(within(nav()).queryByText(`v${ravenVersion}`)).toBeNull()
  })

  it("frosts over once a card's picture is behind the page, and clears after", () => {
    spies.list.mockImplementation(async () => [])
    const { container } = renderShell('/')
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
    renderShell('/search')
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
    const first = renderShell('/')
    const tip = screen.getByRole('complementary', { name: 'Tip' })
    expect(tip).toHaveTextContent('Press B to collapse or expand the side menu.')
    await userEvent.click(within(tip).getByRole('button', { name: 'Got it' }))
    expect(screen.queryByRole('complementary', { name: 'Tip' })).toBeNull()

    first.unmount()
    renderShell('/')
    expect(screen.queryByRole('complementary', { name: 'Tip' })).toBeNull()
  })

  it('puts the tip away once the shortcut has been used', async () => {
    spies.list.mockImplementation(async () => [])
    renderShell('/')
    await userEvent.keyboard('b')
    expect(screen.queryByRole('complementary', { name: 'Tip' })).toBeNull()
  })

  it('reads the libraries again when the server says one changed or comes back, and hangs up on leaving', async () => {
    spies.list.mockImplementation(async () => [library({ id: 3, name: 'Movies' })])
    const shell = renderShell('/')
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
    renderShell('/')
    await within(nav()).findByRole('link', { name: 'Movies' })
    expect(within(nav()).getByText('Pinned')).toBeInTheDocument()
    expect(within(logo()).getByText('raven')).not.toHaveClass('visually-hidden')

    await userEvent.click(toggle())
    expect(within(nav()).queryByText('Pinned')).toBeNull()
    expect(within(nav()).getByRole('list', { name: 'Pinned' })).toBeInTheDocument()
    expect(within(logo()).getByText('raven')).toHaveClass('visually-hidden')
  })

  it('has no Pinned heading with nothing pinned', () => {
    spies.list.mockImplementation(async () => [])
    renderShell('/')
    expect(within(nav()).queryByText('Pinned')).toBeNull()
  })

  it('keeps to its icons on a medium screen, where the toggle and B step aside', async () => {
    spies.media.mockImplementation(screenOf(SCREEN_SIZES.medium))
    spies.list.mockImplementation(async () => [
      library({ id: 1, name: 'Tutorials', settings: { ...library().settings, locked: true } }),
    ])
    renderShell('/')
    await within(nav()).findByRole('link', { name: 'Tutorials (locked)' })
    expect(within(nav()).getByRole('link', { name: 'Home' })).toHaveAttribute('title', 'Home')
    expect(within(nav()).getByRole('link', { name: 'Tutorials (locked)' })).toHaveAttribute(
      'title',
      'Tutorials (locked)',
    )
    expect(within(logo()).getByText('raven')).toHaveClass('visually-hidden')
    expect(within(nav()).queryByText('Pinned')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Side menu' })).toBeNull()
    expect(screen.queryByRole('complementary', { name: 'Tip' })).toBeNull()
    expect(within(nav()).queryByText(`v${ravenVersion}`)).toBeNull()

    await userEvent.keyboard('b')
    expect(useSideMenu.getState().collapsed).toBe(false)
  })

  it('gives a phone Home, Libraries, Favourites, Streams and Settings in a tab bar', () => {
    spies.list.mockImplementation(async () => [])
    renderShell('/favourites')
    const links = within(tabs()).getAllByRole('link')
    expect(links.map((link) => [link.textContent, link.getAttribute('href')])).toEqual([
      ['Home', '/'],
      ['Libraries', '/libraries'],
      ['Favourites', '/favourites'],
      ['Streams', '/streams'],
      ['Settings', '/settings'],
    ])
    expect(links.map(iconOf)).toEqual(['home', 'libraries', 'heart', 'playback', 'settings'])
    expect(within(tabs()).getByRole('link', { name: 'Favourites' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(within(tabs()).getByRole('link', { name: 'Home' })).not.toHaveAttribute('aria-current')
  })

  it('marks Libraries in the tab bar on any library, a pinned one too', async () => {
    spies.list.mockImplementation(async () => [library({ id: 3, name: 'Movies' })])
    renderShell('/libraries/3')
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
    renderShell('/libraries')
    expect(
      within(screen.getByRole('main')).getByRole('searchbox', { name: 'Search every library' }),
    ).toHaveAttribute('placeholder', 'Search every library')
  })

  it('puts the theme button in the corner of every page', async () => {
    spies.list.mockImplementation(async () => [])
    renderShell('/libraries')
    const theme = within(screen.getByRole('main')).getByRole('button', { name: 'Theme' })
    await userEvent.click(theme)
    expect(screen.getByRole('menu', { name: 'Theme' })).toBeInTheDocument()
  })
})
