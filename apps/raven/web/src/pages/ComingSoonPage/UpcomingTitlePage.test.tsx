import { afterEach, describe, expect, it, spyOn } from 'bun:test'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import {
  ITEM_TYPES,
  REQUEST_STATUSES,
  type RequestStatus,
  type TitleHolding,
  type TitleRequests,
  type UpcomingDetails,
} from '@raven/core'
import { Route, Routes } from 'react-router-dom'
import { api } from '@/lib/api'
import { COMING_SOON_TITLE_ROUTE } from '@/pages/ComingSoonPage/copy'
import { UpcomingTitlePage } from '@/pages/ComingSoonPage/UpcomingTitlePage'
import { renderWithProviders } from '@/test/render'

const getUpcomingDetails = spyOn(api, 'getUpcomingDetails')
const listRequests = spyOn(api, 'listRequests')
const requestDownload = spyOn(api, 'requestDownload')
const getRequestHolding = spyOn(api, 'getRequestHolding')

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
    },
  ],
})

type OpenProps = { requests: TitleRequests; holding?: TitleHolding; route?: string }

const open = ({ requests, holding = NOT_HELD, route = '/coming-soon/movie/1' }: OpenProps) => {
  getUpcomingDetails.mockImplementation(async () => DUNE)
  listRequests.mockImplementation(async () => requests)
  getRequestHolding.mockImplementation(async () => holding)
  renderWithProviders({
    ui: (
      <Routes>
        <Route path={COMING_SOON_TITLE_ROUTE} element={<UpcomingTitlePage />} />
      </Routes>
    ),
    route,
  })
}

describe('UpcomingTitlePage', () => {
  afterEach(() => {
    cleanup()
    getUpcomingDetails.mockReset()
    listRequests.mockReset()
    requestDownload.mockReset()
    getRequestHolding.mockReset()
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
    }))
    listRequests.mockImplementation(async () =>
      withRequest({ status: REQUEST_STATUSES.searching, isMine: true }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Request download' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Searching')
    expect(requestDownload).toHaveBeenCalledWith({ type: ITEM_TYPES.movie, tmdbId: '1' })
    expect(screen.queryByRole('button', { name: 'Request download' })).toBeNull()
    expect(screen.getByText(/You requested this/)).toBeInTheDocument()
  })

  it("shows someone else's request where it stands, with no button", async () => {
    open({ requests: withRequest({ status: REQUEST_STATUSES.downloading, isMine: false }) })
    expect(await screen.findByRole('status')).toHaveTextContent('Currently downloading')
    expect(screen.getByText(/Someone has requested this/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Request download' })).toBeNull()
  })

  it('says a title its downloader holds already is requested, with no button', async () => {
    open({ requests: NO_REQUESTS, holding: { status: REQUEST_STATUSES.notDownloadable } })
    expect(await screen.findByRole('status')).toHaveTextContent('Not downloadable')
    expect(screen.getByText(/requested already/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Request download' })).toBeNull()
    expect(getRequestHolding).toHaveBeenCalledWith({ type: ITEM_TYPES.movie, tmdbId: '1' })
  })

  it('says a search found nothing as not downloadable', async () => {
    open({ requests: withRequest({ status: REQUEST_STATUSES.notDownloadable, isMine: true }) })
    expect(await screen.findByRole('status')).toHaveTextContent('Not downloadable')
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

  it('refuses an address that names no title', async () => {
    open({ requests: NO_REQUESTS, route: '/coming-soon/episode/abc' })
    expect(await screen.findByText('This title could not be found.')).toBeInTheDocument()
    expect(getUpcomingDetails).not.toHaveBeenCalled()
  })
})
