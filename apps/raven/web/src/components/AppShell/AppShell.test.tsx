import { afterEach, describe, expect, it, spyOn } from 'bun:test'
import { screen, within } from '@testing-library/react'
import { Route, Routes } from 'react-router-dom'
import { AppShell } from '@/components/AppShell/AppShell'
import { api } from '@/lib/api'
import { library } from '@/test/fixtures'
import { renderWithProviders } from '@/test/render'

const renderShell = (route: string) =>
  renderWithProviders(
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<p>home</p>} />
        <Route path="favourites" element={<p>favourites</p>} />
        <Route path="libraries/:id" element={<p>library</p>} />
      </Route>
    </Routes>,
    { route },
  )

const nav = () => screen.getByRole('navigation', { name: 'Main' })

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
})
