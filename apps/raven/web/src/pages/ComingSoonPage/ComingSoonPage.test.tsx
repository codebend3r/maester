import { afterEach, describe, expect, it, spyOn } from 'bun:test'
import { cleanup, screen, within } from '@testing-library/react'
import {
  ITEM_TYPES,
  type MatchItemType,
  REQUEST_STATUSES,
  UPCOMING_SHELVES,
  type Upcoming,
  type UpcomingTitle,
} from '@raven/core'
import { api } from '@/lib/api'
import { ComingSoonPage } from '@/pages/ComingSoonPage/ComingSoonPage'
import { COMING_SOON_TABS } from '@/pages/ComingSoonPage/comingSoonTabs'
import { COMING_SOON_COPY } from '@/pages/ComingSoonPage/copy'
import { REQUEST_STATUS_COPY } from '@/pages/ComingSoonPage/requestCopy'
import { fakeAccount } from '@/test/authClient'
import { held } from '@/test/held'
import { renderWithProviders } from '@/test/render'

const getUpcoming = spyOn(api, 'getUpcoming')
const listRequests = spyOn(api, 'listRequests')
const getRequestHolding = spyOn(api, 'getRequestHolding')
const getUpcomingDetails = spyOn(api, 'getUpcomingDetails')
const listEveryonesRequests = spyOn(api, 'listEveryonesRequests')
const listMembers = spyOn(api, 'listMembers')

type TitleProps = { type: MatchItemType; id: number; name: string }

const title = ({ type, id, name }: TitleProps): UpcomingTitle => ({
  type,
  tmdbId: String(id),
  title: name,
  released: '2026-12-25',
  poster: `/poster${id}.jpg`,
})

const open = (upcoming: Upcoming) => {
  getUpcoming.mockImplementation(async () => upcoming)
  renderWithProviders({ ui: <ComingSoonPage tab={COMING_SOON_TABS.upcoming} /> })
}

const shelf = (name: string): HTMLElement => screen.getByRole('region', { name })

describe('ComingSoonPage', () => {
  afterEach(() => {
    cleanup()
    getUpcoming.mockReset()
    listRequests.mockReset()
    getUpcomingDetails.mockReset()
    getRequestHolding.mockReset()
    listEveryonesRequests.mockReset()
    listMembers.mockReset()
  })

  it('shelves the movies, the shows and the documentaries, each card opening its own page', async () => {
    open({
      movies: [
        title({ type: ITEM_TYPES.movie, id: 1, name: 'Dune: Part Three' }),
        title({ type: ITEM_TYPES.movie, id: 2, name: 'The Batman Part II' }),
      ],
      shows: [title({ type: ITEM_TYPES.show, id: 3, name: 'Blade Runner 2099' })],
      documentaries: [
        title({ type: ITEM_TYPES.movie, id: 4, name: 'Ocean' }),
        title({ type: ITEM_TYPES.show, id: 5, name: 'Planet Earth IV' }),
      ],
    })
    expect(
      await screen.findByRole('heading', { name: 'Coming soon', level: 1 }),
    ).toBeInTheDocument()
    const movies = within(await screen.findByRole('region', { name: 'Upcoming movies' }))
    expect(movies.getAllByRole('listitem')).toHaveLength(2)
    const dune = movies.getByRole('link', { name: 'Dune: Part Three' })
    expect(dune).toHaveAttribute('href', '/coming-soon/movie/1')
    expect(dune.querySelector('img')).toHaveAttribute(
      'src',
      api.tmdbPosterSources('/poster1.jpg').src,
    )
    expect(
      within(shelf('Upcoming TV shows')).getByRole('link', { name: 'Blade Runner 2099' }),
    ).toHaveAttribute('href', '/coming-soon/show/3')
  })

  it("links each shelf's heading to the shelf's own page", async () => {
    open({ movies: [], shows: [], documentaries: [] })
    const headingLink = (name: string) =>
      within(screen.getByRole('heading', { name, level: 2 })).getByRole('link', { name })
    await screen.findByRole('region', { name: 'Upcoming movies' })
    expect(headingLink('Upcoming movies')).toHaveAttribute('href', '/coming-soon/movies')
    expect(headingLink('Upcoming TV shows')).toHaveAttribute('href', '/coming-soon/shows')
    expect(headingLink('Upcoming documentaries')).toHaveAttribute(
      'href',
      '/coming-soon/documentaries',
    )
  })

  it('says which kind each documentary is, and no kind on the other shelves', async () => {
    open({
      movies: [title({ type: ITEM_TYPES.movie, id: 1, name: 'Dune: Part Three' })],
      shows: [],
      documentaries: [
        title({ type: ITEM_TYPES.movie, id: 4, name: 'Ocean' }),
        title({ type: ITEM_TYPES.show, id: 5, name: 'Planet Earth IV' }),
      ],
    })
    const [ocean, planet] = within(
      await screen.findByRole('region', { name: 'Upcoming documentaries' }),
    ).getAllByRole('listitem')
    expect(within(ocean!).getByText('Movie')).toBeInTheDocument()
    expect(within(planet!).getByText('TV show')).toBeInTheDocument()
    expect(within(shelf('Upcoming movies')).queryByText('Movie')).toBeNull()
    expect(
      within(shelf('Upcoming TV shows')).getByText('Nothing announced yet.'),
    ).toBeInTheDocument()
  })

  it('says so while it reads, and when the server cannot reach TMDB', async () => {
    getUpcoming.mockImplementation(() => held<Upcoming>().promise)
    renderWithProviders({ ui: <ComingSoonPage tab={COMING_SOON_TABS.upcoming} /> })
    expect(await screen.findAllByText('Finding what is coming soon')).toHaveLength(
      Object.values(UPCOMING_SHELVES).length,
    )
    cleanup()
    getUpcoming.mockImplementation(async () => {
      throw new Error('Set TMDB_API_TOKEN to see what is coming soon.')
    })
    renderWithProviders({ ui: <ComingSoonPage tab={COMING_SOON_TABS.upcoming} /> })
    expect(await screen.findByRole('alert')).toHaveTextContent('Set TMDB_API_TOKEN')
    expect(screen.queryByRole('region', { name: 'Upcoming movies' })).toBeNull()
  })

  it("shows where a title's request stands on its card", async () => {
    listRequests.mockImplementation(async () => ({
      requests: [
        {
          type: ITEM_TYPES.movie,
          tmdbId: '1',
          title: 'Dune: Part Three',
          status: REQUEST_STATUSES.willDownload,
          requestedAt: '2026-11-12T10:00:00.000Z',
          isMine: false,
          libraryItemId: null,
        },
      ],
      budget: { limit: 10, left: 10, nextAt: null },
      kinds: { movie: true, show: true },
    }))
    open({
      movies: [
        title({ type: ITEM_TYPES.movie, id: 1, name: 'Dune: Part Three' }),
        title({ type: ITEM_TYPES.movie, id: 2, name: 'The Batman Part II' }),
      ],
      shows: [],
      documentaries: [],
    })
    const [dune, batman] = within(
      await screen.findByRole('region', { name: 'Upcoming movies' }),
    ).getAllByRole('listitem')
    expect(await within(dune!).findByText('Will download soon')).toBeInTheDocument()
    expect(within(batman!).queryByText('Will download soon')).toBeNull()
    expect(within(dune!).getByText('Requested')).toBeInTheDocument()
  })

  it('puts a green check on a title its downloader holds already, and none on the rest', async () => {
    getRequestHolding.mockImplementation(async ({ tmdbId }) => ({
      status: tmdbId === '2' ? REQUEST_STATUSES.willDownload : null,
    }))
    open({
      movies: [
        title({ type: ITEM_TYPES.movie, id: 1, name: 'Dune: Part Three' }),
        title({ type: ITEM_TYPES.movie, id: 2, name: 'Focker-in-Law' }),
      ],
      shows: [],
      documentaries: [],
    })
    const [dune, focker] = within(
      await screen.findByRole('region', { name: 'Upcoming movies' }),
    ).getAllByRole('listitem')
    expect(await within(focker!).findByText('Requested')).toBeInTheDocument()
    expect(within(dune!).queryByText('Requested')).toBeNull()
  })

  it('lists your pending requests and the titles a downloader holds on the Pending tab, under what is left today', async () => {
    listRequests.mockImplementation(async () => ({
      requests: [
        {
          type: ITEM_TYPES.show,
          tmdbId: '7',
          title: 'Dig',
          status: REQUEST_STATUSES.searching,
          requestedAt: '2026-11-15T14:08:00.000Z',
          isMine: true,
          libraryItemId: null,
        },
        {
          type: ITEM_TYPES.movie,
          tmdbId: '8',
          title: 'Someone Else’s Film',
          status: REQUEST_STATUSES.searching,
          requestedAt: '2026-11-15T14:07:00.000Z',
          isMine: false,
          libraryItemId: null,
        },
        {
          type: ITEM_TYPES.movie,
          tmdbId: '10',
          title: 'Dune: Part Three',
          status: REQUEST_STATUSES.notDownloadable,
          requestedAt: '2026-01-02T03:04:05Z',
          isMine: false,
          isHeld: true,
          libraryItemId: null,
        },
      ],
      budget: { limit: 10, left: 6, nextAt: null },
      kinds: { movie: true, show: true },
    }))
    getUpcomingDetails.mockImplementation(async ({ type, tmdbId }) => ({
      type,
      tmdbId,
      title: 'Dig',
      released: '2026-12-01',
      poster: '/dig.jpg',
      backdrop: null,
      summary: null,
      tagline: null,
      genres: [],
      runtime: null,
    }))
    renderWithProviders({ ui: <ComingSoonPage tab={COMING_SOON_TABS.pending} /> })
    expect(await screen.findByRole('tab', { name: /Pending/ })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(await screen.findByText('6 of 10 requests left today')).toBeInTheDocument()
    const [dig, dune, ...rest] = within(
      screen.getByRole('list', { name: COMING_SOON_COPY.requests.pending.list }),
    ).getAllByRole('listitem')
    expect(rest).toHaveLength(0)
    expect(within(dune!).getByRole('link', { name: 'Dune: Part Three' })).toHaveAttribute(
      'href',
      '/coming-soon/movie/10',
    )
    expect(within(dig!).getByRole('link', { name: 'Dig' })).toHaveAttribute(
      'href',
      '/coming-soon/show/7',
    )
    expect(within(dig!).getByText('Searching')).toBeInTheDocument()
    expect(within(dig!).getByText('TV show')).toBeInTheDocument()
    expect(getUpcoming).not.toHaveBeenCalled()
  })

  it('moves what a library holds, or has downloaded, to the Added tab, each opening the title where it is', async () => {
    listRequests.mockImplementation(async () => ({
      requests: [
        {
          type: ITEM_TYPES.show,
          tmdbId: '7',
          title: 'Dig',
          status: REQUEST_STATUSES.searching,
          requestedAt: '2026-11-15T14:08:00.000Z',
          isMine: true,
          libraryItemId: null,
        },
        {
          type: ITEM_TYPES.movie,
          tmdbId: '9',
          title: 'Jumanji: Open World',
          status: REQUEST_STATUSES.downloaded,
          requestedAt: '2026-11-14T14:08:00.000Z',
          isMine: true,
          libraryItemId: 42,
        },
        {
          type: ITEM_TYPES.movie,
          tmdbId: '8',
          title: 'Someone Else’s Film',
          status: REQUEST_STATUSES.downloaded,
          requestedAt: '2026-11-13T14:07:00.000Z',
          isMine: false,
          libraryItemId: 43,
        },
        {
          type: ITEM_TYPES.show,
          tmdbId: '11',
          title: 'Blade Runner 2099',
          status: REQUEST_STATUSES.downloaded,
          requestedAt: '2025-10-25T04:27:41Z',
          isMine: false,
          isHeld: true,
          libraryItemId: null,
        },
      ],
      budget: { limit: 10, left: 6, nextAt: null },
      kinds: { movie: true, show: true },
    }))
    getUpcomingDetails.mockImplementation(async ({ type, tmdbId }) => ({
      type,
      tmdbId,
      title: 'Jumanji: Open World',
      released: '2026-12-23',
      poster: null,
      backdrop: null,
      summary: null,
      tagline: null,
      genres: [],
      runtime: null,
    }))
    renderWithProviders({ ui: <ComingSoonPage tab={COMING_SOON_TABS.added} /> })
    expect(await screen.findByRole('tab', { name: /Requests Added/ })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    const [jumanji, bladeRunner, ...rest] = within(
      await screen.findByRole('list', { name: COMING_SOON_COPY.requests.added.list }),
    ).getAllByRole('listitem')
    expect(rest).toHaveLength(0)
    expect(within(bladeRunner!).getByRole('link', { name: 'Blade Runner 2099' })).toHaveAttribute(
      'href',
      '/coming-soon/show/11',
    )
    expect(
      within(bladeRunner!).getByText(REQUEST_STATUS_COPY[REQUEST_STATUSES.downloaded].label),
    ).toBeInTheDocument()
    expect(within(jumanji!).getByRole('link', { name: 'Jumanji: Open World' })).toHaveAttribute(
      'href',
      '/movies/42',
    )
    expect(within(jumanji!).getByText(COMING_SOON_COPY.requests.added.status)).toBeInTheDocument()
    expect(screen.queryByText('6 of 10 requests left today')).toBeNull()
  })

  describe('All requests', () => {
    const everyone = () => {
      listRequests.mockImplementation(async () => ({
        requests: [],
        budget: { limit: 10, left: 10, nextAt: null },
        kinds: { movie: true, show: true },
      }))
      getUpcomingDetails.mockImplementation(async ({ type, tmdbId }) => ({
        type,
        tmdbId,
        title: 'Jumanji: Open World',
        released: '2026-12-23',
        poster: '/jumanji.jpg',
        backdrop: null,
        summary: null,
        tagline: null,
        genres: [],
        runtime: null,
      }))
      listEveryonesRequests.mockImplementation(async () => [
        {
          type: ITEM_TYPES.movie,
          tmdbId: '9',
          title: 'Jumanji: Open World',
          status: REQUEST_STATUSES.notDownloadable,
          requestedAt: '2026-11-15T19:07:59.002Z',
          isMine: false,
          isHeld: false,
          libraryItemId: null,
          requestedBy: member.id,
        },
        {
          type: ITEM_TYPES.show,
          tmdbId: '11',
          title: 'Blade Runner 2099',
          status: REQUEST_STATUSES.downloaded,
          requestedAt: '2025-10-25T04:27:41Z',
          isMine: false,
          isHeld: true,
          libraryItemId: null,
          requestedBy: null,
        },
      ])
    }
    const owner = fakeAccount({ isOwner: true })
    const member = fakeAccount({
      id: '0a1b2c3d-0000-4000-8000-000000000002',
      email: 'kin@raven.test',
    })

    it('lists every account’s requests for the owner, each with its status, whose it was and when', async () => {
      everyone()
      listMembers.mockImplementation(async () => [owner, member])
      renderWithProviders({
        ui: <ComingSoonPage tab={COMING_SOON_TABS.everyone} />,
        account: owner,
      })
      expect(
        await screen.findByRole('tab', { name: new RegExp(COMING_SOON_COPY.tabs.everyone) }),
      ).toHaveAttribute('aria-selected', 'true')
      const table = within(
        await screen.findByRole('table', { name: COMING_SOON_COPY.everyone.table }),
      )
      expect(table.getAllByRole('columnheader').map((header) => header.textContent)).toEqual(
        Object.values(COMING_SOON_COPY.everyone.columns),
      )
      expect(table.getByRole('link', { name: 'Jumanji: Open World' })).toHaveAttribute(
        'href',
        '/coming-soon/movie/9',
      )
      expect(
        table.getByText(REQUEST_STATUS_COPY[REQUEST_STATUSES.notDownloadable].label),
      ).toBeInTheDocument()
      expect(await table.findByText('kin@raven.test')).toBeInTheDocument()
      expect(table.getAllByRole('time')[0]).toHaveAttribute('datetime', '2026-11-15T19:07:59.002Z')
      expect(table.getByText(COMING_SOON_COPY.everyone.downloaders.show)).toBeInTheDocument()
    })

    it('keeps the tab and its read from a member', async () => {
      everyone()
      renderWithProviders({
        ui: <ComingSoonPage tab={COMING_SOON_TABS.pending} />,
        account: member,
      })
      await screen.findByRole('tab', { name: /Pending/ })
      expect(
        screen.queryByRole('tab', { name: new RegExp(COMING_SOON_COPY.tabs.everyone) }),
      ).toBeNull()
      expect(listEveryonesRequests).not.toHaveBeenCalled()
    })
  })
})
