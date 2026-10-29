import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test'
import {
  DEFAULT_SAGA_BACKDROP,
  type LibraryKind,
  type LibrarySettings,
  type MediaItem,
} from '@raven/core'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { api } from '@/lib/api'
import {
  itemSummary,
  library,
  libraryCounts,
  matchedMovie,
  mediaItem,
  metadataHealth,
  showEntry,
} from '@/test/fixtures'
import { renderLibraryPage } from '@/test/libraryPage'

type FileProps = { id: number; title: string; duration?: number }

const file = ({ id, title, duration = 60 }: FileProps) => mediaItem({ id, title, duration })

type MovieProps = { id: number; title: string }

const movie = ({ id, title }: MovieProps) =>
  matchedMovie({ id, title, item: itemSummary({ id: id * 10, title }) })

const bar = () => screen.getByRole('region', { name: 'Selection' })
const noBar = () => screen.queryByRole('region', { name: 'Selection' })
const count = () => within(bar()).getByRole('status')

describe('LibraryPage select mode', () => {
  const spies = {
    get: spyOn(api, 'getLibrary'),
    list: spyOn(api, 'listMedia'),
    shows: spyOn(api, 'listShows'),
    inProgress: spyOn(api, 'listInProgress'),
    favourites: spyOn(api, 'listLibraryFavourites'),
    sagas: spyOn(api, 'listSagas'),
    history: spyOn(api, 'listHistory'),
    health: spyOn(api, 'getMetadataHealth'),
    set: spyOn(api, 'setWatched'),
    counts: spyOn(api, 'getLibraryCounts'),
  }

  beforeEach(() => {
    spies.inProgress.mockImplementation(async () => [])
    spies.favourites.mockImplementation(async () => [])
    spies.sagas.mockImplementation(async () => [])
    spies.history.mockImplementation(async () => [])
    spies.health.mockImplementation(async () => metadataHealth())
    spies.set.mockImplementation(async () => undefined)
    spies.counts.mockImplementation(async () => libraryCounts())
  })

  afterEach(() => Object.values(spies).forEach((spy) => spy.mockReset()))

  type OpenProps = {
    kind?: LibraryKind
    route?: string
    settings?: Partial<LibrarySettings>
    items?: MediaItem[]
  }

  const open = ({
    kind = 'other',
    route = '/libraries/2',
    settings = {},
    items = [file({ id: 1, title: 'Alpha' }), file({ id: 2, title: 'Bravo' })],
  }: OpenProps = {}) => {
    spies.get.mockImplementation(async () =>
      library({ id: 2, name: 'Films', settings: { ...library().settings, kind, ...settings } }),
    )
    spies.list.mockImplementation(async () => items)
    renderLibraryPage({ route })
  }

  it('starts from the Select button in the toolbar, and a click selects instead of opening', async () => {
    open()
    await screen.findByRole('link', { name: 'Alpha' })
    await userEvent.click(screen.getByRole('button', { name: 'Select' }))
    expect(count()).toHaveTextContent('0 selected')
    await userEvent.click(screen.getByRole('link', { name: 'Alpha' }))
    expect(count()).toHaveTextContent('1 selected')
    expect(screen.getByRole('checkbox', { name: 'Select Alpha' })).toBeChecked()
    expect(screen.getByTestId('address')).toHaveTextContent('/libraries/2')
    expect(screen.queryByText(/Watching/)).not.toBeInTheDocument()
  })

  it('opens a card as before when not selecting', async () => {
    open()
    await userEvent.click(await screen.findByRole('link', { name: 'Alpha' }))
    expect(await screen.findByText('Watching 1')).toBeInTheDocument()
  })

  it('starts select mode with a card from its hover checkbox', async () => {
    open()
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Select Bravo' }))
    expect(count()).toHaveTextContent('1 selected')
    expect(screen.getByRole('checkbox', { name: 'Select Bravo' })).toBeChecked()
    expect(screen.getByRole('button', { name: 'Select' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('hides the play button and the menu of a card while selecting', async () => {
    open({ kind: 'movies', items: [movie({ id: 7, title: 'Heat' })] })
    expect(await screen.findByRole('link', { name: 'Play Heat' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Options for Heat/ })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Select' }))
    expect(screen.queryByRole('link', { name: 'Play Heat' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Options for/ })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(screen.getByRole('link', { name: 'Play Heat' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Options for Heat/ })).toBeInTheDocument()
  })

  it('selects a range in the order a sorted list shows, not the order of the data', async () => {
    open({
      route: '/libraries/2?view=list',
      items: [
        file({ id: 1, title: 'Alpha', duration: 30 }),
        file({ id: 2, title: 'Bravo', duration: 10 }),
        file({ id: 3, title: 'Charlie', duration: 40 }),
        file({ id: 4, title: 'Delta', duration: 20 }),
      ],
    })
    await screen.findByRole('link', { name: 'Alpha' })
    // Longest first: Charlie, Alpha, Delta, Bravo.
    await userEvent.click(screen.getByRole('button', { name: 'Length' }))
    expect(
      within(screen.getByRole('table'))
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['Charlie', 'Alpha', 'Delta', 'Bravo'])
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Select' }))
    await user.click(screen.getByRole('link', { name: 'Charlie' }))
    await user.keyboard('{Shift>}')
    await user.click(screen.getByRole('link', { name: 'Delta' }))
    await user.keyboard('{/Shift}')
    expect(count()).toHaveTextContent('3 selected')
    expect(screen.getByRole('checkbox', { name: 'Select Alpha' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Select Bravo' })).not.toBeChecked()
  })

  it('selects all, the cards in closed buckets included', async () => {
    open({
      settings: { groupBy: 'resolution' },
      route: '/libraries/2?view=grouped',
      items: [
        mediaItem({ id: 1, title: 'Wide', width: 3840, height: 2160 }),
        mediaItem({ id: 2, title: 'Full', width: 1920, height: 1080 }),
        mediaItem({ id: 3, title: 'Also full', width: 1920, height: 800 }),
      ],
    })
    await screen.findByRole('link', { name: 'Wide' })
    await userEvent.click(screen.getByRole('button', { name: 'Select' }))
    await userEvent.click(screen.getByRole('button', { name: 'Select all' }))
    expect(count()).toHaveTextContent('3 selected')
  })

  it('sends a show and a file together as one request, each as its own kind of target', async () => {
    spies.get.mockImplementation(async () =>
      library({
        id: 2,
        name: 'TV',
        unmatchedCount: 1,
        settings: { ...library().settings, kind: 'shows' },
      }),
    )
    spies.shows.mockImplementation(async () => ({
      shows: [showEntry()],
      unmatched: [
        mediaItem({
          id: 30,
          title: 'Unknown Show - S01E01',
          fileName: 'Unknown Show - S01E01.mkv',
          match: 'unmatched',
        }),
      ],
    }))
    renderLibraryPage()
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Select Severance' }))
    await userEvent.click(screen.getByText('Not matched', { selector: 'h2' }))
    await userEvent.click(screen.getByRole('button', { name: /^Unknown Show/ }))
    await userEvent.click(screen.getByRole('checkbox', { name: /^Select Unknown Show/ }))
    expect(count()).toHaveTextContent('2 selected')
    await userEvent.click(screen.getByRole('button', { name: 'Mark watched' }))
    await waitFor(() => expect(count()).toHaveTextContent('Marked 2 watched'))
    expect(spies.set).toHaveBeenCalledTimes(1)
    expect(spies.set).toHaveBeenCalledWith({
      watched: true,
      targets: [
        { kind: 'item', id: 4, libraryId: 2 },
        { kind: 'media', id: 30 },
      ],
    })
  })

  it('gives every other tab a Select that works the same', async () => {
    spies.inProgress.mockImplementation(async () => [
      { media: movie({ id: 7, title: 'Heat' }), poster: null },
    ])
    open({ kind: 'movies', route: '/libraries/2/in-progress' })
    await userEvent.click(await screen.findByRole('button', { name: 'Select' }))
    await userEvent.click(screen.getByRole('link', { name: 'Heat' }))
    await userEvent.click(screen.getByRole('button', { name: 'Mark unwatched' }))
    await waitFor(() => expect(count()).toHaveTextContent('Marked 1 unwatched'))
    expect(spies.set).toHaveBeenCalledWith({ watched: false, targets: [{ kind: 'media', id: 7 }] })
  })

  it('selects a favourite', async () => {
    spies.favourites.mockImplementation(async () => [
      { media: movie({ id: 7, title: 'Heat' }), poster: null },
    ])
    open({ kind: 'movies', route: '/libraries/2/favourites' })
    await userEvent.click(await screen.findByRole('button', { name: 'Select' }))
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Heat' }))
    expect(count()).toHaveTextContent('1 selected')
  })

  it('selects a finished video from Recently finished', async () => {
    spies.history.mockImplementation(async () => [
      {
        media: movie({ id: 7, title: 'Heat' }),
        lastPlayedAt: new Date().toISOString(),
        plays: 1,
        furthest: 100,
        watched: true,
        marked: false,
      },
    ])
    open({ kind: 'movies', route: '/libraries/2/finished' })
    await userEvent.click(await screen.findByRole('button', { name: 'Select' }))
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Heat' }))
    expect(count()).toHaveTextContent('1 selected')
  })

  it("sends a saga's movies when its deck is selected", async () => {
    spies.sagas.mockImplementation(async () => [
      {
        tmdbId: '119',
        name: 'The Rings',
        backdrop: DEFAULT_SAGA_BACKDROP,
        media: [movie({ id: 7, title: 'Fellowship' }), movie({ id: 8, title: 'Towers' })],
      },
    ])
    open({ kind: 'movies', route: '/libraries/2/sagas' })
    await userEvent.click(await screen.findByRole('button', { name: 'Select' }))
    await userEvent.click(screen.getByRole('link', { name: /The Rings/ }))
    expect(screen.getByTestId('address')).toHaveTextContent('/libraries/2/sagas')
    await userEvent.click(screen.getByRole('button', { name: 'Mark watched' }))
    await waitFor(() => expect(count()).toHaveTextContent('Marked 1 watched'))
    expect(spies.set).toHaveBeenCalledWith({
      watched: true,
      targets: [
        { kind: 'item', id: 70, libraryId: 2 },
        { kind: 'item', id: 80, libraryId: 2 },
      ],
    })
  })

  it('ends select mode when the tab changes', async () => {
    open({ kind: 'movies' })
    await userEvent.click(await screen.findByRole('button', { name: 'Select' }))
    expect(bar()).toBeInTheDocument()
    await userEvent.click(screen.getByRole('link', { name: 'Favourites' }))
    await screen.findByText(/No favourites in Films yet/)
    expect(noBar()).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('link', { name: 'All' }))
    await screen.findByRole('link', { name: 'Alpha' })
    expect(noBar()).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Select' })).toHaveAttribute('aria-pressed', 'false')
  })

  it.each(['grid', 'list', 'tiles'] as const)(
    'selects a show from the %s view, without opening it',
    async (view) => {
      spies.get.mockImplementation(async () =>
        library({ id: 2, name: 'TV', settings: { ...library().settings, kind: 'shows', view } }),
      )
      spies.shows.mockImplementation(async () => ({ shows: [showEntry()], unmatched: [] }))
      renderLibraryPage()
      await userEvent.click(await screen.findByRole('button', { name: 'Select' }))
      await userEvent.click(screen.getByRole('link', { name: 'Severance' }))
      expect(count()).toHaveTextContent('1 selected')
      expect(screen.getByRole('checkbox', { name: 'Select Severance' })).toBeChecked()
      expect(screen.getByTestId('address')).toHaveTextContent('/libraries/2')
    },
  )

  it('selects a file from the tiles view', async () => {
    open({ route: '/libraries/2?view=tiles' })
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Select Alpha' }))
    expect(count()).toHaveTextContent('1 selected')
  })

  it('keeps one tab stop per card while selecting, and none from the hover checkboxes before', async () => {
    open({
      items: [
        file({ id: 1, title: 'Alpha' }),
        file({ id: 2, title: 'Bravo' }),
        file({ id: 3, title: 'Charlie' }),
      ],
    })
    await screen.findByRole('link', { name: 'Alpha' })
    screen.getAllByRole('checkbox').forEach((box) => expect(box).toHaveAttribute('tabindex', '-1'))
    await userEvent.click(screen.getByRole('button', { name: 'Select' }))
    screen.getAllByRole('link', { name: /Alpha|Bravo|Charlie/ }).forEach((link) => {
      expect(link).toHaveAttribute('tabindex', '-1')
    })
    screen.getAllByRole('checkbox').forEach((box) => expect(box).toHaveAttribute('tabindex', '0'))
    act(() => screen.getByRole('checkbox', { name: 'Select Alpha' }).focus())
    await userEvent.tab()
    expect(screen.getByRole('checkbox', { name: 'Select Bravo' })).toHaveFocus()
    await userEvent.tab()
    expect(screen.getByRole('checkbox', { name: 'Select Charlie' })).toHaveFocus()
    await userEvent.tab()
    expect(screen.getByRole('button', { name: 'Select all' })).toHaveFocus()
  })
})
