import { afterEach, describe, expect, it, spyOn } from 'bun:test'
import { cleanup, screen } from '@testing-library/react'
import { ADMIN_LOCK_STATES } from '@raven/core'
import { ACCESS_KINDS, type AccessState } from '@/lib/accessState'
import { api } from '@/lib/api'
import { MANAGEMENT_MODES, managementOf, useManagement } from '@/lib/management'
import { fakeAccount } from '@/test/authClient'
import { renderWithProviders } from '@/test/render'

const unlocked = { state: ADMIN_LOCK_STATES.off }
const locked = { state: ADMIN_LOCK_STATES.on, available: true }

const approved = (isOwner: boolean): AccessState => ({
  kind: ACCESS_KINDS.approved,
  account: fakeAccount({ isOwner }),
})

describe('managementOf', () => {
  it('follows the admin lock while accounts are off', () => {
    const access = { kind: ACCESS_KINDS.disabled }
    expect(managementOf({ access, adminLock: unlocked })).toEqual({
      mode: MANAGEMENT_MODES.adminLock,
      canManage: true,
    })
    expect(managementOf({ access, adminLock: locked })).toEqual({
      mode: MANAGEMENT_MODES.adminLock,
      canManage: false,
    })
    expect(managementOf({ access, adminLock: undefined }).canManage).toBe(false)
  })

  it('leaves it to the owner once accounts are on, whatever the lock says', () => {
    expect(managementOf({ access: approved(true), adminLock: locked })).toEqual({
      mode: MANAGEMENT_MODES.owner,
      canManage: true,
    })
    expect(managementOf({ access: approved(false), adminLock: unlocked })).toEqual({
      mode: MANAGEMENT_MODES.owner,
      canManage: false,
    })
  })

  it('gives nobody anything to manage in every other state', () => {
    const others: AccessState[] = [
      { kind: ACCESS_KINDS.unavailable },
      { kind: ACCESS_KINDS.loading },
      { kind: ACCESS_KINDS.signedOut },
      { kind: ACCESS_KINDS.failed },
      { kind: ACCESS_KINDS.pending },
      { kind: ACCESS_KINDS.revoked },
    ]
    others.forEach((access) =>
      expect(managementOf({ access, adminLock: unlocked })).toEqual({
        mode: MANAGEMENT_MODES.none,
        canManage: false,
      }),
    )
  })
})

describe('useManagement', () => {
  const adminLockRead = spyOn(api, 'getAdminLock')

  afterEach(() => {
    cleanup()
    adminLockRead.mockReset()
  })

  const Probe = () => {
    const { mode, canManage } = useManagement()
    return <p>{`${mode} ${canManage}`}</p>
  }

  it('reads the owner off the account, and never asks for the admin lock', async () => {
    renderWithProviders({ ui: <Probe />, account: fakeAccount({ isOwner: true }), adminLock: null })
    expect(await screen.findByText(`${MANAGEMENT_MODES.owner} true`)).toBeInTheDocument()
    expect(adminLockRead).not.toHaveBeenCalled()
  })

  it('reads the admin lock while accounts are off', async () => {
    adminLockRead.mockResolvedValue(unlocked)
    renderWithProviders({ ui: <Probe />, adminLock: null })
    expect(await screen.findByText(`${MANAGEMENT_MODES.adminLock} true`)).toBeInTheDocument()
    expect(adminLockRead).toHaveBeenCalledTimes(1)
  })
})
