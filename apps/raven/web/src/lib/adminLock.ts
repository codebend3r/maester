import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ADMIN_LOCK_STATES, type AdminLock } from '@raven/core'
import { useEffect, useRef } from 'react'
import { ACCESS_KINDS, useAccessState } from '@/lib/accessState'
import { adminLockQuery } from '@/lib/queries'

/** Whether the admin lock holds: on, or not yet known, as the server then treats this browser too. */
export const isAdminLocked = (lock: AdminLock | undefined): boolean =>
  (lock?.state ?? ADMIN_LOCK_STATES.on) === ADMIN_LOCK_STATES.on

/**
 * The admin lock, read only while accounts are off: with accounts on the
 * password is inert and the server answers 404 to the routes that read it.
 */
export const useAdminLock = (): AdminLock | undefined => {
  const isAdminLockMode = useAccessState().kind === ACCESS_KINDS.disabled
  const lock = useQuery({ ...adminLockQuery, enabled: isAdminLockMode })
  return isAdminLockMode ? lock.data : undefined
}

/**
 * Reads every page again when the admin lock comes on or goes off in this
 * browser, as what they show depends on it: locked libraries show only while
 * it is off. A lock turned on holds after a wait, wherever the browser is by
 * then, so this follows it from the frame rather than from Settings.
 */
export const useFollowAdminLock = (): void => {
  const queryClient = useQueryClient()
  const lock = useAdminLock()
  const isLocked = lock == null ? null : isAdminLocked(lock)
  const seen = useRef(isLocked)
  useEffect(() => {
    const before = seen.current
    seen.current = isLocked
    if (before == null || isLocked == null || before === isLocked) return
    void queryClient.invalidateQueries()
  }, [isLocked, queryClient])
}
