import type { LockState } from '@raven/core'

/**
 * Whether a library is open to this device: open when it is not locked or the owner entered
 * the PIN here, shut until then, and checking while the server has yet to say. `canUnlock` is
 * whether this account may enter the PIN: the owner, on a raven with `LIBRARY_PIN` set.
 */
export const LIBRARY_LOCK_STATES = { open: 'open', checking: 'checking', shut: 'shut' } as const

export type LibraryLock =
  | { state: typeof LIBRARY_LOCK_STATES.open }
  | { state: typeof LIBRARY_LOCK_STATES.checking }
  | { state: typeof LIBRARY_LOCK_STATES.shut; canUnlock: boolean }

type LockStateProps = {
  isLocked: boolean
  /** The server's answer to `GET /api/lock`, or undefined while it has yet to say. */
  lock: LockState | undefined
}

export const lockState = ({ isLocked, lock }: LockStateProps): LibraryLock => {
  if (!isLocked) return { state: LIBRARY_LOCK_STATES.open }
  if (lock === undefined) return { state: LIBRARY_LOCK_STATES.checking }
  if (lock.unlocked) return { state: LIBRARY_LOCK_STATES.open }
  return { state: LIBRARY_LOCK_STATES.shut, canUnlock: lock.available }
}
