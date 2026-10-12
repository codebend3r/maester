import { describe, expect, it } from 'bun:test'
import { render, screen } from '@testing-library/react'
import type { ScanStatus as Status } from '@raven/core'
import { ScanStatus } from '@/components/ScanStatus/ScanStatus'

const scanning = (overrides: Partial<Status>): Status => ({
  state: 'walking',
  found: 0,
  processed: 0,
  startedAt: '2026-10-12T04:38:34.481Z',
  finishedAt: null,
  error: null,
  ...overrides,
})

describe('ScanStatus', () => {
  it('says it is looking until the walk finds a video', () => {
    render(<ScanStatus scan={scanning({})} />)
    expect(screen.getByText('Looking through the folders')).toBeInTheDocument()
  })

  it('counts the videos found while the walk goes on, so a big share shows it is moving', () => {
    render(<ScanStatus scan={scanning({ found: 6608 })} />)
    expect(
      screen.getByText('Looking through the folders, 6,608 videos found so far'),
    ).toBeInTheDocument()
  })

  it('counts the indexing once the walk is done', () => {
    render(<ScanStatus scan={scanning({ state: 'indexing', found: 12, processed: 5 })} />)
    expect(screen.getByText('Indexing 5 of 12')).toBeInTheDocument()
  })
})
