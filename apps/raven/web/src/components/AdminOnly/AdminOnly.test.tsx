import { afterEach, describe, expect, it, spyOn } from 'bun:test'
import { screen } from '@testing-library/react'
import type { AdminLock } from '@raven/core'
import { AdminOnly } from '@/components/AdminOnly/AdminOnly'
import { api } from '@/lib/api'
import { held } from '@/test/held'
import { renderWithProviders } from '@/test/render'

const Managed = () => (
  <AdminOnly>
    <button type="button">Rescan</button>
  </AdminOnly>
)

describe('AdminOnly', () => {
  const read = spyOn(api, 'getAdminLock')

  afterEach(() => {
    read.mockReset()
  })

  it('shows what it holds while the admin lock is off', () => {
    renderWithProviders(<Managed />, { adminLock: { state: 'off' } })
    expect(screen.getByRole('button', { name: 'Rescan' })).toBeInTheDocument()
  })

  it('keeps it while a lock turned on waits to hold', () => {
    renderWithProviders(<Managed />, { adminLock: { state: 'turningOn', remainingMs: 15_000 } })
    expect(screen.getByRole('button', { name: 'Rescan' })).toBeInTheDocument()
  })

  it('leaves it out while the admin lock is on', () => {
    renderWithProviders(<Managed />, { adminLock: { state: 'on', available: true } })
    expect(screen.queryByRole('button', { name: 'Rescan' })).toBeNull()
  })

  it('leaves it out until the admin lock is known', () => {
    read.mockImplementation(() => held<AdminLock>().promise)
    renderWithProviders(<Managed />, { adminLock: null })
    expect(screen.queryByRole('button', { name: 'Rescan' })).toBeNull()
  })
})
