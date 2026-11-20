import { afterEach, describe, expect, it, spyOn } from 'bun:test'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import {
  CREDIT_JOBS,
  ITEM_TYPES,
  REQUEST_STATUSES,
  type RequestStatus,
  type Account,
  type MemberRequest,
  type TitleHolding,
  type TitleRequests,
  UPCOMING_KINDS,
  type UpcomingDetails,
} from '@raven/core'
import { Route, Routes } from 'react-router-dom'
import { fakeAccount } from '@/test/authClient'
import { COMING_SOON_COPY } from '@/pages/ComingSoonPage/copy'
import { api } from '@/lib/api'
import { APP_PATHS } from '@/lib/appPaths'
import { UpcomingTitlePage } from '@/pages/ComingSoonPage/UpcomingTitlePage'
import { renderWithProviders } from '@/test/render'

const getUpcomingDetails = spyOn(api, 'getUpcomingDetails')
const listRequests = spyOn(api, 'listRequests')
const requestDownload = spyOn(api, 'requestDownload')
const getRequestHolding = spyOn(api, 'getRequestHolding')
const listEveryonesRequests = spyOn(api, 'listEveryonesRequests')
const listMembers = spyOn(api, 'listMembers')

const REQUESTED_DAY = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(
  new Date('2026-11-12T10:00:00.000Z'),
)

const NOT_HELD: TitleHolding = { status: null }

const DUNE: UpcomingDetails = {
  type: ITEM_TYPES.movie,
  tmdbId: '1',
  title: 'Dune: Part Three',
  released: '2026-12-18',
  poster: '/poster1.jpg',
  backdrop: '/backdrop1.jpg',
  summary: 'The last of the books.',
  tagline: 'Long live the fighters.',
  genres: ['Science Fiction'],
  runtime: 160,
}

const NO_REQUESTS: TitleRequests = {
  requests: [],
  budget: { limit: 10, left: 10, nextAt: null },
  kinds: { movie: true, show: true },
}

type WithRequestProps = { status: RequestStatus; isMine: boolean }

const withRequest = ({ status, isMine }: WithRequestProps): TitleRequests => ({
  ...NO_REQUESTS,
  requests: [
    {
      type: ITEM_TYPES.movie,
      tmdbId: '1',
      title: DUNE.title,
      status,
      requestedAt: '2026-11-12T10:00:00.000Z',
      isMine,
      libraryItemId: null,
    },
  ],
})

type OpenProps = {
  requests: TitleRequests
  details?: UpcomingDetails
  holding?: TitleHolding
  route?: string
  account?: Account | null
  everyone?: MemberRequest[]
}

const open = ({
  requests,
  details = DUNE,
  holding = NOT_HELD,
  route = '/coming-soon/movie/1',
  account = null,
  everyone = [],
}: OpenProps) => {
  getUpcomingDetails.mockImplementation(async () => details)
  listRequests.mockImplementation(async () => requests)
  getRequestHolding.mockImplementation(async () => holding)
  listEveryonesRequests.mockImplementation(async () => everyone)
  renderWithProviders({
    ui: (
      <Routes>
        <Route path={APP_PATHS.comingSoonTitle} element={<UpcomingTitlePage />} />
      </Routes>
    ),
    route,
    account,
  })
}

describe('UpcomingTitlePage', () => {
  afterEach(() => {
    cleanup()
    getUpcomingDetails.mockReset()
    listRequests.mockReset()
    requestDownload.mockReset()
    getRequestHolding.mockReset()
    listEveryonesRequests.mockReset()
    listMembers.mockReset()
  })

  it("shows the title as TMDB describes it, with TMDB's page a link away", async () => {
    open({ requests: NO_REQUESTS })
    expect(await screen.findByRole('heading', { name: 'Dune: Part Three', level: 1 })).toBeVisible()
    expect(getUpcomingDetails).toHaveBeenCalledWith({ type: ITEM_TYPES.movie, tmdbId: '1' })
    expect(screen.getByText('The last of the books.')).toBeInTheDocument()
    expect(screen.getByText('160 min')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'View on TMDB' })).toHaveAttribute(
      'href',
      'https://www.themoviedb.org/movie/1',
    )
  })

  it('lists the cast as people to open, and names the directors in plain text', async () => {
    open({
      requests: NO_REQUESTS,
      details: {
        ...DUNE,
        credits: [
          {
            personId: 5,
            name: 'Zendaya',
            job: CREDIT_JOBS.cast,
            role: 'Chani',
            photoVersion: 'z1',
          },
          {
            personId: 6,
            name: 'Denis Villeneuve',
            job: CREDIT_JOBS.director,
            role: 'Director',
            photoVersion: null,
          },
        ],
      },
    })
    const cast = await screen.findByRole('region', { name: COMING_SOON_COPY.cast })
    expect(cast).toHaveTextContent('Zendaya')
    expect(cast).toHaveTextContent('Chani')
    expect(cast).not.toHaveTextContent('Denis Villeneuve')
    expect(screen.getByRole('link', { name: /Zendaya/ })).toHaveAttribute('href', '/people/5')
    expect(screen.getByText(COMING_SOON_COPY.directedBy('Denis Villeneuve'))).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Denis Villeneuve/ })).toBeNull()
  })

  it('shows no cast or directors when the server sends no credits', async () => {
    open({ requests: NO_REQUESTS })
    expect(await screen.findByRole('heading', { name: 'Dune: Part Three', level: 1 })).toBeVisible()
    expect(screen.queryByRole('region', { name: COMING_SOON_COPY.cast })).toBeNull()
    expect(screen.queryByText(/Directed by/)).toBeNull()
  })

  it('says what the title is: a movie from an older server, and the kind a newer one names', async () => {
    open({ requests: NO_REQUESTS })
    expect(await screen.findByText(COMING_SOON_COPY.kinds.movie)).toBeInTheDocument()
    cleanup()
    getUpcomingDetails.mockImplementation(async () => ({
      ...DUNE,
      kind: UPCOMING_KINDS.animeMovie,
    }))
    renderWithProviders({
      ui: (
        <Routes>
          <Route path={APP_PATHS.comingSoonTitle} element={<UpcomingTitlePage />} />
        </Routes>
      ),
      route: '/coming-soon/movie/1',
    })
    expect(await screen.findByText(COMING_SOON_COPY.upcomingKinds.animeMovie)).toBeInTheDocument()
  })

  it('requests the title for everyone, sending only its type and id', async () => {
    open({ requests: NO_REQUESTS })
    expect(await screen.findByText('10 of 10 requests left today')).toBeInTheDocument()
    requestDownload.mockImplementation(async () => ({
      type: ITEM_TYPES.movie,
      tmdbId: '1',
      title: DUNE.title,
      status: REQUEST_STATUSES.searching,
      requestedAt: '2026-11-12T10:00:00.000Z',
      isMine: true,
      libraryItemId: null,
    }))
    listRequests.mockImplementation(async () =>
      withRequest({ status: REQUEST_STATUSES.searching, isMine: true }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Request download' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Searching')
    expect(requestDownload).toHaveBeenCalledWith({ type: ITEM_TYPES.movie, tmdbId: '1' })
    expect(screen.queryByRole('button', { name: 'Request download' })).toBeNull()
    expect(screen.getByText(`Requested by you on ${REQUESTED_DAY}.`)).toBeInTheDocument()
  })

  it("shows someone else's request where it stands, with no button", async () => {
    open({ requests: withRequest({ status: REQUEST_STATUSES.downloading, isMine: false }) })
    expect(await screen.findByRole('status')).toHaveTextContent('Currently downloading')
    expect(screen.getByText(`Requested by someone on ${REQUESTED_DAY}.`)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Request download' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Requested' })).toBeDisabled()
  })

  it('says a title its downloader holds already is requested, with no button', async () => {
    open({ requests: NO_REQUESTS, holding: { status: REQUEST_STATUSES.notDownloadable } })
    expect(await screen.findByRole('status')).toHaveTextContent('Tracked and ready')
    expect(screen.getByText('Requested by Radarr.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Request download' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Requested' })).toBeDisabled()
    expect(getRequestHolding).toHaveBeenCalledWith({ type: ITEM_TYPES.movie, tmdbId: '1' })
    expect(requestDownload).not.toHaveBeenCalled()
  })

  it('says a search that found nothing is tracked and ready', async () => {
    open({ requests: withRequest({ status: REQUEST_STATUSES.notDownloadable, isMine: true }) })
    expect(await screen.findByRole('status')).toHaveTextContent('Tracked and ready')
  })

  it('greys the button out once the budget is spent', async () => {
    open({
      requests: {
        ...NO_REQUESTS,
        budget: { limit: 10, left: 0, nextAt: '2026-11-13T10:00:00.000Z' },
      },
    })
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Request download' })).toBeDisabled(),
    )
    expect(screen.getByText(/used all 10/)).toBeInTheDocument()
  })

  it('says requests are off when the server has no downloader for the kind', async () => {
    open({ requests: { ...NO_REQUESTS, kinds: { movie: false, show: true } } })
    expect(await screen.findByText('Movie requests are off on this server.')).toBeInTheDocument()
  })

  it('says why a request did not go through', async () => {
    open({ requests: NO_REQUESTS })
    requestDownload.mockImplementation(async () => {
      throw new Error('Someone has requested this already')
    })
    fireEvent.click(await screen.findByRole('button', { name: 'Request download' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Someone has requested this already')
  })

  it('names the account that asked by its email, and the day, for the owner', async () => {
    const owner = fakeAccount({ isOwner: true })
    const member = fakeAccount({
      id: '0a1b2c3d-0000-4000-8000-000000000002',
      email: 'kin@raven.test',
    })
    const requests = withRequest({ status: REQUEST_STATUSES.downloading, isMine: false })
    listMembers.mockImplementation(async () => [owner, member])
    open({
      requests,
      account: owner,
      everyone: requests.requests.map((request) => ({ ...request, requestedBy: member.id })),
    })
    expect(
      await screen.findByText(`Requested by kin@raven.test on ${REQUESTED_DAY}.`),
    ).toBeInTheDocument()
  })

  it("names a member's own request by their email, never reading everyone's", async () => {
    const member = fakeAccount({ email: 'kin@raven.test' })
    listMembers.mockImplementation(async () => [])
    open({
      requests: withRequest({ status: REQUEST_STATUSES.searching, isMine: true }),
      account: member,
    })
    expect(
      await screen.findByText(`Requested by kin@raven.test on ${REQUESTED_DAY}.`),
    ).toBeInTheDocument()
    expect(listEveryonesRequests).not.toHaveBeenCalled()
  })

  it('refuses an address that names no title', async () => {
    open({ requests: NO_REQUESTS, route: '/coming-soon/episode/abc' })
    expect(await screen.findByText('This title could not be found.')).toBeInTheDocument()
    expect(getUpcomingDetails).not.toHaveBeenCalled()
  })
})
