import { afterEach, describe, expect, it, spyOn } from 'bun:test'
import { act, cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { type Home, type HomeSearch, mediaLabel } from '@raven/core'
import { Link, useLocation } from 'react-router-dom'
import { api } from '@/lib/api'
import { POSTER_SIZES } from '@/lib/posters'
import { HomePage } from '@/pages/HomePage/HomePage'
import { library, matchedMovie, mediaItem, showEntry } from '@/test/fixtures'
import { held } from '@/test/held'
import { renderWithProviders } from '@/test/render'
import { EPISODE_TWO, SEASON_ONE_CARD } from '@/test/tv'

const LIBRARIES = [
  library({ id: 2, name: 'Films', settings: { ...library().settings, kind: 'movies' } }),
  library({ id: 3, name: 'Series', settings: { ...library().settings, kind: 'shows' } }),
  library({ id: 5, name: 'Clips', settings: { ...library().settings, kind: 'other' } }),
]

const shelf = (name: string) => screen.getByRole('region', { name })

const AddressProbe = () => {
  const { pathname, search } = useLocation()
  return <output aria-label="Current address">{`${pathname}${search}`}</output>
}

describe('HomePage', () => {
  const spies = {
    home: spyOn(api, 'getHome'),
    libraries: spyOn(api, 'listLibraries'),
    search: spyOn(api, 'searchHome'),
  }

  const open = (home: Home) => {
    spies.home.mockImplementation(async () => home)
    spies.libraries.mockImplementation(async () => LIBRARIES)
    renderWithProviders(<HomePage />)
  }

  afterEach(() => {
    cleanup()
    spies.home.mockReset()
    spies.libraries.mockReset()
    spies.search.mockReset()
  })

  it('stands in for its shelves while home is read, hiding the stand-ins from a screen reader', async () => {
    spies.home.mockImplementation(() => held<Home>().promise)
    spies.libraries.mockImplementation(async () => LIBRARIES)
    renderWithProviders(<HomePage />)
    expect(await screen.findByText('Gathering your libraries')).toBeInTheDocument()
    expect(screen.queryAllByRole('listitem')).toEqual([])
  })

  it('puts what is in progress first, then a row for each pinned library', async () => {
    open({
      inProgress: [{ media: EPISODE_TWO, poster: SEASON_ONE_CARD }],
      shelves: [
        { libraryId: 2, type: 'media', media: [matchedMovie()] },
        { libraryId: 3, type: 'shows', shows: [showEntry()] },
        { libraryId: 5, type: 'media', media: [mediaItem({ id: 8, title: 'Clip' })] },
      ],
    })
    await screen.findByRole('heading', { name: 'Films' })
    expect(
      screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent),
    ).toEqual(['Continue watching', 'Films', 'Series', 'Clips'])
    expect(
      within(shelf('Continue watching')).getByRole('link', {
        name: `Play ${mediaLabel(EPISODE_TWO)}`,
      }),
    ).toHaveAttribute('href', '/watch/13')
    expect(shelf('Continue watching').querySelector('img')?.getAttribute('src')).toContain(
      '/api/items/5/images/poster',
    )
    expect(
      within(shelf('Continue watching')).getByRole('link', { name: mediaLabel(EPISODE_TWO) }),
    ).toHaveAttribute('href', '/episodes/7?library=2')
    expect(within(shelf('Films')).getByRole('link', { name: 'Films' })).toHaveAttribute(
      'href',
      '/libraries/2',
    )
  })

  it("lays each library's row out as the library does: posters, shows, frame grabs", async () => {
    open({
      inProgress: [],
      shelves: [
        { libraryId: 2, type: 'media', media: [matchedMovie()] },
        { libraryId: 3, type: 'shows', shows: [showEntry()] },
        { libraryId: 5, type: 'media', media: [mediaItem({ id: 8, title: 'Clip' })] },
      ],
    })
    await screen.findByRole('heading', { name: 'Films' })
    expect(within(shelf('Films')).getByRole('link', { name: 'Busboys' })).toHaveAttribute(
      'href',
      '/movies/40?library=2',
    )
    expect(within(shelf('Series')).getByRole('link', { name: 'Severance' })).toHaveAttribute(
      'href',
      '/shows/4',
    )
    expect(within(shelf('Clips')).getByRole('link', { name: 'Clip' })).toHaveAttribute(
      'href',
      '/watch/8',
    )
  })

  it('sizes every poster as the rows lay them out, eight, four or two across', async () => {
    open({
      inProgress: [{ media: EPISODE_TWO, poster: SEASON_ONE_CARD }],
      shelves: [
        { libraryId: 2, type: 'media', media: [matchedMovie()] },
        { libraryId: 3, type: 'shows', shows: [showEntry()] },
      ],
    })
    await screen.findByRole('heading', { name: 'Films' })
    const posters = ['Continue watching', 'Films', 'Series'].map((name) =>
      shelf(name).querySelector('img'),
    )
    expect(posters.map((poster) => poster?.getAttribute('sizes'))).toEqual([
      POSTER_SIZES.row,
      POSTER_SIZES.row,
      POSTER_SIZES.row,
    ])
    expect(posters.map((poster) => poster?.getAttribute('srcset')?.split(', ').length)).toEqual([
      3, 3, 3,
    ])
  })

  it('shows every video in progress, past the eight a library row holds', async () => {
    const watching = Array.from({ length: 10 }, (_, index) => ({
      media: mediaItem({ id: 100 + index, title: `Halfway ${index}`, position: 60 }),
      poster: null,
    }))
    open({ inProgress: watching, shelves: [] })
    await screen.findByRole('heading', { name: 'Continue watching' })
    expect(within(shelf('Continue watching')).getAllByRole('listitem')).toHaveLength(10)
  })

  it('leaves the row out when nothing is in progress', async () => {
    open({ inProgress: [], shelves: [{ libraryId: 2, type: 'media', media: [matchedMovie()] }] })
    await screen.findByRole('heading', { name: 'Films' })
    expect(screen.queryByRole('heading', { name: 'Continue watching' })).toBeNull()
  })

  it('says when a pinned library has nothing in it yet', async () => {
    open({ inProgress: [], shelves: [{ libraryId: 5, type: 'media', media: [] }] })
    await screen.findByRole('heading', { name: 'Clips' })
    expect(within(shelf('Clips')).getByText('Nothing here yet.')).toBeInTheDocument()
  })

  it('explains how to fill it when nothing is pinned or in progress', async () => {
    open({ inProgress: [], shelves: [] })
    expect(await screen.findByText(/Pin a library/)).toBeInTheDocument()
  })

  describe('searching every library', () => {
    const HOME: Home = {
      inProgress: [{ media: EPISODE_TWO, poster: SEASON_ONE_CARD }],
      shelves: [{ libraryId: 5, type: 'media', media: [mediaItem({ id: 8, title: 'Clip' })] }],
    }
    const FOUND: HomeSearch = [
      { libraryId: 2, type: 'media', media: [matchedMovie()] },
      { libraryId: 3, type: 'shows', shows: [showEntry()] },
    ]

    const serve = ({ route = '/', found = FOUND }: { route?: string; found?: HomeSearch } = {}) => {
      spies.home.mockImplementation(async () => HOME)
      spies.libraries.mockImplementation(async () => LIBRARIES)
      spies.search.mockImplementation(async () => found)
      renderWithProviders(
        <>
          <Link to="/">Back home</Link>
          <AddressProbe />
          <HomePage />
        </>,
        { route },
      )
    }

    const searchbox = () => screen.getByRole('searchbox', { name: 'Search every library' })

    it('searches once typing pauses, never on each keystroke, showing what it found in place of the rows', async () => {
      serve()
      await screen.findByRole('heading', { name: 'Continue watching' })
      await userEvent.type(searchbox(), 'bus')
      await screen.findByRole('heading', { name: 'Films' })
      expect(spies.search.mock.calls).toEqual([['bus']])
      expect(
        screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent),
      ).toEqual(['Films', 'Series'])
      expect(within(shelf('Films')).getByRole('link', { name: 'Busboys' })).toHaveAttribute(
        'href',
        '/movies/40?library=2',
      )
    })

    it('opens a library on the search, so it lists every match there', async () => {
      serve({ route: '/?q=bus' })
      await screen.findByRole('heading', { name: 'Films' })
      expect(within(shelf('Films')).getByRole('link', { name: 'Films' })).toHaveAttribute(
        'href',
        '/libraries/2?q=bus',
      )
    })

    it('opens on the search the address carries, and writes a new one into it', async () => {
      serve({ route: '/?q=bus' })
      expect(searchbox()).toHaveValue('bus')
      await screen.findByRole('heading', { name: 'Films' })
      expect(spies.search.mock.calls).toEqual([['bus']])
      await userEvent.clear(searchbox())
      await userEvent.type(searchbox(), 'sev')
      await waitFor(() => expect(spies.search.mock.calls.at(-1)).toEqual(['sev']))
    })

    it('says when nothing matches', async () => {
      serve({ route: '/?q=zzz', found: [] })
      expect(await screen.findByText('Nothing in any library matches "zzz".')).toBeInTheDocument()
    })

    it('puts the rows back when the search is cleared, or the link home is followed', async () => {
      serve({ route: '/?q=bus' })
      await screen.findByRole('heading', { name: 'Films' })
      await userEvent.clear(searchbox())
      expect(await screen.findByRole('heading', { name: 'Continue watching' })).toBeInTheDocument()

      await userEvent.type(searchbox(), 'bus')
      // The cached results show a render before the deferred query writes the
      // address, so waiting on them alone lets that write land outside act().
      await waitFor(() =>
        expect(screen.getByLabelText('Current address')).toHaveTextContent(/^\/\?q=bus$/),
      )
      expect(screen.getByRole('heading', { name: 'Films' })).toBeInTheDocument()
      await act(async () => {
        await userEvent.click(screen.getByRole('link', { name: 'Back home' }))
      })
      await waitFor(() =>
        expect(screen.getByLabelText('Current address')).toHaveTextContent(/^\/$/),
      )
      await waitFor(() => expect(searchbox()).toHaveValue(''))
      expect(await screen.findByRole('heading', { name: 'Continue watching' })).toBeInTheDocument()
    })
  })
})
