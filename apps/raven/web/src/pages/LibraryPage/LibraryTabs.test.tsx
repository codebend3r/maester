import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { LibraryKind, LibrarySettings } from '@raven/core'
import { api } from '@/lib/api'
import {
  aiSuggestion,
  itemSummary,
  library,
  matchedMovie,
  mediaItem,
  unmatchedFile,
} from '@/test/fixtures'
import { renderLibraryPage } from '@/test/libraryPage'
import { pollFast } from '@/test/polls'

const movie = ({ id, title, year }: { id: number; title: string; year: number }) =>
  matchedMovie({ id, title, item: itemSummary({ id: id * 10, title, year }) })

describe('LibraryPage tabs', () => {
  const spies = {
    get: spyOn(api, 'getLibrary'),
    list: spyOn(api, 'listMedia'),
    inProgress: spyOn(api, 'listInProgress'),
    favourites: spyOn(api, 'listLibraryFavourites'),
    sagas: spyOn(api, 'listSagas'),
    unmatched: spyOn(api, 'listUnmatched'),
    duplicates: spyOn(api, 'listDuplicates'),
    history: spyOn(api, 'listHistory'),
    lockState: spyOn(api, 'getLock'),
    health: spyOn(api, 'getMetadataHealth'),
    match: spyOn(api, 'matchLibrary'),
    setMatch: spyOn(api, 'setMatch'),
  }

  beforeEach(() => {
    spies.list.mockImplementation(async () => [mediaItem({ id: 1, title: 'Wide' })])
    spies.inProgress.mockImplementation(async () => [])
    spies.favourites.mockImplementation(async () => [])
    spies.sagas.mockImplementation(async () => [])
    spies.unmatched.mockImplementation(async () => [])
    spies.duplicates.mockImplementation(async () => [])
    spies.history.mockImplementation(async () => [])
  })

  afterEach(() => Object.values(spies).forEach((spy) => spy.mockReset()))

  const open = ({
    kind = 'movies',
    route = '/libraries/2',
    settings = {},
  }: {
    kind?: LibraryKind
    route?: string
    settings?: Partial<LibrarySettings>
  } = {}) => {
    spies.get.mockImplementation(async () =>
      library({ id: 2, name: 'Films', settings: { ...library().settings, kind, ...settings } }),
    )
    renderLibraryPage({ route })
  }

  it('offers the tabs its type has, with All open first', async () => {
    open({ kind: 'documentaries' })
    const links = within(await screen.findByRole('navigation', { name: 'Sections' })).getAllByRole(
      'link',
    )
    expect(links.map((link) => link.textContent)).toEqual([
      'All',
      'In progress',
      'Favourites',
      'Sagas',
      'Not matched',
      'Duplicates',
      'Recently finished',
    ])
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/libraries/2',
      '/libraries/2/in-progress',
      '/libraries/2/favourites',
      '/libraries/2/sagas',
      '/libraries/2/not-matched',
      '/libraries/2/duplicates',
      '/libraries/2/finished',
    ])
    expect(screen.getByRole('link', { name: 'All' })).toHaveAttribute('aria-current', 'page')
  })

  it('opens Duplicates on the movies holding more than one file', async () => {
    const alexander = movie({ id: 4, title: 'Alexander', year: 2004 })
    spies.duplicates.mockImplementation(async () => [
      {
        itemId: 40,
        cards: [
          {
            entry: { media: { ...alexander, versions: 2 }, poster: null },
            files: [
              { media: alexander, cut: null },
              {
                media: { ...alexander, id: 5, fileName: 'Alexander Final Cut.mkv' },
                cut: { label: 'Final Cut', key: 'final' },
              },
            ],
          },
        ],
      },
    ])
    open({ route: '/libraries/2/duplicates' })
    expect(await screen.findByRole('heading', { name: 'Alexander' })).toBeInTheDocument()
    expect(spies.duplicates).toHaveBeenCalledWith(2)
    expect(spies.list).not.toHaveBeenCalled()
  })

  it('lays each saga out as a deck of its posters, opening its own page', async () => {
    spies.sagas.mockImplementation(async () => [
      {
        tmdbId: '119',
        name: 'The Lord of the Rings Collection',
        media: [
          movie({ id: 7, title: 'The Fellowship of the Ring', year: 2001 }),
          movie({ id: 8, title: 'The Two Towers', year: 2002 }),
        ],
      },
    ])
    open()
    await userEvent.click(await screen.findByRole('link', { name: 'Sagas' }))
    const deck = await screen.findByRole('link', { name: /The Lord of the Rings Collection/ })
    expect(deck).toHaveAttribute('href', '/libraries/2/sagas/119')
    expect(deck).toHaveTextContent('2 movies · 2001 to 2002')
    expect(deck.querySelectorAll('img')).toHaveLength(2)
    expect(screen.getByRole('link', { name: 'Sagas' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByTestId('address')).toHaveTextContent('/libraries/2/sagas')
  })

  it('asks for nothing but its own tab', async () => {
    open({ route: '/libraries/2/favourites' })
    await screen.findByText(/No favourites in Films yet/)
    expect(spies.list).not.toHaveBeenCalled()
    expect(spies.favourites).toHaveBeenCalledWith(2)
  })

  it('moves between tabs by their links, back to the listing with All', async () => {
    open()
    await screen.findByRole('link', { name: /Wide/ })
    await userEvent.click(screen.getByRole('link', { name: 'In progress' }))
    expect(await screen.findByText(/Nothing in progress in Films/)).toBeInTheDocument()
    expect(screen.getByTestId('address')).toHaveTextContent('/libraries/2/in-progress')
    await userEvent.click(screen.getByRole('link', { name: 'All' }))
    expect(await screen.findByRole('link', { name: /Wide/ })).toBeInTheDocument()
  })

  it('says why nothing is in progress in a library that does not save where videos stop', async () => {
    open({ route: '/libraries/2/in-progress', settings: { saveProgress: false } })
    expect(await screen.findByText(/does not save where videos stop/)).toBeInTheDocument()
  })

  it('shows what is in progress, each with the poster its card wears', async () => {
    spies.inProgress.mockImplementation(async () => [
      { media: movie({ id: 7, title: 'Heat', year: 1995 }), poster: null },
    ])
    open({ route: '/libraries/2/in-progress' })
    expect(await screen.findByRole('link', { name: 'Play Heat' })).toHaveAttribute(
      'href',
      '/watch/7',
    )
  })

  it('lists the files not matched, with how to fix them', async () => {
    spies.unmatched.mockImplementation(async () => [
      unmatchedFile({ id: 9, title: 'Unknown Thing', match: 'unmatched' }),
    ])
    open({ route: '/libraries/2/not-matched' })
    expect(
      await screen.findByText(/choose Fix match to point it at the right movie/),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Unknown Thing/ })).toBeInTheDocument()
  })

  it('groups the files not matched of a TV library by show folder', async () => {
    spies.unmatched.mockImplementation(async () =>
      [1, 2].map((id) =>
        unmatchedFile({
          id,
          title: `Archie - S01E0${id}`,
          folder: 'Archie/Season 1',
          fileName: `Archie - S01E0${id}.mkv`,
          match: 'unmatched',
        }),
      ),
    )
    open({ kind: 'shows', route: '/libraries/2/not-matched' })
    expect(
      await screen.findByText(
        'Choose Fix match beside a show to point its folder at the right show.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Archie/ })).toHaveTextContent('2 episodes')
    expect(screen.getByRole('button', { name: 'Fix match for Archie' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Archie - S01E01/ })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: /^Archie/ }))
    expect(screen.getByRole('link', { name: /Archie - S01E01/ })).toBeInTheDocument()
  })

  it("offers the AI lookup's suggestion for a show folder, and accepts it as Fix match would", async () => {
    spies.unmatched.mockImplementation(async () =>
      [1, 2].map((id) =>
        unmatchedFile({
          id,
          title: `Archie - S01E0${id}`,
          folder: 'Archie/Season 1',
          fileName: `Archie - S01E0${id}.mkv`,
          aiSuggestion: aiSuggestion(),
        }),
      ),
    )
    spies.setMatch.mockImplementation(async () => mediaItem({ id: 1, match: 'manual' }))
    open({ kind: 'shows', route: '/libraries/2/not-matched' })
    expect(
      await screen.findByText('Suggested: Archie: The Man Who Became Cary Grant (2023)'),
    ).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Fix match for Archie' })).toHaveLength(1)
    spies.unmatched.mockImplementation(async () => [])
    await userEvent.click(
      screen.getByRole('button', {
        name: 'Accept Archie: The Man Who Became Cary Grant (2023) for Archie',
      }),
    )
    expect(spies.setMatch).toHaveBeenCalledWith({ mediaId: 1, tmdbId: '201000' })
    await waitFor(() =>
      expect(
        screen.queryByText('Suggested: Archie: The Man Who Became Cary Grant (2023)'),
      ).toBeNull(),
    )
  })

  it("offers the AI lookup's suggestion for a movie above the files", async () => {
    spies.unmatched.mockImplementation(async () => [
      unmatchedFile({
        id: 9,
        title: 'Archie',
        year: 2023,
        folder: 'Archie (2023)',
        fileName: 'Archie (2023).mkv',
        aiSuggestion: aiSuggestion(),
      }),
    ])
    spies.setMatch.mockImplementation(async () => mediaItem({ id: 9, match: 'manual' }))
    open({ route: '/libraries/2/not-matched' })
    const suggested = await screen.findByRole('region', { name: 'Suggested by AI' })
    await userEvent.click(
      within(suggested).getByRole('button', {
        name: 'Accept Archie: The Man Who Became Cary Grant (2023) for Archie (2023)',
      }),
    )
    expect(spies.setMatch).toHaveBeenCalledWith({ mediaId: 9, tmdbId: '201000' })
    expect(screen.getByRole('link', { name: /Archie/ })).toBeInTheDocument()
  })

  it('reads the count of files not matched again once Match again settles on its tab', async () => {
    pollFast()
    const films = (unmatchedCount: number) =>
      library({
        id: 2,
        name: 'Films',
        unmatchedCount,
        settings: { ...library().settings, kind: 'movies' },
      })
    const lost = (match: 'pending' | 'unmatched') => [
      unmatchedFile({ id: 9, title: 'Unknown Thing', match }),
    ]
    spies.health.mockImplementation(async () => ({
      tmdb: 'ok',
      omdb: 'off',
      pending: 0,
      error: null,
      lastOk: null,
      ai: 'off',
      aiRemaining: 0,
    }))
    spies.get.mockImplementation(async () => films(1))
    spies.unmatched.mockImplementation(async () => lost('unmatched'))
    renderLibraryPage({ route: '/libraries/2/not-matched' })
    await screen.findByText('Movies · 12 videos · 1 not matched')
    // Match again sends the file back to pending, and the pass leaves it unmatched again.
    spies.match.mockImplementation(async () => films(0))
    spies.unmatched.mockImplementationOnce(async () => lost('pending'))
    const button = screen.getByRole('button', { name: 'Match again' })
    await waitFor(() => expect(button).toBeEnabled())
    await userEvent.click(button)
    expect(await screen.findByText('Movies · 12 videos')).toBeInTheDocument()
    // The tab polls while a file is pending; once none is, the library is read again.
    expect(await screen.findByText('Movies · 12 videos · 1 not matched')).toBeInTheDocument()
  })

  it('shows the most recently finished, with a way to the whole history', async () => {
    spies.history.mockImplementation(async () => [
      {
        media: movie({ id: 7, title: 'Heat', year: 1995 }),
        lastPlayedAt: new Date().toISOString(),
        plays: 2,
        furthest: 100,
        watched: true,
      },
    ])
    open({ route: '/libraries/2/finished' })
    expect(await screen.findByText('Today · 2 plays')).toBeInTheDocument()
    expect(spies.history).toHaveBeenCalledWith({ libraryId: 2, limit: 48, watchedOnly: true })
    expect(screen.getByRole('link', { name: 'Full history' })).toHaveAttribute(
      'href',
      '/libraries/2/history',
    )
  })

  it("opens All in place of a tab the library's type does not have", async () => {
    open({ kind: 'other', route: '/libraries/2/sagas' })
    expect(await screen.findByRole('link', { name: /Wide/ })).toBeInTheDocument()
    expect(screen.getByTestId('address')).toHaveTextContent(/^\/libraries\/2$/)
  })

  it('finds nothing at an address that names no tab', async () => {
    open({ route: '/libraries/2/all' })
    expect(await screen.findByText('Nothing lives at this address')).toBeInTheDocument()
  })

  it('keeps the tabs of a locked library hidden until the PIN is entered', async () => {
    spies.lockState.mockImplementation(async () => ({ available: true, unlocked: false }))
    open({ route: '/libraries/2/favourites', settings: { locked: true } })
    await screen.findByRole('region', { name: 'Locked' })
    expect(screen.queryByRole('navigation', { name: 'Sections' })).toBeNull()
    expect(spies.favourites).not.toHaveBeenCalled()
  })
})
