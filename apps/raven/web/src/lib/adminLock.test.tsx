import { describe, expect, it, spyOn } from 'bun:test'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import type { AdminLock } from '@raven/core'
import type { ReactNode } from 'react'
import { isAdminLocked, useFollowAdminLock } from '@/lib/adminLock'
import { queryKeys } from '@/lib/queryClient'

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
    client.setQueryData(queryKeys.adminLock, { state: 'on', available: true })
    const invalidated = spyOn(client, 'invalidateQueries').mockImplementation(async () => undefined)
    const wrapper = ({ children }: { children: ReactNode }) => (
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
