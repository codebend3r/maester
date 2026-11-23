import { afterEach, describe, expect, it, spyOn } from 'bun:test'
import { act, cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { HomeSearch, Rating } from '@raven/core'
import { Link, Route, Routes, useLocation } from 'react-router-dom'
import { SEARCH_ASK, SiteSearch } from '@/components/SiteSearch/SiteSearch'
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
          <Route path="coming-soon" element={<p>coming soon</p>} />
          <Route path="coming-soon/:type/:tmdbId" element={<p>upcoming title</p>} />
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
    upcoming: spyOn(api, 'searchUpcoming'),
  }

  const serve = (found: HomeSearch = FOUND) => {
    spies.search.mockImplementation(async () => found)
    spies.libraries.mockImplementation(async () => LIBRARIES)
  }

  afterEach(() => {
    cleanup()
    spies.search.mockReset()
    spies.libraries.mockReset()
    spies.upcoming.mockReset()
  })

  it('searches only what is coming soon on Coming soon, and Enter opens the first title', async () => {
    spies.upcoming.mockImplementation(async () => ({
      titles: [
        {
          type: 'movie',
          tmdbId: '558449',
          title: 'Gladiator III',
          released: '2027-11-19',
          poster: '/g3.jpg',
        },
      ],
    }))
    open('/coming-soon')
    const box = screen.getByRole('combobox', { name: 'Search all upcoming' })
    expect(box).toHaveAttribute('placeholder', 'Search all upcoming')
    await userEvent.type(box, 'gladiator')
    const list = await screen.findByRole('listbox', { name: 'Suggestions' })
    expect(await within(list).findByText('Gladiator III')).toBeInTheDocument()
    expect(within(list).queryByText(/See all results/)).toBeNull()
    expect(spies.search).not.toHaveBeenCalled()
    expect(spies.upcoming).toHaveBeenLastCalledWith('gladiator')
    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(address()).toHaveTextContent('/coming-soon/movie/558449'))
  })

  it('takes the cursor when a way in asks for the search, as the phone More sheet does', () => {
    renderWithProviders({ ui: <SiteSearch />, route: '/', state: SEARCH_ASK })
    expect(searchbox()).toHaveFocus()
    cleanup()
    renderWithProviders({ ui: <SiteSearch />, route: '/' })
    expect(searchbox()).not.toHaveFocus()
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
        'BusboysMar 31, 1999·Films1080p HEVCTMDB: 8.2 out of 108.2/10TMDB',
        'Slow Horses2022·SeriesTMDB: 8.2 out of 108.2/10TMDB',
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

    it("ends a title's row with its file's chips and two scores, its library's source first", async () => {
      const ratings: Rating[] = [
        { source: 'rottenTomatoes', kind: 'critic', value: 5.9, votes: null },
        { source: 'imdb', kind: 'audience', value: 7.7, votes: 900 },
        { source: 'metacritic', kind: 'critic', value: 4.8, votes: null },
        { source: 'tmdb', kind: 'audience', value: 6.9, votes: 1200 },
      ]
      spies.search.mockImplementation(async () => [
        {
          libraryId: 2,
          type: 'media',
          media: [
            matchedMovie({ width: 3840, height: 2160, hdr: true, item: itemSummary({ ratings }) }),
          ],
        },
      ])
      spies.libraries.mockImplementation(async () => [
        library({
          id: 2,
          name: 'Films',
          settings: { ...library().settings, ratingsSource: 'metacritic' },
        }),
      ])
      open('/movies/1')
      await userEvent.type(searchbox(), 'bus')
      const row = await screen.findByRole('option', { name: /Busboys/ })
      expect(within(row).getByText('4K')).toBeInTheDocument()
      expect(within(row).getByText('HDR')).toBeInTheDocument()
      expect(within(row).getByText(/^Metacritic: 48/)).toBeInTheDocument()
      expect(within(row).getByText(/^Rotten Tomatoes: 59/)).toBeInTheDocument()
      expect(within(row).queryByText(/^IMDb: /)).toBeNull()
      expect(within(row).queryByText(/^TMDB: /)).toBeNull()
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
