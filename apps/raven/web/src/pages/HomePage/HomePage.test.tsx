import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test'
import { act, cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { type Hero, type Home, type HomeSearch, mediaLabel } from '@raven/core'
import { Link, useLocation } from 'react-router-dom'
import { SiteSearch } from '@/components/SiteSearch/SiteSearch'
import { api } from '@/lib/api'
import { POSTER_SIZES } from '@/lib/posters'
import { HomePage } from '@/pages/HomePage/HomePage'
import { itemSummary, library, matchedMovie, mediaItem, showEntry } from '@/test/fixtures'
import { held } from '@/test/held'
import { renderWithProviders } from '@/test/render'
import { EPISODE_TWO, SEASON_ONE_CARD, SEVERANCE } from '@/test/tv'
import { useBinge } from '@/stores/binge'
import { asDesktop, downloadsMain } from '@/test/desktop'

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
    hero: spyOn(api, 'getHero'),
    libraries: spyOn(api, 'listLibraries'),
    search: spyOn(api, 'searchHome'),
    item: spyOn(api, 'getItem'),
  }

  beforeEach(() => {
    spies.hero.mockImplementation(async () => [])
  })

  const open = (home: Home) => {
    spies.home.mockImplementation(async () => home)
    spies.libraries.mockImplementation(async () => LIBRARIES)
    renderWithProviders({ ui: <HomePage /> })
  }

  afterEach(() => {
    cleanup()
    spies.home.mockReset()
    spies.libraries.mockReset()
    spies.search.mockReset()
    spies.hero.mockReset()
    spies.item.mockReset()
  })

  it('stands in for its shelves while home is read, hiding the stand-ins from a screen reader', async () => {
    spies.home.mockImplementation(() => held<Home>().promise)
    spies.libraries.mockImplementation(async () => LIBRARIES)
    renderWithProviders({ ui: <HomePage /> })
    expect(await screen.findByText('Gathering your libraries')).toBeInTheDocument()
    expect(screen.queryAllByRole('listitem')).toEqual([])
  })

  it('stands in for the hero while its titles are read, apart from the shelves', async () => {
    spies.hero.mockImplementation(() => held<Hero>().promise)
    spies.home.mockImplementation(async () => ({ inProgress: [], shelves: [] }))
    spies.libraries.mockImplementation(async () => LIBRARIES)
    renderWithProviders({ ui: <HomePage /> })
    expect(await screen.findByText('Gathering the newest titles')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText('Gathering your libraries')).toBeNull())
  })

  it('shows no Back on a first visit, and steps back once the app has been browsed', async () => {
    open({ inProgress: [], shelves: [] })
    expect(await screen.findByRole('heading', { level: 1, name: 'Home' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull()
    // Home is the top of the app, so with nothing behind it there is no fallback link either.
    expect(screen.queryAllByRole('link')).toEqual([])
    cleanup()
    spies.home.mockImplementation(async () => ({ inProgress: [], shelves: [] }))
    renderWithProviders({ ui: <HomePage />, route: '/', behind: ['/libraries'] })
    expect(await screen.findByRole('button', { name: 'Back' })).toBeInTheDocument()
    expect(screen.queryAllByRole('link')).toEqual([])
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
      '/api/pictures/items/5/poster',
    )
    expect(
      within(shelf('Continue watching')).getByRole('link', { name: mediaLabel(EPISODE_TWO) }),
    ).toHaveAttribute('href', '/episodes/7?library=2')
    expect(within(shelf('Films')).getByRole('link', { name: 'Films' })).toHaveAttribute(
      'href',
      '/libraries/2',
    )
  })

  it('leads with the hero the server chose, ahead of what is in progress', async () => {
    const pictured = matchedMovie({
      item: itemSummary({ backdropVersion: 'b1' }),
    })
    const chosen: Hero = [
      { libraryId: 2, type: 'media', media: pictured, line: 'A line from the server.' },
    ]
    spies.hero.mockImplementation(async () => chosen)
    open({
      inProgress: [{ media: EPISODE_TWO, poster: SEASON_ONE_CARD }],
      shelves: [
        { libraryId: 2, type: 'media', media: [pictured] },
        { libraryId: 3, type: 'shows', shows: [showEntry()] },
      ],
    })
    const hero = await screen.findByRole('region', { name: 'Featured' })
    expect(within(hero).getByText('Featured in Films')).toBeInTheDocument()
    expect(within(hero).getByText('A line from the server.')).toBeInTheDocument()
    expect(
      screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent),
    ).toEqual(['Busboys', 'Continue watching', 'Films', 'Series'])
  })

  it('puts binge shows above the hero, but not in the desktop app', async () => {
    useBinge.getState().toggle({ account: 'local', item: SEVERANCE })
    spies.item.mockImplementation(async () => SEVERANCE)
    spies.hero.mockImplementation(async () => [
      {
        libraryId: 2,
        type: 'media',
        media: matchedMovie({ item: itemSummary({ backdropVersion: 'b1' }) }),
        line: 'Featured film.',
      },
    ])
    open({ inProgress: [], shelves: [] })
    const binge = await screen.findByRole('region', { name: 'Binge' })
    await screen.findByRole('region', { name: 'Featured' })
    expect(
      screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent),
    ).toEqual(['Binge', 'Busboys'])
    expect(within(binge).getByRole('link', { name: /Severance/ })).toHaveAttribute(
      'href',
      '/shows/4',
    )
    cleanup()
    asDesktop(downloadsMain())
    open({ inProgress: [], shelves: [] })
    await screen.findByRole('region', { name: 'Featured' })
    expect(screen.queryByRole('region', { name: 'Binge' })).toBeNull()
  })

  it('leaves the hero out when the server chose nothing', async () => {
    open({ inProgress: [], shelves: [{ libraryId: 2, type: 'media', media: [matchedMovie()] }] })
    await screen.findByRole('heading', { name: 'Films' })
    expect(screen.queryByRole('region', { name: 'Featured' })).toBeNull()
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

  it('sizes every poster as its row or tile lays it out', async () => {
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
      POSTER_SIZES.showTile,
      POSTER_SIZES.row,
      POSTER_SIZES.row,
    ])
    expect(posters.map((poster) => poster?.getAttribute('srcset')?.split(', ').length)).toEqual([
      3, 3, 3,
    ])
  })

  it('shows the first six videos in progress, and every one behind Show all', async () => {
    const user = userEvent.setup()
    const watching = Array.from({ length: 10 }, (_, index) => ({
      media: mediaItem({ id: 100 + index, title: `Halfway ${index}`, position: 60 }),
      poster: null,
    }))
    open({ inProgress: watching, shelves: [] })
    await screen.findByRole('heading', { name: 'Continue watching' })
    const section = shelf('Continue watching')
    expect(within(section).getAllByRole('listitem')).toHaveLength(6)

    await user.click(within(section).getByRole('button', { name: 'Show all 10' }))
    expect(within(section).getAllByRole('listitem')).toHaveLength(10)

    await user.click(within(section).getByRole('button', { name: 'Show fewer' }))
    expect(within(section).getAllByRole('listitem')).toHaveLength(6)
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

  // The box is the shell's, over every page; home shows what it finds.
  describe('searching every library', () => {
    const HOME: Home = {
      inProgress: [{ media: EPISODE_TWO, poster: SEASON_ONE_CARD }],
      shelves: [{ libraryId: 5, type: 'media', media: [mediaItem({ id: 8, title: 'Clip' })] }],
    }
    const FOUND: HomeSearch = [
      { libraryId: 2, type: 'media', media: [matchedMovie()] },
      { libraryId: 3, type: 'shows', shows: [showEntry()] },
    ]

    type ServeProps = { route?: string; found?: HomeSearch }

    const serve = ({ route = '/', found = FOUND }: ServeProps = {}) => {
      spies.home.mockImplementation(async () => HOME)
      spies.libraries.mockImplementation(async () => LIBRARIES)
      spies.search.mockImplementation(async () => found)
      renderWithProviders({
        ui: (
          <>
            <Link to="/">Back home</Link>
            <AddressProbe />
            <SiteSearch />
            <HomePage />
          </>
        ),
        route,
      })
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

    it('says nothing matches only once the server says so, not while the last search stands in', async () => {
      serve({ route: '/?q=zzz', found: [] })
      expect(await screen.findByText('Nothing in any library matches "zzz".')).toBeInTheDocument()

      const later = held<HomeSearch>()
      spies.search.mockImplementation(() => later.promise)
      await userEvent.type(searchbox(), 'q')
      await waitFor(() => expect(spies.search.mock.calls.at(-1)).toEqual(['zzzq']))
      expect(screen.queryByText(/^Nothing in any library matches/)).not.toBeInTheDocument()

      await act(async () => later.answer([]))
      expect(await screen.findByText('Nothing in any library matches "zzzq".')).toBeInTheDocument()
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
