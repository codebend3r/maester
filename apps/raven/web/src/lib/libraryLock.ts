import { useQuery } from '@tanstack/react-query'
import type { Library, LockState } from '@raven/core'
import { lockQuery } from '@/lib/queries'

/**
 * Whether a library is open to this browser: open when it is not locked or
 * the PIN was entered, shut until then, and checking while the server has
 * yet to say. `available` is whether a PIN is set at all, so Unlock can work.
 */
export const LIBRARY_LOCK_STATES = { open: 'open', checking: 'checking', shut: 'shut' } as const

export type LibraryLock =
  | { state: typeof LIBRARY_LOCK_STATES.open }
  | { state: typeof LIBRARY_LOCK_STATES.checking }
  | { state: typeof LIBRARY_LOCK_STATES.shut; available: boolean }

export const lockState = ({
  locked,
  lock,
}: {
  locked: boolean
  lock: LockState | undefined
}): LibraryLock => {
  if (!locked) return { state: LIBRARY_LOCK_STATES.open }
  if (!lock) return { state: LIBRARY_LOCK_STATES.checking }
  if (lock.unlocked) return { state: LIBRARY_LOCK_STATES.open }
  return { state: LIBRARY_LOCK_STATES.shut, available: lock.available }
}

/**
 * Where a library stands with this browser's PIN. The lock is asked for
 * only when the library is locked; a library still on its way counts as
 * not locked, as nothing of it shows yet.
 */
export const useLibraryLock = (library: Library | undefined): LibraryLock => {
  const locked = library?.settings.locked ?? false
  const lock = useQuery({ ...lockQuery, enabled: locked })
  return lockState({ locked, lock: lock.data })
}
