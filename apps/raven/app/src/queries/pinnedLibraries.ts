import {
  type ApiClient,
  type Library,
  libraryIconOf,
  pinnedIdsOn,
  pinnedLibrariesOn,
} from '@raven/core'
import { apiFor } from '@raven/native'
import { type AppServer, hasSeveralServers, pinServerIdOf } from '@raven/native/headless'
import { serverLibrariesQuery } from '@raven/ui/headless'
import { useQueries, useQuery } from '@tanstack/react-query'

import { useAccountSession } from '@/account/session'
import type { MenuLibrary } from '@/layouts/shelfKit'
import { usePins } from '@/queries/accountPins'
import type { AppQueries } from '@/queries/useAppQueries'
import { type Href, ROUTE_TARGETS, hrefOf } from '@/routes'
import { useActiveServer } from '@/stores/activeServer'

// One client a server, for its library list, so a render makes none again.
const otherApis = new Map<string, ApiClient>()

const apiOf = (server: AppServer): ApiClient => {
  const key = `${server.id} ${server.origin}`
  const known = otherApis.get(key)
  if (known !== undefined) return known
  const api = apiFor({ server, session: useAccountSession })
  otherApis.set(key, api)
  return api
}

type MenuLibraryOfProps = {
  library: Library
  server: AppServer
  /** Whether the list holds several servers, when each pin names its own. */
  hasSeveral: boolean
}

/** A pinned library as the menus list it, under its server. */
const menuLibraryOf = ({
  library: { id, name, settings },
  server,
  hasSeveral,
}: MenuLibraryOfProps): MenuLibrary => ({
  key: `${server.id}:${id}`,
  id,
  name,
  icon: libraryIconOf(settings),
  isLocked: settings.locked,
  serverId: server.id,
  serverName: hasSeveral ? server.name : null,
})

type PinnedLibrariesProps = Pick<AppQueries, 'queries'>

/**
 * The menus' pinned libraries: the account's pins on every server it keeps, server by server
 * in the list's order, each server's in its own order of its libraries. The server in use gives
 * its own listing; another is asked for its list through its own client. A pin whose library is
 * gone from its server, and the pins on a server that does not answer, are left out rather than
 * shown as links that open nothing; they come back once their server lists them again.
 */
export const usePinnedLibraries = ({ queries }: PinnedLibrariesProps): MenuLibrary[] => {
  const pins = usePins()
  const servers = useActiveServer((state) => state.servers)
  const activeId = useActiveServer((state) => state.activeId)
  const home = useActiveServer((state) => state.home)
  const homeServerId = useActiveServer((state) => state.homeServerId)
  const here = useQuery(queries.librariesQuery).data ?? []
  const listed = servers.map((server) => ({
    server,
    serverId: pinServerIdOf({ server, home, homeServerId }),
  }))
  // The other servers with pins to name: a server with no id of its own has none.
  const others = listed.flatMap(({ server, serverId }) =>
    serverId === null || server.id === activeId || pinnedIdsOn({ pins, serverId }).length === 0
      ? []
      : [{ server, serverId }],
  )
  const answers = useQueries({
    queries: others.map(({ server, serverId }) =>
      serverLibrariesQuery({ serverId, api: apiOf(server) }),
    ),
  })
  const theirs = new Map(
    others.map(({ server }, index) => [server.id, answers[index]?.data ?? []] as const),
  )
  const hasSeveral = hasSeveralServers({ servers })
  return listed.flatMap(({ server, serverId }) =>
    pinnedLibrariesOn({
      libraries: server.id === activeId ? here : (theirs.get(server.id) ?? []),
      pins,
      serverId,
    }).map((library) => menuLibraryOf({ library, server, hasSeveral })),
  )
}

type OpenPinnedProps = { library: MenuLibrary; go: (href: Href) => void }

/** Opens a pinned library, switching first to its server when it is on another. */
export const openPinned = ({ library, go }: OpenPinnedProps): void => {
  useActiveServer.getState().activate(library.serverId)
  go(hrefOf({ kind: ROUTE_TARGETS.library, libraryId: library.id, query: '' }))
}
