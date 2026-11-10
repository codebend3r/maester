import { useQuery } from '@tanstack/react-query'
import type { Library } from '@raven/core'
import { type LibraryLock, lockState } from '@raven/ui/headless'
import { lockQuery } from '@/lib/queries'

/**
 * Where a library stands with this browser's unlock (headless `lockState`). The lock is asked
 * for only when the library is locked; a library still on its way counts as not locked, as
 * nothing of it shows yet.
 */
export const useLibraryLock = (library: Library | undefined): LibraryLock => {
  const isLocked = library?.settings.locked ?? false
  const lock = useQuery({ ...lockQuery, enabled: isLocked })
  return lockState({ isLocked, lock: lock.data })
}
