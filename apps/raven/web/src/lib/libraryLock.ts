import { useQuery } from '@tanstack/react-query'
import type { Library, LockState } from '@raven/core'
import { lockQuery } from '@/lib/queries'

/**
 * Whether a library is open to this browser: open when it is not locked or
 * the server says it is unlocked for this browser, shut otherwise, and checking
 * while the server has yet to say. No client asks for a PIN, so a shut library stays shut.
 */
export const LIBRARY_LOCK_STATES = { open: 'open', checking: 'checking', shut: 'shut' } as const

export type LibraryLock =
  | { state: typeof LIBRARY_LOCK_STATES.open }
  | { state: typeof LIBRARY_LOCK_STATES.checking }
  | { state: typeof LIBRARY_LOCK_STATES.shut }

type LockStateProps = {
  locked: boolean
  lock: LockState | undefined
}

export const lockState = ({ locked, lock }: LockStateProps): LibraryLock => {
  if (!locked) return { state: LIBRARY_LOCK_STATES.open }
  if (!lock) return { state: LIBRARY_LOCK_STATES.checking }
  if (lock.unlocked) return { state: LIBRARY_LOCK_STATES.open }
  return { state: LIBRARY_LOCK_STATES.shut }
}

/**
 * Where a library stands with this browser's unlock. The lock is asked for
 * only when the library is locked; a library still on its way counts as
 * not locked, as nothing of it shows yet.
 */
export const useLibraryLock = (library: Library | undefined): LibraryLock => {
  const locked = library?.settings.locked ?? false
  const lock = useQuery({ ...lockQuery, enabled: locked })
  return lockState({ locked, lock: lock.data })
}
