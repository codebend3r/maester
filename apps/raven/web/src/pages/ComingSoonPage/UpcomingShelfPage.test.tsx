import { afterEach, describe, expect, it, spyOn } from 'bun:test'
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import {
  ITEM_TYPES,
  type MatchItemType,
  REQUEST_STATUSES,
  type TitleRequests,
  UPCOMING_SHELVES,
  type UpcomingPage,
  type UpcomingShelf,
  type UpcomingTitle,
} from '@raven/core'
import { api } from '@/lib/api'
import { COMING_SOON_COPY } from '@/pages/ComingSoonPage/copy'
import { HIDE_REQUESTED_SEARCH } from '@/pages/ComingSoonPage/useHideRequested'
import { useUpcomingFilter } from '@/stores/upcomingFilter'
import { UpcomingShelfPage } from '@/pages/ComingSoonPage/UpcomingShelfPage'
import { renderWithProviders } from '@/test/render'
import { moveOnScreen, startOnScreen } from '@/test/viewport'

const getUpcomingShelf = spyOn(api, 'getUpcomingShelf')
const listRequests = spyOn(api, 'listRequests')
const getRequestHolding = spyOn(api, 'getRequestHolding')

const NO_REQUESTS: TitleRequests = {
  requests: [],
  budget: { limit: 10, left: 10, nextAt: null },
  kinds: { movie: true, show: true },
}

type TitleProps = { type: MatchItemType; id: number }

const title = ({ type, id }: TitleProps): UpcomingTitle => ({
  type,
  tmdbId: String(id),
  title: `Title ${id}`,
  released: '2026-12-25',
  poster: `/poster${id}.jpg`,
})

/** The shelf's pages, by the cursor each is asked with. */
const answer = (pages: Record<string, UpcomingPage>) =>
  getUpcomingShelf.mockImplementation(async ({ after }) => {
    const page = pages[after ?? 'first']
    if (page === undefined) throw new Error(`No page after ${after}`)
    return page
  })

const open = (shelf: UpcomingShelf) =>
  renderWithProviders({ ui: <UpcomingShelfPage shelf={shelf} /> })

const cardNames = (): string[] =>
  within(screen.getByRole('list'))
    .getAllByRole('link')
    .map((link) => link.textContent ?? '')

describe('UpcomingShelfPage', () => {
  afterEach(() => {
    cleanup()
    getUpcomingShelf.mockReset()
    listRequests.mockReset()
    getRequestHolding.mockReset()
    startOnScreen(true)
    useUpcomingFilter.setState({ isHidingRequested: false })
  })

  it('shows the shelf, each card opening its own page', async () => {
    answer({ first: { titles: [title({ type: ITEM_TYPES.movie, id: 1 })], next: null } })
    open(UPCOMING_SHELVES.movies)
    expect(
      await screen.findByRole('heading', { name: 'Upcoming movies', level: 1 }),
    ).toBeInTheDocument()
    const card = await screen.findByRole('link', { name: 'Title 1' })
    expect(card).toHaveAttribute('href', '/coming-soon/movie/1')
    expect(getUpcomingShelf).toHaveBeenCalledWith({ shelf: UPCOMING_SHELVES.movies, after: null })
  })

  it('reads the next page once the end of the list is in reach, and each title once', async () => {
    startOnScreen(false)
    answer({
      first: { titles: [title({ type: ITEM_TYPES.show, id: 1 })], next: 'second' },
      second: {
        titles: [title({ type: ITEM_TYPES.show, id: 1 }), title({ type: ITEM_TYPES.show, id: 2 })],
        next: null,
      },
    })
    const { container } = open(UPCOMING_SHELVES.shows)
    await screen.findByRole('link', { name: 'Title 1' })
    expect(getUpcomingShelf).toHaveBeenCalledTimes(1)
    const end = container.querySelector('[aria-hidden="true"]:empty')
    if (end === null) throw new Error('No end of the list to watch')
    moveOnScreen({ target: end, isOnScreen: true })
    await screen.findByRole('link', { name: 'Title 2' })
    expect(cardNames()).toEqual(['Title 1', 'Title 2'])
    expect(getUpcomingShelf).toHaveBeenLastCalledWith({
      shelf: UPCOMING_SHELVES.shows,
      after: 'second',
    })
  })

  it('keeps reading while a short page leaves the end in reach', async () => {
    answer({
      first: { titles: [], next: 'second' },
      second: { titles: [title({ type: ITEM_TYPES.movie, id: 5 })], next: null },
    })
    open(UPCOMING_SHELVES.movies)
    await screen.findByRole('link', { name: 'Title 5' })
    await waitFor(() => expect(getUpcomingShelf).toHaveBeenCalledTimes(2))
  })

  it('says which kind each documentary is', async () => {
    answer({
      first: {
        titles: [title({ type: ITEM_TYPES.movie, id: 1 }), title({ type: ITEM_TYPES.show, id: 2 })],
        next: null,
      },
    })
    open(UPCOMING_SHELVES.documentaries)
    await screen.findByRole('link', { name: 'Title 2' })
    expect(screen.getByText('Movie')).toBeInTheDocument()
    expect(screen.getByText('TV show')).toBeInTheDocument()
  })

  it('says which kind each anime is, on a shelf of its own', async () => {
    answer({
      first: {
        titles: [title({ type: ITEM_TYPES.movie, id: 1 }), title({ type: ITEM_TYPES.show, id: 2 })],
        next: null,
      },
    })
    open(UPCOMING_SHELVES.anime)
    expect(
      await screen.findByRole('heading', { name: COMING_SOON_COPY.shelves.anime.title, level: 1 }),
    ).toBeInTheDocument()
    await screen.findByRole('link', { name: 'Title 2' })
    expect(screen.getByText('Movie')).toBeInTheDocument()
    expect(screen.getByText('TV show')).toBeInTheDocument()
  })

  it('leaves out what is requested already once its checkbox is ticked, and shows all of it at first', async () => {
    answer({
      first: {
        titles: [1, 2, 3].map((id) => title({ type: ITEM_TYPES.movie, id })),
        next: null,
      },
    })
    listRequests.mockImplementation(async () => ({
      requests: [
        {
          type: ITEM_TYPES.movie,
          tmdbId: '2',
          title: 'Title 2',
          status: REQUEST_STATUSES.searching,
          requestedAt: '2026-11-15T14:08:00.000Z',
          isMine: false,
          libraryItemId: null,
        },
        {
          type: ITEM_TYPES.movie,
          tmdbId: '3',
          title: 'Title 3',
          status: REQUEST_STATUSES.notDownloadable,
          requestedAt: '2026-01-02T03:04:05Z',
          isMine: false,
          isHeld: true,
          libraryItemId: null,
        },
      ],
      budget: { limit: 10, left: 10, nextAt: null },
      kinds: { movie: true, show: true },
    }))
    getRequestHolding.mockImplementation(async () => ({ status: null }))
    open(UPCOMING_SHELVES.movies)
    const hide = screen.getByRole('checkbox', { name: COMING_SOON_COPY.hideRequested })
    expect(hide).not.toBeChecked()
    await screen.findByRole('link', { name: /Title 3/ })
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
    fireEvent.click(hide)
    await waitFor(() => expect(cardNames()).toEqual(['Title 1']))
    expect(useUpcomingFilter.getState().isHidingRequested).toBe(true)
    fireEvent.click(hide)
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
    expect(useUpcomingFilter.getState().isHidingRequested).toBe(false)
  })

  it('opens with the checkbox ticked from an address that says so, and from the choice kept before', async () => {
    answer({ first: { titles: [title({ type: ITEM_TYPES.movie, id: 1 })], next: null } })
    listRequests.mockImplementation(async () => NO_REQUESTS)
    getRequestHolding.mockImplementation(async () => ({ status: null }))
    renderWithProviders({
      ui: <UpcomingShelfPage shelf={UPCOMING_SHELVES.shows} />,
      route: `/coming-soon/shows?${HIDE_REQUESTED_SEARCH.name}=${HIDE_REQUESTED_SEARCH.value}`,
    })
    expect(screen.getByRole('checkbox', { name: COMING_SOON_COPY.hideRequested })).toBeChecked()
    await screen.findByRole('link', { name: 'Title 1' })
    expect(useUpcomingFilter.getState().isHidingRequested).toBe(true)
    cleanup()
    open(UPCOMING_SHELVES.movies)
    expect(screen.getByRole('checkbox', { name: COMING_SOON_COPY.hideRequested })).toBeChecked()
    await screen.findByRole('link', { name: 'Title 1' })
  })

  it('says when nothing is announced, and when the server cannot reach TMDB', async () => {
    answer({ first: { titles: [], next: null } })
    open(UPCOMING_SHELVES.shows)
    expect(await screen.findByText('Nothing announced yet.')).toBeInTheDocument()
    cleanup()
    getUpcomingShelf.mockImplementation(async () => {
      throw new Error('Set TMDB_API_TOKEN to see what is coming soon.')
    })
    open(UPCOMING_SHELVES.shows)
    expect(await screen.findByRole('alert')).toHaveTextContent('Set TMDB_API_TOKEN')
  })
})
