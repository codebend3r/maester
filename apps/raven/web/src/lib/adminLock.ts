import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { AdminLock } from '@raven/core'
import { useEffect, useRef } from 'react'
import { adminLockQuery } from '@/lib/queries'

/** Whether the admin lock holds: on, or not yet known, as the server then treats this browser too. */
export const isAdminLocked = (lock: AdminLock | undefined): boolean =>
  (lock?.state ?? 'on') === 'on'

/** Whether this browser is held back from deleting videos, copying their paths and locking libraries. */
export const useAdminLocked = (): boolean => isAdminLocked(useQuery(adminLockQuery).data)

/**
 * Reads every page again when the admin lock comes on or goes off in this
 * browser, as what they show depends on it: locked libraries show only while
 * it is off. A lock turned on holds after a wait, wherever the browser is by
 * then, so this follows it from the frame rather than from Settings.
 */
export const useFollowAdminLock = (): void => {
  const queryClient = useQueryClient()
  const lock = useQuery(adminLockQuery).data
  const isLocked = lock == null ? null : isAdminLocked(lock)
  const seen = useRef(isLocked)
  useEffect(() => {
    const before = seen.current
    seen.current = isLocked
    if (before == null || isLocked == null || before === isLocked) return
    void queryClient.invalidateQueries()
  }, [isLocked, queryClient])
}
