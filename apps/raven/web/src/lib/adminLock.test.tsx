import { afterEach, describe, expect, it, spyOn } from 'bun:test'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import { ADMIN_LOCK_STATES, AUTH_CONFIG_STATES, type AdminLock, type AuthConfig } from '@raven/core'
import type { ReactNode } from 'react'
import { isAdminLocked, useAdminLock, useFollowAdminLock } from '@/lib/adminLock'
import { api } from '@/lib/api'
import { queryKeys } from '@raven/ui/headless'
import { readyConfig } from '@/test/authClient'

describe('isAdminLocked', () => {
  it('holds while the lock is on, or not known yet', () => {
    expect(isAdminLocked({ state: 'on', available: true })).toBe(true)
    expect(isAdminLocked(undefined)).toBe(true)
  })

  it('lets go once the password is in, and until a lock on its way holds', () => {
    expect(isAdminLocked({ state: 'off' })).toBe(false)
    expect(isAdminLocked({ state: 'turningOn', remainingMs: 15_000 })).toBe(false)
  })
})

describe('useFollowAdminLock', () => {
  it('reads every page again when the lock comes on or goes off, and only then', async () => {
    const client = new QueryClient()
    // The query tells its observers on the next tick, so each change waits one out.
    const set = (lock: AdminLock) =>
      act(async () => {
        client.setQueryData(queryKeys.adminLock, lock)
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
    client.setQueryData(queryKeys.authConfig, { state: AUTH_CONFIG_STATES.off })
    client.setQueryData(queryKeys.adminLock, { state: 'on', available: true })
    const invalidated = spyOn(client, 'invalidateQueries').mockImplementation(async () => undefined)
    type WrapperProps = { children: ReactNode }

    const wrapper = ({ children }: WrapperProps) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )
    renderHook(() => useFollowAdminLock(), { wrapper })
    expect(invalidated).toHaveBeenCalledTimes(0)

    await set({ state: 'off' })
    expect(invalidated).toHaveBeenCalledTimes(1)
    await set({ state: 'turningOn', remainingMs: 15_000 })
    expect(invalidated).toHaveBeenCalledTimes(1)
    await set({ state: 'on', available: true })
    expect(invalidated).toHaveBeenCalledTimes(2)
  })
})

describe('useAdminLock', () => {
  const read = spyOn(api, 'getAdminLock')

  const render = (config: AuthConfig) => {
    const client = new QueryClient()
    client.setQueryData(queryKeys.authConfig, config)
    client.setQueryData(queryKeys.adminLock, { state: ADMIN_LOCK_STATES.off })
    type Wrapper2Props = { children: ReactNode }

    const wrapper = ({ children }: Wrapper2Props) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )
    return renderHook(() => useAdminLock(), { wrapper })
  }

  afterEach(() => read.mockReset())

  it('reads the lock while accounts are off', () => {
    read.mockResolvedValue({ state: ADMIN_LOCK_STATES.off })
    expect(render({ state: AUTH_CONFIG_STATES.off }).result.current).toEqual({
      state: ADMIN_LOCK_STATES.off,
    })
  })

  it('knows no lock once accounts are on, and asks for none', () => {
    expect(render(readyConfig).result.current).toBeUndefined()
    expect(read).not.toHaveBeenCalled()
  })
})
