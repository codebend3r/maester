import { afterEach, describe, expect, it, spyOn } from 'bun:test'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Library, LibraryInput, LibrarySettings, MediaItem, MediaSort } from '@raven/core'
import { Route, Routes, useLocation, useParams } from 'react-router-dom'
import { api } from '@/lib/api'
import { LibraryPage } from '@/pages/LibraryPage/LibraryPage'
import { library, mediaItem, showEntry } from '@/test/fixtures'
import { renderWithProviders } from '@/test/render'

const WIDE = mediaItem({ id: 1, title: 'Wide', width: 3840, height: 2160 })
const FULL = mediaItem({ id: 2, title: 'Full', width: 1920, height: 1080 })
const ITEMS = [WIDE, FULL, mediaItem({ id: 3, title: 'Also full', width: 1920, height: 800 })]

/** Stands in for the player: says which video the page went to. */
const Watching = () => <p>Watching {useParams().id}</p>

/** Prints the address's query string, so a test can read what the page wrote there. */
const Address = () => <p data-testid="address">{useLocation().search}</p>

describe('LibraryPage', () => {
  const spies = {
    get: spyOn(api, 'getLibrary'),
    list: spyOn(api, 'listMedia'),
    update: spyOn(api, 'updateLibrary'),
  }
  const state = {
    sent: [] as LibraryInput[],
    listed: [] as Array<{ sort?: MediaSort; seed?: number }>,
  }

  /** Serves one library whose settings change as the page saves them. */
  const serve = (
    settings: Partial<LibrarySettings> = {},
    items: MediaItem[] = ITEMS,
    route = '/libraries/2',
  ) => {
    const current: { library: Library } = {
      library: library({ id: 2, settings: { ...library().settings, ...settings } }),
    }
    spies.get.mockImplementation(async () => current.library)
    spies.list.mockImplementation(async (request) => {
      state.listed.push({ sort: request.sort, seed: request.seed })
      return items
    })
    spies.update.mockImplementation(async ({ input }) => {
      state.sent.push(input)
      current.library = {
        ...current.library,
        settings: { ...current.library.settings, ...input.settings },
      }
      return current.library
    })
    renderWithProviders(
      <>
        <Routes>
          <Route path="libraries/:id" element={<LibraryPage />} />
          <Route path="watch/:id" element={<Watching />} />
        </Routes>
        <Address />
      </>,
      { route },
    )
  }

  afterEach(() => {
    spies.get.mockReset()
    spies.list.mockReset()
    spies.update.mockReset()
    state.sent = []
    state.listed = []
  })

  it('opens in the view and sort the library was left in', async () => {
    serve({ view: 'list', sort: 'largest' })
    expect(await screen.findByRole('table', { name: 'Videos' })).toBeInTheDocument()
    expect(screen.getByLabelText('Sort')).toHaveValue('largest')
    expect(screen.getByRole('button', { name: 'List' })).toHaveAttribute('aria-pressed', 'true')
    expect(state.listed.at(-1)?.sort).toBe('largest')
  })

  it('opens on the search, sort, view and grouping the address carries', async () => {
    serve(
      { view: 'grid', sort: 'title' },
      ITEMS,
      '/libraries/2?q=wide&sort=largest&view=list&group=codec',
    )
    expect(await screen.findByRole('table', { name: 'Videos' })).toBeInTheDocument()
    expect(screen.getByLabelText('Search Movies')).toHaveValue('wide')
    expect(screen.getByLabelText('Sort')).toHaveValue('largest')
    expect(state.listed.at(-1)?.sort).toBe('largest')
    expect(spies.list.mock.calls.at(-1)?.[0]?.search).toBe('wide')
  })

  it('writes each change of view and the search into the address', async () => {
    serve()
    await screen.findByRole('link', { name: 'Wide' })
    await userEvent.click(screen.getByRole('button', { name: 'List' }))
    await userEvent.selectOptions(screen.getByLabelText('Sort'), 'Largest file')
    expect(screen.getByTestId('address').textContent).toBe('?view=list&sort=largest')
    await userEvent.type(screen.getByLabelText('Search Movies'), 'wide')
    await waitFor(() =>
      expect(screen.getByTestId('address').textContent).toBe('?view=list&sort=largest&q=wide'),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Grid' }))
    expect(screen.getByTestId('address').textContent).toBe('?view=grid&sort=largest&q=wide')
  })

  it('saves a new sort to the library and lists in that order', async () => {
    serve()
    await screen.findByRole('link', { name: 'Wide' })
    await userEvent.selectOptions(screen.getByLabelText('Sort'), 'Highest bitrate')
    expect(state.sent).toEqual([
      { name: 'Movies', paths: ['/media/Movies'], settings: { sort: 'bitrate-high' } },
    ])
    expect(state.listed.at(-1)?.sort).toBe('bitrate-high')
  })

  it('switches the view straight away and saves it', async () => {
    serve()
    await screen.findByRole('link', { name: 'Wide' })
    await userEvent.click(screen.getByRole('button', { name: 'Tiles' }))
    expect(screen.getByRole('button', { name: 'Tiles' })).toHaveAttribute('aria-pressed', 'true')
    expect(state.sent.at(-1)?.settings).toEqual({ view: 'tiles' })
  })

  it('groups by resolution, and offers the other groupings only in that view', async () => {
    serve()
    await screen.findByRole('link', { name: 'Wide' })
    expect(screen.queryByLabelText('Group by')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Grouped' }))
    expect(
      screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent),
    ).toEqual(['4K, 1 video', '1080p, 2 videos'])
    await userEvent.selectOptions(screen.getByLabelText('Group by'), 'Video codec')
    expect(state.sent.at(-1)?.settings).toEqual({ groupBy: 'codec' })
  })

  it('folds every bucket to start, and opens one on a click', async () => {
    serve({ view: 'grouped', groupBy: 'resolution' })
    await screen.findByRole('link', { name: 'Wide' })
    const heading = screen
      .getAllByRole('heading', { level: 2 })
      .find((candidate) => candidate.textContent === '4K, 1 video')
    if (!heading) throw new Error('no 4K bucket')
    const bucket = heading.closest('details')
    expect(bucket).not.toBeNull()
    expect(bucket).not.toHaveAttribute('open')
    await userEvent.click(heading)
    expect(bucket).toHaveAttribute('open')
    expect(screen.getByRole('link', { name: 'Wide' })).toBeInTheDocument()
  })

  it('buckets a Movies library by matched and not matched, which is where a new one opens', async () => {
    serve({ view: 'grouped', groupBy: 'match', kind: 'movies' }, [
      mediaItem({ id: 1, title: 'Found', match: 'matched' }),
      mediaItem({ id: 2, title: 'Lost', match: 'unmatched' }),
      mediaItem({ id: 3, title: 'Also found', match: 'manual' }),
    ])
    await screen.findByRole('link', { name: 'Found' })
    expect(
      screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent),
    ).toEqual(['Matched, 2 videos', 'Not matched, 1 video'])
    const groupings = within(screen.getByLabelText('Group by'))
      .getAllByRole('option')
      .map((option) => option.textContent)
    expect(groupings[0]).toBe('Matched or not')
  })

  it('does not offer match buckets to a library of no particular type', async () => {
    serve({ view: 'grouped', groupBy: 'resolution', kind: 'other' })
    await screen.findByRole('link', { name: 'Wide' })
    const groupings = within(screen.getByLabelText('Group by'))
      .getAllByRole('option')
      .map((option) => option.textContent)
    expect(groupings).not.toContain('Matched or not')
  })

  it('plays the first video in the order shown', async () => {
    serve({ sort: 'largest' })
    await screen.findByRole('link', { name: 'Wide' })
    await userEvent.click(screen.getByRole('button', { name: 'Play' }))
    expect(await screen.findByText('Watching 1')).toBeInTheDocument()
  })

  it('plays the first video of the first bucket in the grouped view', async () => {
    serve({ view: 'grouped' }, [FULL, WIDE])
    await screen.findByRole('link', { name: 'Wide' })
    await userEvent.click(screen.getByRole('button', { name: 'Play' }))
    expect(await screen.findByText('Watching 1')).toBeInTheDocument()
  })

  it('shuffles to a random video whatever the sort', async () => {
    serve({ sort: 'title' })
    await screen.findByRole('link', { name: 'Wide' })
    const random = spyOn(Math, 'random').mockReturnValue(0.9)
    await userEvent.click(screen.getByRole('button', { name: 'Shuffle' }))
    random.mockRestore()
    expect(await screen.findByText('Watching 3')).toBeInTheDocument()
  })

  it('says what type of library it is', async () => {
    serve({ kind: 'movies' })
    expect(await screen.findByText('Movies · 12 videos')).toBeInTheDocument()
  })

  it("links to the library's history", async () => {
    serve()
    expect(await screen.findByRole('link', { name: 'History' })).toHaveAttribute(
      'href',
      '/libraries/2/history',
    )
  })

  it('has nothing to play or shuffle in an empty library', async () => {
    serve({}, [])
    await screen.findByText(/No videos in these folders yet/)
    expect(screen.getByRole('button', { name: 'Play' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Shuffle' })).toBeDisabled()
  })
})

describe('LibraryPage for TV shows', () => {
  const spies = {
    get: spyOn(api, 'getLibrary'),
    shows: spyOn(api, 'listShows'),
    list: spyOn(api, 'listMedia'),
    health: spyOn(api, 'getMetadataHealth'),
    match: spyOn(api, 'matchLibrary'),
  }

  afterEach(() => {
    spies.get.mockReset()
    spies.shows.mockReset()
    spies.list.mockReset()
    spies.health.mockReset()
    spies.match.mockReset()
  })

  const serve = (settings: Partial<LibrarySettings> = {}) => {
    spies.get.mockImplementation(async () =>
      library({
        id: 2,
        name: 'TV',
        unmatchedCount: 1,
        settings: { ...library().settings, kind: 'shows', ...settings },
      }),
    )
    spies.health.mockImplementation(async () => ({
      tmdb: 'ok',
      omdb: 'off',
      pending: 0,
      error: null,
      lastOk: null,
    }))
    spies.match.mockImplementation(async () =>
      library({ id: 2, name: 'TV', settings: { ...library().settings, kind: 'shows' } }),
    )
    spies.shows.mockImplementation(async () => ({
      shows: [showEntry()],
      unmatched: [mediaItem({ id: 30, title: 'Unknown Show - S01E01', match: 'unmatched' })],
    }))
    renderWithProviders(
      <Routes>
        <Route path="libraries/:id" element={<LibraryPage />} />
        <Route path="watch/:id" element={<Watching />} />
      </Routes>,
      { route: '/libraries/2' },
    )
  }

  it('lists shows as posters, with the files no show was found for after', async () => {
    serve()
    expect(await screen.findByRole('link', { name: 'Severance' })).toHaveAttribute(
      'href',
      '/shows/4',
    )
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)
    expect(headings).toEqual(['Matched, 1 show', 'Not matched, 1 video'])
    expect(screen.getByText('Matched').closest('details')).not.toHaveAttribute('open')
    expect(screen.getByText('TV shows · 12 videos · 1 not matched')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Unknown Show - S01E01' })).toHaveAttribute(
      'href',
      '/watch/30',
    )
    expect(spies.list).not.toHaveBeenCalled()
  })

  it('asks the server to match the files no show was found for again', async () => {
    serve()
    await screen.findByText('Not matched')
    const button = screen.getByRole('button', { name: 'Match again' })
    await waitFor(() => expect(button).toBeEnabled())
    await userEvent.click(button)
    expect(spies.match).toHaveBeenCalledWith(2)
  })

  it('reads the count of files not matched again once the matching pass settles', async () => {
    serve()
    await screen.findByText('TV shows · 12 videos · 1 not matched')
    // Match again sends the file back to pending, and the pass leaves it unmatched again.
    spies.match.mockImplementation(async () =>
      library({
        id: 2,
        name: 'TV',
        unmatchedCount: 0,
        settings: { ...library().settings, kind: 'shows' },
      }),
    )
    spies.shows.mockImplementationOnce(async () => ({
      shows: [showEntry()],
      unmatched: [mediaItem({ id: 30, title: 'Unknown Show - S01E01', match: 'pending' })],
    }))
    const button = screen.getByRole('button', { name: 'Match again' })
    await waitFor(() => expect(button).toBeEnabled())
    await userEvent.click(button)
    expect(await screen.findByText('TV shows · 12 videos')).toBeInTheDocument()
    // The listing polls while a file is pending; once none is, the library is read again.
    expect(
      await screen.findByText('TV shows · 12 videos · 1 not matched', {}, { timeout: 5000 }),
    ).toBeInTheDocument()
  }, 10_000)

  it('lays the shows out as a list when asked, each row playable', async () => {
    serve({ view: 'list' })
    await userEvent.click(await screen.findByText('Matched'))
    const table = await screen.findByRole('table', { name: 'Shows' })
    expect(within(table).getByRole('link', { name: 'Severance' })).toHaveAttribute(
      'href',
      '/shows/4',
    )
    expect(within(table).getByRole('link', { name: 'Play Severance S01E02' })).toHaveAttribute(
      'href',
      '/watch/12',
    )
  })

  it('lays the shows out as tiles when asked', async () => {
    serve({ view: 'tiles' })
    await userEvent.click(await screen.findByText('Matched'))
    const tiles = await screen.findByRole('list', { name: 'Shows' })
    expect(within(tiles).getByRole('link', { name: 'Severance' })).toHaveAttribute(
      'href',
      '/shows/4',
    )
    expect(within(tiles).getByText('9 episodes')).toBeInTheDocument()
  })

  it('offers no file sorts and no grouped view, and plays the next episode', async () => {
    serve()
    await screen.findByRole('link', { name: 'Severance' })
    const sorts = within(screen.getByLabelText('Sort'))
      .getAllByRole('option')
      .map((o) => o.textContent)
    expect(sorts).toContain('Newest release')
    expect(sorts).not.toContain('Largest file')
    expect(screen.queryByRole('button', { name: 'Grouped' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Play' }))
    expect(screen.getByText('Watching 12')).toBeInTheDocument()
  })
})
