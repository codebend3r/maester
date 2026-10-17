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
  quickScannedAt: null,
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
    expect(screen.getByRole('progressbar', { name: 'Scan progress' })).toHaveAttribute('value', '5')
  })

  it('says when the library was last scanned, and why the scan failed', () => {
    const finishedAt = new Date(Date.now() - 2 * 60 * 60_000).toISOString()
    render(
      <ScanStatus
        scan={scanning({ state: 'idle', finishedAt, error: 'Could not read /media/Movies.' })}
      />,
    )
    expect(screen.getByText('Full scan 2 h ago')).toBeInTheDocument()
    expect(screen.queryByRole('progressbar')).toBeNull()
    expect(screen.getByRole('alert')).toHaveTextContent('Could not read /media/Movies.')
  })

  it('says when the last full scan and the last quick scan were, once idle', () => {
    render(
      <ScanStatus
        scan={scanning({
          state: 'idle',
          finishedAt: new Date(Date.now() - 2 * 3_600_000).toISOString(),
          quickScannedAt: new Date(Date.now() - 4 * 60_000).toISOString(),
        })}
      />,
    )
    expect(screen.getByText('Full scan 2 h ago · Quick scan 4 min ago')).toBeInTheDocument()
  })

  it('owns up to a library quick-scanned but never fully scanned since the times were kept', () => {
    render(
      <ScanStatus scan={scanning({ state: 'idle', quickScannedAt: new Date().toISOString() })} />,
    )
    expect(screen.getByText('No full scan yet · Quick scan just now')).toBeInTheDocument()
  })

  it('says nothing of a library no scan has reached', () => {
    const { container } = render(<ScanStatus scan={scanning({ state: 'idle' })} />)
    expect(container.querySelector('span')).toBeNull()
  })
})
