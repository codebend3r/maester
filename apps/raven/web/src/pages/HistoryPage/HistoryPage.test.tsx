import { afterEach, describe, expect, it, spyOn } from 'bun:test'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { HistoryEntry } from '@raven/core'
import { Route, Routes } from 'react-router-dom'
import { api } from '@/lib/api'
import { HistoryPage } from '@/pages/HistoryPage/HistoryPage'
import { library, mediaItem } from '@/test/fixtures'
import { renderWithProviders } from '@/test/render'

const played = ({
  id,
  title,
  watched,
}: {
  id: number
  title: string
  watched: boolean
}): HistoryEntry => ({
  media: mediaItem({ id, title, duration: 100 }),
  lastPlayedAt: new Date().toISOString(),
  plays: 1,
  furthest: watched ? 95 : 40,
  watched,
})

const FINISHED = played({ id: 1, title: 'Finished', watched: true })
const STARTED = played({ id: 2, title: 'Started', watched: false })

describe('HistoryPage', () => {
  const spies = {
    library: spyOn(api, 'getLibrary'),
    history: spyOn(api, 'listHistory'),
  }
  const asked: Array<{ limit: number; watchedOnly?: boolean }> = []

  const serve = (entries: (watchedOnly: boolean) => HistoryEntry[]) => {
    spies.library.mockImplementation(async () => library({ id: 2 }))
    spies.history.mockImplementation(async ({ limit, watchedOnly }) => {
      asked.push({ limit, watchedOnly })
      return entries(!!watchedOnly).slice(0, limit)
    })
    renderWithProviders(
      <Routes>
        <Route path="libraries/:id/history" element={<HistoryPage />} />
      </Routes>,
      { route: '/libraries/2/history' },
    )
  }

  afterEach(() => {
    spies.library.mockReset()
    spies.history.mockReset()
    asked.splice(0)
  })

  it("lists what was watched by day, by the library's own measure", async () => {
    serve((watchedOnly) => (watchedOnly ? [FINISHED] : [STARTED, FINISHED]))
    expect(await screen.findByRole('link', { name: 'Finished' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Today' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Started' })).toBeNull()
    expect(screen.getByText(/90% of the way through/)).toBeInTheDocument()
    expect(asked.at(-1)).toEqual({ limit: 100, watchedOnly: true })
  })

  it('shows everything played, finished or not, when asked', async () => {
    serve((watchedOnly) => (watchedOnly ? [FINISHED] : [STARTED, FINISHED]))
    await screen.findByRole('link', { name: 'Finished' })
    await userEvent.click(screen.getByRole('button', { name: 'All played' }))
    expect(await screen.findByRole('link', { name: 'Started' })).toBeInTheDocument()
    expect(screen.getByText(/^40% watched/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'All played' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('offers more when a page comes back full', async () => {
    const many = Array.from({ length: 150 }, (_, index) =>
      played({ id: index + 1, title: `Video ${index + 1}`, watched: true }),
    )
    serve(() => many)
    await screen.findByRole('link', { name: 'Video 1' })
    expect(screen.queryByRole('link', { name: 'Video 101' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Show more' }))
    expect(await screen.findByRole('link', { name: 'Video 150' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull()
  })

  it('says when nothing has been watched yet', async () => {
    serve(() => [])
    expect(await screen.findByText(/Nothing watched in Movies yet/)).toBeInTheDocument()
  })
})
