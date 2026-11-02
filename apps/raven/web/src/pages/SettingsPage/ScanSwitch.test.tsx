import { afterEach, describe, expect, it, spyOn } from 'bun:test'
import { cleanup, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { api } from '@/lib/api'
import { ScanSwitch } from '@/pages/SettingsPage/ScanSwitch'
import { library } from '@/test/fixtures'
import { renderWithProviders } from '@/test/render'

const read = spyOn(api, 'listLibraries')
const cancelFull = spyOn(api, 'cancelScan')
const cancelQuick = spyOn(api, 'cancelQuickScan')
const cancelRatings = spyOn(api, 'cancelLibraryRatings')

afterEach(() => {
  cleanup()
  read.mockReset()
  cancelFull.mockReset()
  cancelQuick.mockReset()
  cancelRatings.mockReset()
})

describe('library scans control', () => {
  it('shows running work and cancels only that work', async () => {
    let libraries = [
      library({ id: 1, name: 'Films', scan: { ...library().scan, state: 'indexing' } }),
      library({
        id: 2,
        name: 'Series',
        scan: { ...library().scan, kind: 'quick', state: 'walking' },
        ratingsRefresh: {
          state: 'running',
          done: 0,
          total: 2,
          startedAt: '2026-11-01T00:00:00.000Z',
        },
      }),
      library({ id: 3, name: 'Idle' }),
    ]
    read.mockImplementation(async () => libraries)
    cancelFull.mockImplementation(async () => {
      libraries = libraries.map((entry) =>
        entry.id === 1 ? library({ ...entry, scan: { ...entry.scan, state: 'idle' } }) : entry,
      )
      return library()
    })
    cancelQuick.mockImplementation(async () => {
      libraries = libraries.map((entry) =>
        entry.id === 2 ? library({ ...entry, scan: { ...entry.scan, state: 'idle' } }) : entry,
      )
      return library()
    })
    cancelRatings.mockImplementation(async () => {
      libraries = libraries.map((entry) =>
        entry.id === 2
          ? library({ ...entry, ratingsRefresh: { state: 'idle', finishedAt: null } })
          : entry,
      )
      return library()
    })
    renderWithProviders({ ui: <ScanSwitch /> })

    expect(await screen.findByText('Films: Full scan')).toBeInTheDocument()
    expect(screen.getByText('Series: Quick scan')).toBeInTheDocument()
    expect(screen.getByText('Series: Updating ratings')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Cancel all running scans' }))
    await waitFor(() => {
      expect(cancelFull).toHaveBeenCalledWith(1)
      expect(cancelQuick).toHaveBeenCalledWith(2)
      expect(cancelRatings).toHaveBeenCalledWith(2)
      expect(screen.getByRole('button', { name: 'Cancel all running scans' })).toBeDisabled()
    })
  })

  it('disables cancellation when nothing is running', async () => {
    read.mockResolvedValue([library()])
    renderWithProviders({ ui: <ScanSwitch /> })
    expect(await screen.findByRole('button', { name: 'Cancel all running scans' })).toBeDisabled()
  })

  it('shows a read failure without a cancel control', async () => {
    read.mockRejectedValue(new Error('Server unavailable'))
    renderWithProviders({ ui: <ScanSwitch /> })
    expect(await screen.findByRole('alert')).toHaveTextContent('Server unavailable')
    expect(screen.queryByRole('button')).toBeNull()
  })
})
