import { useQueries, useQuery } from '@tanstack/react-query'
import {
  DEFAULT_ACCOUNT_PREFERENCES,
  type Library,
  type LibraryPin,
  type ServerId,
  pinnedIdsOn,
  pinnedLibrariesOn,
} from '@raven/core'
import {
  accountPreferencesQuery,
  libraryPinsQuery,
  serverLibrariesQuery,
  useActiveServer,
} from '@raven/ui/headless'
import { useAccountData } from '@/lib/accountData'
import { otherServerReadsFor } from '@/lib/otherServers'
import { librariesQuery } from '@/lib/queries'
import {
  type ServerEntry,
  isActiveEntry,
  isReachableFromPage,
  keepsSeveralServers,
  switchTo,
  useActiveServerId,
  useServers,
} from '@/lib/servers'
import { useDesktopBridge } from '@/stores/desktop'
import { useServerReach } from '@/stores/serverReach'

/** A library the account pinned, with the server it is on. */
export type PinnedLibrary = {
  /** Unique across servers, as two servers may each have a library 3. */
  key: string
  library: Library
  server: ServerEntry
  /** Its server's name, shown under it while the account keeps several servers and has not turned that off. */
  serverNote: string | undefined
  /** Whether its server is the one in use, so it opens without a switch. */
  isOnActiveServer: boolean
}

/** Opening a pin on another server than the one in use switches to it first. */
export const followPin = ({ server, isOnActiveServer }: PinnedLibrary): void => {
  if (!isOnActiveServer) switchTo(server)
}

/** The account's pins on every server, as its database holds them; none while there is none. */
export const usePins = (): LibraryPin[] => useQuery(libraryPinsQuery(useAccountData())).data ?? []

/** The ids of the libraries pinned on the server in use. */
export const usePinnedHere = (): readonly number[] => {
  const pins = usePins()
  const serverId = useActiveServerId()
  return pinnedIdsOn({ pins, serverId })
}

type PinnedOnProps = Omit<PinnedLibrary, 'key' | 'library'> & {
  libraries: readonly Library[]
  pins: readonly LibraryPin[]
}

/** A server's pinned libraries, in that server's own order of them. */
const pinnedOn = ({ libraries, pins, ...shared }: PinnedOnProps): PinnedLibrary[] =>
  pinnedLibrariesOn({ libraries, pins, serverId: shared.server.serverId }).map((library) => ({
    key: `${shared.server.key}:${library.id}`,
    library,
    ...shared,
  }))

/** Whether pins name their server: the account's choice, on until it turns it off. */
const useShowPinServers = (): boolean =>
  useQuery(accountPreferencesQuery(useAccountData())).data?.showPinServers ??
  DEFAULT_ACCOUNT_PREFERENCES.showPinServers

/** A server that says its id, which a pin can name. */
type NamedServer = ServerEntry & { serverId: ServerId }

const isNamed = (server: ServerEntry): server is NamedServer => server.serverId !== null

/**
 * The side menu's pinned libraries: the account's pins on every server it keeps, server by server
 * in the list's order, each server's in its own order of its libraries. The server in use gives
 * its libraries from the page's own listing; another server is asked for its list through its
 * own client. A pin whose library is gone from its server (deleted, or locked for this account)
 * and the pins on a server that does not answer, or that this page may not call, are left out
 * rather than shown as links that would open nothing; they come back once their server lists
 * them again. While the server in use is out of reach none show, since they would open pages
 * that need it. Each names its server while the account keeps several, unless it turned that off.
 */
export const usePinnedLibraries = (): PinnedLibrary[] => {
  const isOffline = useServerReach((state) => state.isOffline)
  const servers = useServers()
  const active = useActiveServer((state) => state.active)
  const pins = usePins()
  const shouldNameServers = useShowPinServers() && keepsSeveralServers(servers)
  const reads = otherServerReadsFor(useDesktopBridge((state) => state.desktop))
  const here = useQuery({ ...librariesQuery, enabled: !isOffline }).data ?? []
  const others = servers
    .filter(isNamed)
    .filter(
      (server) =>
        !isActiveEntry({ server, active }) &&
        pins.some((pin) => pin.serverId === server.serverId) &&
        isReachableFromPage({ origin: server.origin }),
    )
  const theirs = useQueries({
    queries: others.map(({ serverId, apiBase }) => ({
      ...serverLibrariesQuery({ serverId, api: reads.librariesOf({ serverId, apiBase }) }),
      enabled: !isOffline,
    })),
  })
  if (isOffline) return []
  const librariesOf = (serverId: ServerId | null): readonly Library[] =>
    theirs[others.findIndex((server) => server.serverId === serverId)]?.data ?? []
  return servers.flatMap((server) => {
    const isOnActiveServer = isActiveEntry({ server, active })
    const libraries = isOnActiveServer ? here : librariesOf(server.serverId)
    const serverNote = shouldNameServers ? server.name : undefined
    return pinnedOn({ server, serverNote, libraries, pins, isOnActiveServer })
  })
}
