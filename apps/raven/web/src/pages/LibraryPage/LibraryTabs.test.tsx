import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { LibraryKind, LibrarySettings } from '@raven/core'
import { api } from '@/lib/api'
import { itemSummary, library, matchedMovie, mediaItem } from '@/test/fixtures'
import { renderLibraryPage } from '@/test/libraryPage'

const movie = ({ id, title, year }: { id: number; title: string; year: number }) =>
  matchedMovie({ id, title, item: itemSummary({ id: id * 10, title, year }) })

describe('LibraryPage tabs', () => {
  const spies = {
    get: spyOn(api, 'getLibrary'),
    list: spyOn(api, 'listMedia'),
    inProgress: spyOn(api, 'listInProgress'),
    favourites: spyOn(api, 'listLibraryFavourites'),
    unmatched: spyOn(api, 'listUnmatched'),
    history: spyOn(api, 'listHistory'),
    lockState: spyOn(api, 'getLock'),
    health: spyOn(api, 'getMetadataHealth'),
    match: spyOn(api, 'matchLibrary'),
  }

  beforeEach(() => {
    spies.list.mockImplementation(async () => [mediaItem({ id: 1, title: 'Wide' })])
    spies.inProgress.mockImplementation(async () => [])
    spies.favourites.mockImplementation(async () => [])
    spies.unmatched.mockImplementation(async () => [])
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
      'Not matched',
      'Recently finished',
    ])
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/libraries/2',
      '/libraries/2/in-progress',
      '/libraries/2/favourites',
      '/libraries/2/not-matched',
      '/libraries/2/finished',
    ])
    expect(screen.getByRole('link', { name: 'All' })).toHaveAttribute('aria-current', 'page')
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
      mediaItem({ id: 9, title: 'Unknown Thing', match: 'unmatched' }),
    ])
    open({ route: '/libraries/2/not-matched' })
    expect(
      await screen.findByText(/choose Fix match to point it at the right movie/),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Unknown Thing/ })).toBeInTheDocument()
  })

  it('reads the count of files not matched again once Match again settles on its tab', async () => {
    const films = (unmatchedCount: number) =>
      library({
        id: 2,
        name: 'Films',
        unmatchedCount,
        settings: { ...library().settings, kind: 'movies' },
      })
    const lost = (match: 'pending' | 'unmatched') => [
      mediaItem({ id: 9, title: 'Unknown Thing', match }),
    ]
    spies.health.mockImplementation(async () => ({
      tmdb: 'ok',
      omdb: 'off',
      pending: 0,
      error: null,
      lastOk: null,
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
    expect(
      await screen.findByText('Movies · 12 videos · 1 not matched', {}, { timeout: 5000 }),
    ).toBeInTheDocument()
  }, 10_000)

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
