import { useFollowAdminLock } from '@/lib/adminLock'
import { useServerEvents } from '@/lib/useServerEvents'

/**
 * What keeps the pages in step with the server while a shell is open: its
 * changes, and the admin lock coming on or going off. Left out while Raven
 * cannot reach its server.
 */
export const FollowServer = () => {
  useServerEvents()
  useFollowAdminLock()
  return null
}
