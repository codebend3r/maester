import { afterEach, describe, expect, it } from 'bun:test'
import { cleanup, screen } from '@testing-library/react'
import type { RatingsRefresh } from '@raven/core'
import { RatingsStatus } from '@/components/RatingsStatus/RatingsStatus'
import { renderWithProviders } from '@/test/render'

const progress = { done: 1200, total: 3400, startedAt: '2026-10-17T09:00:00.000Z' }

const running: RatingsRefresh = { state: 'running', ...progress }
const budget: RatingsRefresh = {
  state: 'waiting',
  ...progress,
  reason: 'budget',
  resumesAt: '2026-10-18T00:00:00.000Z',
}
const unavailable: RatingsRefresh = { ...budget, reason: 'unavailable' }

describe('RatingsStatus', () => {
  afterEach(cleanup)

  it('counts the titles done while it runs', () => {
    renderWithProviders({ ui: <RatingsStatus refresh={running} /> })
    expect(screen.getByText('Refreshing ratings · 1,200 of 3,400')).toBeInTheDocument()
  })

  it('says the rest wait for midnight UTC when the daily limit is spent', () => {
    renderWithProviders({ ui: <RatingsStatus refresh={budget} /> })
    expect(
      screen.getByText('Ratings: 1,200 of 3,400 · the rest after midnight UTC (daily limit)'),
    ).toBeInTheDocument()
  })

  it('says it is waiting for the ratings service when a source does not answer', () => {
    renderWithProviders({ ui: <RatingsStatus refresh={unavailable} /> })
    expect(
      screen.getByText('Ratings: 1,200 of 3,400 · waiting for the ratings service'),
    ).toBeInTheDocument()
  })

  it('says nothing when idle, finished or not, as nothing may have needed asking', () => {
    renderWithProviders({
      ui: (
        <>
          <RatingsStatus refresh={{ state: 'idle', finishedAt: null }} />
          <RatingsStatus refresh={{ state: 'idle', finishedAt: '2026-10-17T10:00:00.000Z' }} />
        </>
      ),
    })
    expect(screen.queryByText(/ratings/i)).toBeNull()
  })

  it('says nothing while the admin lock is on', () => {
    renderWithProviders({
      ui: <RatingsStatus refresh={running} />,
      adminLock: { state: 'on', available: true },
    })
    expect(screen.queryByText(/Refreshing ratings/)).toBeNull()
  })
})
