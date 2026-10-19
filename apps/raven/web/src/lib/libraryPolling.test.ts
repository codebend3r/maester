import { describe, expect, it } from 'bun:test'
import type { Library } from '@raven/core'
import { RATINGS_POLL_MS, SCAN_POLL_MS, libraryPollDelay } from '@/lib/libraryPolling'
import { library } from '@/test/fixtures'

const NOW = Date.parse('2026-10-17T10:00:00.000Z')
const progress = { done: 1, total: 4, startedAt: '2026-10-17T09:00:00.000Z' }

const refreshing = (ratingsRefresh: Library['ratingsRefresh']): Library =>
  library({ ratingsRefresh })

const scanning = (): Library =>
  library({
    scan: {
      state: 'indexing',
      found: 9,
      processed: 3,
      startedAt: '2026-10-17T09:59:00.000Z',
      finishedAt: null,
      quickScannedAt: null,
      error: null,
    },
  })

describe('libraryPollDelay', () => {
  it('does not poll libraries that are doing nothing', () => {
    expect(libraryPollDelay({ libraries: [library()], now: NOW })).toBe(false)
    expect(libraryPollDelay({ libraries: [], now: NOW })).toBe(false)
    expect(
      libraryPollDelay({
        libraries: [refreshing({ state: 'idle', finishedAt: '2026-10-17T09:00:00.000Z' })],
        now: NOW,
      }),
    ).toBe(false)
  })

  it('polls a scan every 1.5 s', () => {
    expect(libraryPollDelay({ libraries: [scanning()], now: NOW })).toBe(SCAN_POLL_MS)
  })

  it('polls a running Refresh every 5 s', () => {
    expect(
      libraryPollDelay({ libraries: [refreshing({ state: 'running', ...progress })], now: NOW }),
    ).toBe(RATINGS_POLL_MS)
  })

  it('reads a waiting Refresh once, when it resumes, rather than on a clock', () => {
    const waiting = refreshing({
      state: 'waiting',
      ...progress,
      reason: 'budget',
      resumesAt: '2026-10-18T00:00:00.000Z',
    })
    expect(libraryPollDelay({ libraries: [waiting], now: NOW })).toBe(14 * 60 * 60 * 1000)
  })

  it('never waits past a day, which a timer cannot hold far beyond', () => {
    const far = refreshing({
      state: 'waiting',
      ...progress,
      reason: 'budget',
      resumesAt: '2999-01-01T00:00:00.000Z',
    })
    expect(libraryPollDelay({ libraries: [far], now: NOW })).toBe(24 * 60 * 60 * 1000)
  })

  it('does not read a waiting Refresh faster than a running one while it is overdue', () => {
    const overdue = (resumesAt: string) =>
      refreshing({ state: 'waiting', ...progress, reason: 'unavailable', resumesAt })
    expect(libraryPollDelay({ libraries: [overdue('2026-10-17T09:59:00.000Z')], now: NOW })).toBe(
      RATINGS_POLL_MS,
    )
    expect(libraryPollDelay({ libraries: [overdue('not a date')], now: NOW })).toBe(RATINGS_POLL_MS)
  })

  it('keeps the scan pace while a scan and a Refresh both go on, and takes the soonest across libraries', () => {
    const running = refreshing({ state: 'running', ...progress })
    expect(libraryPollDelay({ libraries: [running, scanning()], now: NOW })).toBe(SCAN_POLL_MS)
    expect(libraryPollDelay({ libraries: [library(), running], now: NOW })).toBe(RATINGS_POLL_MS)
  })
})
