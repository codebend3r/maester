import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test'
import { cleanup, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  DEFAULT_CAPTION_STYLE,
  ITEM_TYPES,
  REQUEST_STATUSES,
  type TitleRequests,
} from '@raven/core'
import { api } from '@/lib/api'
import { SettingsPage } from '@/pages/SettingsPage/SettingsPage'
import { renderWithProviders } from '@/test/render'

const listRequests = spyOn(api, 'listRequests')
const captionStyle = spyOn(api, 'getCaptionStyle')

const REQUESTS: TitleRequests = {
  requests: [
    {
      type: ITEM_TYPES.movie,
      tmdbId: '1400336',
      title: 'Focker-in-Law',
      status: REQUEST_STATUSES.downloading,
      requestedAt: '2026-11-12T10:00:00.000Z',
      isMine: true,
    },
    {
      type: ITEM_TYPES.show,
      tmdbId: '10',
      title: 'The Bear',
      status: REQUEST_STATUSES.notDownloadable,
      requestedAt: '2026-11-11T10:00:00.000Z',
      isMine: true,
    },
    {
      type: ITEM_TYPES.movie,
      tmdbId: '2',
      title: 'Sinners',
      status: REQUEST_STATUSES.willDownload,
      requestedAt: '2026-11-10T10:00:00.000Z',
      isMine: false,
    },
  ],
  budget: { limit: 10, left: 8, nextAt: null },
  kinds: { movie: true, show: true },
}

const openRequests = async () => {
  renderWithProviders({ ui: <SettingsPage /> })
  await userEvent.click(await screen.findByRole('tab', { name: /Requests/ }))
}

describe("Settings' Requests tab", () => {
  beforeEach(() => {
    captionStyle.mockResolvedValue(DEFAULT_CAPTION_STYLE)
  })
  afterEach(() => {
    cleanup()
    listRequests.mockReset()
    captionStyle.mockReset()
  })

  it('opens on Preferences, with the requests a tab away and counted', async () => {
    listRequests.mockImplementation(async () => REQUESTS)
    renderWithProviders({ ui: <SettingsPage /> })
    expect(screen.getByRole('tab', { name: 'Preferences' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(await screen.findByRole('tab', { name: 'Requests 2' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Playback' })).toBeInTheDocument()
  })

  it("lists only the caller's own requests, each with its kind, time and status", async () => {
    listRequests.mockImplementation(async () => REQUESTS)
    await openRequests()
    const table = await screen.findByRole('table', { name: 'Your requests' })
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows).toHaveLength(2)
    const [focker, bear] = rows
    expect(within(focker!).getByRole('link', { name: 'Focker-in-Law' })).toHaveAttribute(
      'href',
      '/coming-soon/movie/1400336',
    )
    expect(within(focker!).getByText('Movie')).toBeInTheDocument()
    expect(within(focker!).getByText('Currently downloading')).toBeInTheDocument()
    expect(within(bear!).getByText('TV show')).toBeInTheDocument()
    expect(within(bear!).getByText('Not downloadable')).toBeInTheDocument()
    expect(within(table).queryByText('Sinners')).toBeNull()
    expect(screen.getByText('8 of 10 requests left today')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Playback' })).toBeNull()
  })

  it('says so when the caller has requested nothing', async () => {
    listRequests.mockImplementation(async () => ({ ...REQUESTS, requests: [] }))
    await openRequests()
    expect(await screen.findByText(/You have not requested anything yet/)).toBeInTheDocument()
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('says why the requests could not be read', async () => {
    listRequests.mockImplementation(async () => {
      throw new Error('The server did not answer')
    })
    await openRequests()
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not read your requests: The server did not answer',
    )
  })
})
