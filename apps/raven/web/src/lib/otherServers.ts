import type { ApiClient, ServerId, checkServerAt } from '@raven/core'
import { desktopReadsOf } from '@/desktop/servers'
import { apiAt } from '@/lib/api'
import type { Desktop } from '@/stores/desktop'

/** A server the page reads without using it: its id, and where its API is called from the page. */
type ReadServer = { serverId: ServerId; apiBase: string }

/** A new server's id from its health, as core's check of it asks: null inside for one too old to have one. */
type HealthIdAt = Parameters<typeof checkServerAt>[0]['healthIdAt']

type LibrariesOf = (server: ReadServer) => Pick<ApiClient, 'listLibraries'>

/** How the page reads a server it is not using: a new one's health, and another's libraries. */
export type OtherServerReads = {
  /** Its id from its open health, or null when it does not answer or lets this page not read it. */
  healthIdAt: HealthIdAt
  librariesOf: LibrariesOf
}

/** A browser's reads, through each server's own client. */
const PAGE_READS: OtherServerReads = {
  healthIdAt: async (origin) => {
    try {
      const health = await apiAt(origin).getServerHealth()
      return { serverId: health.serverId ?? null }
    } catch {
      return null
    }
  },
  librariesOf: ({ apiBase }) => apiAt(apiBase),
}

/** Inside Raven the page may call no other origin, so main reads the other servers for it. */
export const otherServerReadsFor = (desktop: Desktop | null): OtherServerReads =>
  desktop === null ? PAGE_READS : desktopReadsOf(desktop.client)
