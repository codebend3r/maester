import { afterEach, describe, expect, it, spyOn } from 'bun:test'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type {
  AdminLock,
  Library,
  LibrarySettings,
  LibraryViewChange,
  MediaItem,
  MediaSort,
} from '@raven/core'
import { api } from '@/lib/api'
import { useUnlockPrompt } from '@/stores/unlockPrompt'
import { library, mediaItem, metadataHealth, showEntry } from '@/test/fixtures'
import { held } from '@/test/held'
import { renderLibraryPage } from '@/test/libraryPage'
import { pollFast } from '@/test/polls'

const WIDE = mediaItem({ id: 1, title: 'Wide', width: 3840, height: 2160 })
const FULL = mediaItem({ id: 2, title: 'Full', width: 1920, height: 1080 })
const ITEMS = [WIDE, FULL, mediaItem({ id: 3, title: 'Also full', width: 1920, height: 800 })]

describe('LibraryPage', () => {
  const spies = {
    get: spyOn(api, 'getLibrary'),
    list: spyOn(api, 'listMedia'),
    view: spyOn(api, 'setLibraryView'),
    lockState: spyOn(api, 'getLock'),
    lock: spyOn(api, 'lock'),
  }
  const state: { sent: LibraryViewChange[]; listed: Array<{ sort?: MediaSort; seed?: number }> } = {
    sent: [],
    listed: [],
  }

  /** Serves one library whose settings change as the page saves them. */
  const serve = ({
    settings = {},
    items = ITEMS,
    route = '/libraries/2',
    adminLock,
  }: {
    settings?: Partial<LibrarySettings>
    items?: MediaItem[]
    route?: string
    adminLock?: AdminLock
  } = {}) => {
    const current: { library: Library } = {
      library: library({ id: 2, settings: { ...library().settings, ...settings } }),
    }
    spies.get.mockImplementation(async () => current.library)
    spies.list.mockImplementation(async (request) => {
      state.listed.push({ sort: request.sort, seed: request.seed })
      return items
    })
    spies.view.mockImplementation(async ({ change }) => {
      state.sent.push(change)
      current.library = {
        ...current.library,
        settings: { ...current.library.settings, ...change },
      }
      return current.library
    })
    renderLibraryPage({ route, adminLock })
  }

  afterEach(() => {
    spies.get.mockReset()
    spies.list.mockReset()
    spies.view.mockReset()
    spies.lockState.mockReset()
    spies.lock.mockReset()
    state.sent = []
    state.listed = []
  })

  it('opens on what the libraries list knows while the library itself is read', async () => {
    spies.get.mockImplementation(() => held<Library>().promise)
    spies.list.mockImplementation(() => held<MediaItem[]>().promise)
    renderLibraryPage({ libraries: [library({ id: 2, name: 'Films' })] })
    expect(await screen.findByRole('heading', { level: 1, name: 'Films' })).toBeInTheDocument()
    expect(screen.getByText('Gathering the videos')).toBeInTheDocument()
  })

  it('puts the icon the side menu shows beside the name', async () => {
    spies.get.mockImplementation(() => held<Library>().promise)
    spies.list.mockImplementation(() => held<MediaItem[]>().promise)
    renderLibraryPage({
      libraries: [
        library({
          id: 2,
          name: 'UFC',
          settings: { ...library().settings, kind: 'sports', icon: 'octagon' },
        }),
      ],
    })
    const title = await screen.findByRole('heading', { level: 1, name: 'UFC' })
    expect(title.querySelector('svg')?.dataset.icon).toBe('octagon')
  })

  it('stands in for the library while it is read, with nothing of it known yet', async () => {
    spies.get.mockImplementation(() => held<Library>().promise)
    renderLibraryPage()
    expect(await screen.findByText('Opening the library')).toBeInTheDocument()
  })

  it('says why its videos could not be read', async () => {
    spies.get.mockImplementation(async () => library({ id: 2 }))
    spies.list.mockImplementation(async () => {
      throw new Error('The server is away.')
    })
    renderLibraryPage()
    expect(await screen.findByRole('alert')).toHaveTextContent('The server is away.')
  })

  it('opens in the view and sort the library was left in', async () => {
    serve({ settings: { view: 'list', sort: 'largest' } })
    expect(await screen.findByRole('table', { name: 'Videos' })).toBeInTheDocument()
    expect(screen.getByLabelText('Sort')).toHaveValue('size')
    expect(screen.getByRole('button', { name: 'Order: Largest first' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'List' })).toHaveAttribute('aria-pressed', 'true')
    expect(state.listed.at(-1)?.sort).toBe('largest')
  })

  it('shows on each card the value the library is sorted by', async () => {
    serve({ settings: { view: 'grid', sort: 'largest' } })
    expect(await screen.findAllByText('1.6 GB')).toHaveLength(ITEMS.length)
  })

  it('opens on the search, sort, view and grouping the address carries', async () => {
    serve({
      settings: { view: 'grid', sort: 'title' },
      route: '/libraries/2?q=wide&sort=largest&view=list&group=codec',
    })
    expect(await screen.findByRole('table', { name: 'Videos' })).toBeInTheDocument()
    expect(screen.getByLabelText('Search Movies')).toHaveValue('wide')
    expect(screen.getByLabelText('Sort')).toHaveValue('size')
    expect(state.listed.at(-1)?.sort).toBe('largest')
    expect(spies.list.mock.calls.at(-1)?.[0]?.search).toBe('wide')
  })

  it('writes each change of view and the search into the address', async () => {
    serve()
    await screen.findByRole('link', { name: 'Wide' })
    await userEvent.click(screen.getByRole('button', { name: 'List' }))
    await userEvent.selectOptions(screen.getByLabelText('Sort'), 'File size')
    expect(screen.getByTestId('address').textContent).toBe('/libraries/2?view=list&sort=largest')
    await userEvent.type(screen.getByLabelText('Search Movies'), 'wide')
    await waitFor(() =>
      expect(screen.getByTestId('address').textContent).toBe(
        '/libraries/2?view=list&sort=largest&q=wide',
      ),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Grid' }))
    expect(screen.getByTestId('address').textContent).toBe(
      '/libraries/2?view=grid&sort=largest&q=wide',
    )
  })

  it('saves a new sort to the library, highest first to start, and lists in that order', async () => {
    serve()
    await screen.findByRole('link', { name: 'Wide' })
    await userEvent.selectOptions(screen.getByLabelText('Sort'), 'Bitrate')
    expect(state.sent).toEqual([{ sort: 'bitrate-high' }])
    expect(state.listed.at(-1)?.sort).toBe('bitrate-high')
  })

  it('turns the order around with the button beside the sort', async () => {
    serve({ settings: { sort: 'title' } })
    await screen.findByRole('link', { name: 'Wide' })
    await userEvent.click(screen.getByRole('button', { name: 'Order: A to Z' }))
    expect(state.sent.at(-1)).toEqual({ sort: 'title-desc' })
    expect(await screen.findByRole('button', { name: 'Order: Z to A' })).toBeInTheDocument()
    expect(state.listed.at(-1)?.sort).toBe('title-desc')
  })

  it('has no order to turn around while random', async () => {
    serve({ settings: { sort: 'random' } })
    await screen.findByRole('link', { name: 'Wide' })
    expect(screen.getByLabelText('Sort')).toHaveValue('random')
    expect(screen.queryByRole('button', { name: /^Order:/ })).toBeNull()
  })

  it('switches the view straight away and saves it', async () => {
    serve()
    await screen.findByRole('link', { name: 'Wide' })
    await userEvent.click(screen.getByRole('button', { name: 'Tiles' }))
    expect(screen.getByRole('button', { name: 'Tiles' })).toHaveAttribute('aria-pressed', 'true')
    expect(state.sent.at(-1)).toEqual({ view: 'tiles' })
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
    expect(state.sent.at(-1)).toEqual({ groupBy: 'codec' })
  })

  it('folds every bucket to start, and opens one on a click', async () => {
    serve({ settings: { view: 'grouped', groupBy: 'resolution' } })
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
    serve({
      settings: { view: 'grouped', groupBy: 'match', kind: 'movies' },
      items: [
        mediaItem({ id: 1, title: 'Found', match: 'matched' }),
        mediaItem({ id: 2, title: 'Lost', match: 'unmatched' }),
        mediaItem({ id: 3, title: 'Also found', match: 'manual' }),
      ],
    })
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
    serve({ settings: { view: 'grouped', groupBy: 'resolution', kind: 'other' } })
    await screen.findByRole('link', { name: 'Wide' })
    const groupings = within(screen.getByLabelText('Group by'))
      .getAllByRole('option')
      .map((option) => option.textContent)
    expect(groupings).not.toContain('Matched or not')
  })

  it('shows the grouping an Other library really uses when the address asks for match', async () => {
    serve({ settings: { kind: 'other' }, route: '/libraries/2?view=grouped&group=match' })
    await screen.findByRole('link', { name: 'Wide' })
    const select = screen.getByLabelText('Group by')
    expect(select).toHaveValue('resolution')
    expect(within(select).getByRole('option', { selected: true })).toHaveTextContent('Resolution')
    expect(
      screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent),
    ).toEqual(['4K, 1 video', '1080p, 2 videos'])
  })

  it('plays the first video in the order shown', async () => {
    serve({ settings: { sort: 'largest' } })
    await screen.findByRole('link', { name: 'Wide' })
    await userEvent.click(screen.getByRole('button', { name: 'Play' }))
    expect(await screen.findByText('Watching 1')).toBeInTheDocument()
  })

  it('plays the first video of the first bucket in the grouped view', async () => {
    serve({ settings: { view: 'grouped' }, items: [FULL, WIDE] })
    await screen.findByRole('link', { name: 'Wide' })
    await userEvent.click(screen.getByRole('button', { name: 'Play' }))
    expect(await screen.findByText('Watching 1')).toBeInTheDocument()
  })

  it('shuffles to a random video whatever the sort', async () => {
    serve({ settings: { sort: 'title' } })
    await screen.findByRole('link', { name: 'Wide' })
    const random = spyOn(Math, 'random').mockReturnValue(0.9)
    await userEvent.click(screen.getByRole('button', { name: 'Shuffle' }))
    random.mockRestore()
    expect(await screen.findByText('Watching 3')).toBeInTheDocument()
  })

  it('offers the letters of its titles down the side', async () => {
    serve({ settings: { sort: 'title', view: 'grid' } })
    const picker = await screen.findByRole('navigation', { name: 'Jump to a letter' })
    const enabled = within(picker)
      .getAllByRole('button')
      .filter((button) => !button.hasAttribute('disabled'))
      .map((button) => button.textContent)
    expect(enabled).toEqual(['A', 'F', 'W'])
  })

  it('steps through what the listing is sorted by, a movie library grouped included', async () => {
    serve({ settings: { kind: 'movies', sort: 'resolution-high', view: 'grouped' } })
    const picker = await screen.findByRole('navigation', { name: 'Jump to a resolution' })
    const enabled = within(picker)
      .getAllByRole('button')
      .filter((button) => !button.hasAttribute('disabled'))
      .map((button) => button.textContent)
    expect(enabled).toEqual(['4K', '1080'])
    expect(screen.queryByRole('navigation', { name: 'Jump to a letter' })).toBeNull()
  })

  it('has no strip down the side in a random order, which has nothing to jump by', async () => {
    serve({ settings: { sort: 'random', view: 'grid' } })
    await screen.findByRole('link', { name: 'Wide' })
    expect(screen.queryByRole('navigation', { name: /^Jump to/ })).toBeNull()
  })

  it('says what type of library it is', async () => {
    serve({ settings: { kind: 'movies' } })
    expect(await screen.findByText('Movies · 12 videos')).toBeInTheDocument()
  })

  it("links to the library's history", async () => {
    serve()
    expect(await screen.findByRole('link', { name: 'History Movies' })).toHaveAttribute(
      'href',
      '/libraries/2/history',
    )
  })

  it('leaves Rescan, Match again and Edit out while the admin lock is on', async () => {
    serve({ settings: { kind: 'movies' }, adminLock: { state: 'on', available: true } })
    expect(await screen.findByRole('link', { name: /^History/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Rescan/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Match again/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Edit/ })).toBeNull()
  })

  it('still saves how the library is shown while the admin lock is on', async () => {
    serve({ adminLock: { state: 'on', available: true } })
    await screen.findByRole('link', { name: 'Wide' })
    await userEvent.click(screen.getByRole('button', { name: 'Tiles' }))
    expect(state.sent).toEqual([{ view: 'tiles' }])
  })

  it('has nothing to play or shuffle in an empty library', async () => {
    serve({ items: [] })
    await screen.findByText(/No videos in these folders yet/)
    expect(screen.getByRole('button', { name: 'Play' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Shuffle' })).toBeDisabled()
  })

  it('keeps a locked library shut, asking for nothing, until the PIN is entered', async () => {
    spies.lockState.mockImplementation(async () => ({ available: true, unlocked: false }))
    serve({ settings: { locked: true } })
    const locked = await screen.findByRole('region', { name: 'Locked' })
    expect(locked).toHaveTextContent('Movies is locked.')
    expect(screen.queryByRole('search')).toBeNull()
    expect(state.listed).toEqual([])
    await userEvent.click(within(locked).getByRole('button', { name: 'Unlock' }))
    expect(useUnlockPrompt.getState().open).toBe(true)
  })

  it('asks for the PIN on Edit while the library is locked, as its folders are held back', async () => {
    spies.lockState.mockImplementation(async () => ({ available: true, unlocked: false }))
    serve({ settings: { locked: true } })
    await screen.findByRole('region', { name: 'Locked' })
    await userEvent.click(screen.getByRole('button', { name: 'Edit Movies' }))
    expect(useUnlockPrompt.getState().open).toBe(true)
    expect(screen.queryByRole('dialog')).toBeNull()
    useUnlockPrompt.setState({ open: false })
  })

  it('shows an unlocked library, with a way to lock it again', async () => {
    spies.lockState.mockImplementation(async () => ({ available: true, unlocked: true }))
    spies.lock.mockImplementation(async () => ({ available: true, unlocked: false }))
    serve({ settings: { locked: true } })
    expect(await screen.findByRole('link', { name: /Wide/ })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Lock' }))
    expect(spies.lock).toHaveBeenCalledTimes(1)
  })
})

describe('LibraryPage for TV shows', () => {
  const unknownEpisode = (match: 'unmatched' | 'pending') =>
    mediaItem({
      id: 30,
      title: 'Unknown Show - S01E01',
      folder: 'Unknown Show/Season 1',
      fileName: 'Unknown Show - S01E01.mkv',
      match,
    })

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
    spies.health.mockImplementation(async () => metadataHealth())
    spies.match.mockImplementation(async () =>
      library({ id: 2, name: 'TV', settings: { ...library().settings, kind: 'shows' } }),
    )
    spies.shows.mockImplementation(async () => ({
      shows: [showEntry()],
      unmatched: [unknownEpisode('unmatched')],
    }))
    renderLibraryPage()
  }

  it('lists shows as posters, with the files no show was found for after', async () => {
    serve()
    expect(await screen.findByRole('link', { name: 'Severance' })).toHaveAttribute(
      'href',
      '/shows/4',
    )
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)
    expect(headings).toEqual(['Matched, 1 show', 'Not matched, 1 show'])
    expect(screen.getByText('Matched').closest('details')).not.toHaveAttribute('open')
    expect(screen.getByText('TV shows · 12 videos · 1 not matched')).toBeInTheDocument()
    await userEvent.click(screen.getByText('Not matched', { selector: 'h2' }))
    expect(screen.getByRole('button', { name: 'Fix match for Unknown Show' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /^Unknown Show/ }))
    expect(screen.getByRole('link', { name: 'Unknown Show - S01E01' })).toHaveAttribute(
      'href',
      '/watch/30',
    )
    expect(spies.list).not.toHaveBeenCalled()
  })

  it('lists an Anime shows library as its shows, the same way', async () => {
    serve({ kind: 'animeShows' })
    expect(await screen.findByRole('link', { name: 'Severance' })).toHaveAttribute(
      'href',
      '/shows/4',
    )
    expect(screen.getByText('Anime shows · 12 videos · 1 not matched')).toBeInTheDocument()
    expect(spies.list).not.toHaveBeenCalled()
  })

  it('asks the server to match the files no show was found for again', async () => {
    serve()
    await screen.findByText('Not matched')
    const button = screen.getByRole('button', { name: 'Match again TV' })
    await waitFor(() => expect(button).toBeEnabled())
    await userEvent.click(button)
    expect(spies.match).toHaveBeenCalledWith(2)
  })

  it('reads the count of files not matched again once the matching pass settles', async () => {
    pollFast()
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
      unmatched: [unknownEpisode('pending')],
    }))
    const button = screen.getByRole('button', { name: 'Match again TV' })
    await waitFor(() => expect(button).toBeEnabled())
    await userEvent.click(button)
    expect(await screen.findByText('TV shows · 12 videos')).toBeInTheDocument()
    // The listing polls while a file is pending; once none is, the library is read again.
    expect(await screen.findByText('TV shows · 12 videos · 1 not matched')).toBeInTheDocument()
  })

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
    expect(sorts).toContain('Release date')
    expect(sorts).not.toContain('File size')
    expect(screen.queryByRole('button', { name: 'Grouped' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Play' }))
    expect(screen.getByText('Watching 12')).toBeInTheDocument()
  })
})
