import { afterEach, describe, expect, it, spyOn } from 'bun:test'
import { act, cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { HomeSearch } from '@raven/core'
import { Link, Route, Routes, useLocation } from 'react-router-dom'
import { SiteSearch } from '@/components/SiteSearch/SiteSearch'
import { api } from '@/lib/api'
import { itemSummary, library, matchedMovie, showEntry } from '@/test/fixtures'
import { renderWithProviders } from '@/test/render'

const AddressProbe = () => {
  const { pathname, search } = useLocation()
  return <output aria-label="Current address">{`${pathname}${search}`}</output>
}

const LIBRARIES = [
  library({ id: 2, name: 'Films', settings: { ...library().settings, kind: 'movies' } }),
  library({ id: 3, name: 'Series', settings: { ...library().settings, kind: 'shows' } }),
]

const FOUND: HomeSearch = [
  { libraryId: 2, type: 'media', media: [matchedMovie()] },
  {
    libraryId: 3,
    type: 'shows',
    shows: [
      showEntry({
        show: itemSummary({ id: 9, type: 'show', title: 'Slow Horses', year: 2022 }),
      }),
    ],
  },
]

const open = (route: string) =>
  renderWithProviders({
    ui: (
      <>
        <AddressProbe />
        <SiteSearch />
        <Routes>
          <Route index element={<p>home</p>} />
          <Route path="movies/:id" element={<Link to="/movies/2">Another movie</Link>} />
          <Route path="shows/:id" element={<p>show</p>} />
        </Routes>
      </>
    ),
    route,
  })

const searchbox = () => screen.getByRole('combobox', { name: 'Search every library' })
const address = () => screen.getByLabelText('Current address')
const suggestions = () => screen.queryByRole('listbox', { name: 'Suggestions' })

describe('SiteSearch', () => {
  const spies = {
    search: spyOn(api, 'searchHome'),
    libraries: spyOn(api, 'listLibraries'),
  }

  const serve = (found: HomeSearch = FOUND) => {
    spies.search.mockImplementation(async () => found)
    spies.libraries.mockImplementation(async () => LIBRARIES)
  }

  afterEach(() => {
    cleanup()
    spies.search.mockReset()
    spies.libraries.mockReset()
  })

  it('starts empty away from home, whatever the page asks for', () => {
    open('/movies/1?q=bus')
    expect(searchbox()).toHaveValue('')
  })

  it('opens home on Enter from any other page, keeping what is typed, and not before', async () => {
    serve()
    open('/movies/1')
    await userEvent.type(searchbox(), 'bus')
    await waitFor(() => expect(spies.search).toHaveBeenCalled())
    expect(address()).toHaveTextContent(/^\/movies\/1$/)
    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(address()).toHaveTextContent(/^\/\?q=bus$/))
    expect(screen.getByText('home')).toBeInTheDocument()
    expect(searchbox()).toHaveValue('bus')
  })

  it('leaves a page alone until something is typed', async () => {
    open('/movies/1')
    await act(async () => {
      await userEvent.click(screen.getByRole('link', { name: 'Another movie' }))
    })
    expect(address()).toHaveTextContent(/^\/movies\/2$/)
  })

  it('empties once a page other than home opens', async () => {
    renderWithProviders({
      ui: (
        <>
          <AddressProbe />
          <SiteSearch />
          <Routes>
            <Route index element={<Link to="/movies/1">Busboys</Link>} />
            <Route path="movies/:id" element={<p>movie</p>} />
          </Routes>
        </>
      ),
      route: '/?q=bus',
    })
    expect(searchbox()).toHaveValue('bus')
    await act(async () => {
      await userEvent.click(screen.getByRole('link', { name: 'Busboys' }))
    })
    await waitFor(() => expect(searchbox()).toHaveValue(''))
    expect(address()).toHaveTextContent(/^\/movies\/1$/)
  })

  describe('its suggestions', () => {
    it('waits for three letters, spaces aside, then asks once typing pauses, never per keystroke', async () => {
      serve()
      open('/movies/1')
      await userEvent.type(searchbox(), 'b u')
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 400))
      })
      expect(spies.search).not.toHaveBeenCalled()
      expect(suggestions()).toBeNull()
      await userEvent.type(searchbox(), 's')
      const list = await screen.findByRole('listbox', { name: 'Suggestions' })
      expect(spies.search.mock.calls).toEqual([['b us']])
      expect(
        within(list)
          .getAllByRole('option')
          .map((option) => option.textContent),
      ).toEqual([
        'BusboysMar 31, 1999·Films',
        'Slow Horses2022·Series',
        'See all results for “b us”',
      ])
      expect(searchbox()).toHaveAttribute('aria-expanded', 'true')
    })

    it('opens the picked title with the arrows and Enter, the last row opening every result', async () => {
      serve()
      open('/movies/1')
      await userEvent.type(searchbox(), 'bus')
      await screen.findByRole('listbox', { name: 'Suggestions' })
      await userEvent.keyboard('{ArrowDown}{ArrowDown}')
      expect(screen.getByRole('option', { name: /Slow Horses/ })).toHaveAttribute(
        'aria-selected',
        'true',
      )
      await userEvent.keyboard('{Enter}')
      await waitFor(() => expect(address()).toHaveTextContent(/^\/shows\/9$/))
      expect(suggestions()).toBeNull()

      await userEvent.clear(searchbox())
      await userEvent.type(searchbox(), 'bus')
      await screen.findByRole('listbox', { name: 'Suggestions' })
      await userEvent.keyboard('{ArrowUp}{Enter}')
      await waitFor(() => expect(address()).toHaveTextContent(/^\/\?q=bus$/))
    })

    it('opens a title on a click', async () => {
      serve()
      open('/movies/1')
      await userEvent.type(searchbox(), 'bus')
      await userEvent.click(await screen.findByRole('option', { name: /Busboys/ }))
      await waitFor(() => expect(address()).toHaveTextContent(/^\/movies\/40\?library=2$/))
    })

    it('hides on Escape and comes back once the text changes', async () => {
      serve()
      open('/movies/1')
      await userEvent.type(searchbox(), 'bus')
      await screen.findByRole('listbox', { name: 'Suggestions' })
      await userEvent.keyboard('{Escape}')
      expect(suggestions()).toBeNull()
      expect(searchbox()).toHaveAttribute('aria-expanded', 'false')
      await userEvent.type(searchbox(), 'b')
      expect(await screen.findByRole('listbox', { name: 'Suggestions' })).toBeInTheDocument()
    })

    it('says when nothing matches so far', async () => {
      serve([])
      open('/movies/1')
      await userEvent.type(searchbox(), 'zzz')
      const list = await screen.findByRole('listbox', { name: 'Suggestions' })
      await waitFor(() =>
        expect(within(list).getByText('Nothing matches so far')).toBeInTheDocument(),
      )
      expect(within(list).getAllByRole('option')).toHaveLength(1)
    })
  })
})
