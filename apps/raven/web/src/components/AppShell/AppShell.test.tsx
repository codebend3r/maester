import { afterEach, describe, expect, it, spyOn } from 'bun:test'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { AppShell } from '@/components/AppShell/AppShell'
import { api } from '@/lib/api'
import { useSideMenu } from '@/stores/sideMenu'
import { FakeEventSource } from '@/test/eventSource'
import { library } from '@/test/fixtures'
import { renderWithProviders } from '@/test/render'

const renderShell = (route: string) =>
  renderWithProviders(
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<p>home</p>} />
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
    </Routes>,
    { route },
  )

const nav = () => screen.getByRole('navigation', { name: 'Main' })
const toggle = () => screen.getByRole('button', { name: 'Side menu' })
const iconOf = (element: HTMLElement) => element.querySelector('svg')?.dataset.icon

describe('AppShell', () => {
  const spies = { list: spyOn(api, 'listLibraries') }

  afterEach(() => {
    spies.list.mockReset()
  })

  it('links to the libraries and the favourites, marking the current page', () => {
    spies.list.mockImplementation(async () => [])
    renderShell('/favourites')
    expect(within(nav()).getByRole('link', { name: 'Libraries' })).toHaveAttribute('href', '/')
    const favourites = within(nav()).getByRole('link', { name: 'Favourites' })
    expect(favourites).toHaveAttribute('href', '/favourites')
    expect(favourites).toHaveAttribute('aria-current', 'page')
    expect(within(nav()).getByRole('link', { name: 'Libraries' })).not.toHaveAttribute(
      'aria-current',
    )
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
    spies.list.mockImplementation(async () => [
      library({ id: 1, name: 'Films', settings: { ...library().settings, kind: 'movies' } }),
      library({ id: 2, name: 'Series', settings: { ...library().settings, kind: 'shows' } }),
      library({ id: 3, name: 'Clips', settings: { ...library().settings, kind: 'other' } }),
    ])
    renderShell('/')
    const pinned = await within(nav()).findByRole('list', { name: 'Pinned' })
    expect(within(pinned).getAllByRole('link').map(iconOf)).toEqual(['film', 'tv', 'video'])
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

  it('reads the libraries again when the server says one changed, and hangs up on leaving', async () => {
    spies.list.mockImplementation(async () => [library({ id: 3, name: 'Movies' })])
    const shell = renderShell('/')
    await within(nav()).findByRole('link', { name: 'Movies' })
    expect(spies.list).toHaveBeenCalledTimes(1)
    const [stream] = FakeEventSource.opened
    expect(stream?.url).toBe('/api/events')

    spies.list.mockImplementation(async () => [library({ id: 3, name: 'Films' })])
    stream?.send({ type: 'library', libraryId: 3 })
    await within(nav()).findByRole('link', { name: 'Films' })

    shell.unmount()
    expect(stream?.closed).toBe(true)
  })
})
