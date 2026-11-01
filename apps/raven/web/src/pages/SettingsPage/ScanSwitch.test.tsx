import { afterEach, describe, expect, it, spyOn } from 'bun:test'
import { cleanup, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { api } from '@/lib/api'
import { ScanSwitch } from '@/pages/SettingsPage/ScanSwitch'
import { renderWithProviders } from '@/test/render'

const read = spyOn(api, 'getScanControl')
const save = spyOn(api, 'setScanControl')

afterEach(() => {
  cleanup()
  read.mockReset()
  save.mockReset()
})

describe('global scan switch', () => {
  it('stops all scans, then allows them again', async () => {
    const state = { isStopped: false }
    read.mockImplementation(async () => ({ ...state }))
    save.mockImplementation(async (next) => {
      state.isStopped = next.isStopped
      return { ...state }
    })
    renderWithProviders({ ui: <ScanSwitch /> })
    await userEvent.click(await screen.findByRole('button', { name: 'Stop all scans' }))
    expect(save).toHaveBeenCalledWith({ isStopped: true })
    expect(await screen.findByText('All scans are stopped.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Allow scans again' }))
    await waitFor(() => expect(save).toHaveBeenCalledWith({ isStopped: false }))
    expect(await screen.findByRole('button', { name: 'Stop all scans' })).toBeInTheDocument()
  })

  it('shows a failed stop without pretending scans stopped', async () => {
    read.mockResolvedValue({ isStopped: false })
    save.mockRejectedValue(new Error('Connection lost'))
    renderWithProviders({ ui: <ScanSwitch /> })
    await userEvent.click(await screen.findByRole('button', { name: 'Stop all scans' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Connection lost')
    expect(screen.queryByText('All scans are stopped.')).toBeNull()
  })

  it('shows a read failure and no control until the state is known', async () => {
    read.mockRejectedValue(new Error('Server unavailable'))
    renderWithProviders({ ui: <ScanSwitch /> })
    expect(await screen.findByRole('alert')).toHaveTextContent('Server unavailable')
    expect(screen.queryByRole('button')).toBeNull()
    expect(save).not.toHaveBeenCalled()
  })
})
