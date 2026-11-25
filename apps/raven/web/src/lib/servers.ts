import { useQuery } from '@tanstack/react-query'
import {
  type AccountServer,
  CHECK_OUTCOMES,
  SERVER_CHECK_PROBLEMS,
  type ServerCheck,
  type ServerId,
  URL_PROTOCOLS,
  checkServerAt,
  serverNameFor,
  serverOriginOf,
} from '@raven/core'
import {
  type ActiveServer,
  accountServersQuery,
  serverNamesQuery,
  useActiveServer,
} from '@raven/ui/headless'
import { useNavigate } from 'react-router-dom'
import { DESKTOP_HOST_COPY } from '@/desktop/copy'
import { useAccountData } from '@/lib/accountData'
import { serverOrigin } from '@/lib/apiOrigin'
import { APP_PATHS } from '@/lib/appPaths'
import { otherServerReadsFor } from '@/lib/otherServers'
import { authConfigQuery } from '@/lib/queries'
import { useDesktopBridge, useIsDesktop } from '@/stores/desktop'

/** The two kinds of server on the list: the one the page came from, and the account's others. */
export const SERVER_KINDS = { home: 'home', account: 'account' } as const

type ServerFacts = {
  /** What the list keys it by: the server's id, or the home kind for a home server too old to have one. */
  key: string
  name: string
  /** The server's own address, as it is shown and linked. */
  origin: string
  /** Where its API is called: '' for the page's own `/api`, else its origin. */
  apiBase: string
}

/** The server the page came from. */
export type HomeEntry = ServerFacts & {
  kind: typeof SERVER_KINDS.home
  /** Left out by a server older than multi-server support, which no pin or row can name. */
  serverId: ServerId | null
}

/** One of the account's own servers on the list. */
export type AccountEntry = ServerFacts & {
  kind: typeof SERVER_KINDS.account
  serverId: ServerId
  /** The account's row for it, which a rename or a removal names. */
  rowId: string
}

/** A server on the viewer's list. */
export type ServerEntry = HomeEntry | AccountEntry

type IsReachableFromPageProps = {
  origin: string
  /** The page's own protocol, `window.location`'s unless a test names another. */
  pageProtocol?: string
}

/**
 * Whether this page can call `origin` at all: a page served over https may not call an http
 * server (mixed content), which the browser refuses without a word, so the list shows such a
 * server as needing an https address instead.
 */
export const isReachableFromPage = ({
  origin,
  pageProtocol = window.location.protocol,
}: IsReachableFromPageProps): boolean =>
  pageProtocol !== URL_PROTOCOLS.https || !origin.startsWith(URL_PROTOCOLS.http)

/**
 * The server the page came from: its origin as `serverOrigin` names it, and its id once read.
 * It goes by the name the account gave it, else by its address; inside Raven the page's origin
 * is main's loopback host, so there it goes by raven's name instead.
 */
export const useHomeServer = (): HomeEntry => {
  const serverId = useQuery(authConfigQuery).data?.serverId ?? null
  const names = useQuery(serverNamesQuery(useAccountData())).data ?? []
  const isDesktop = useIsDesktop()
  const origin = serverOrigin()
  const fallback = isDesktop ? DESKTOP_HOST_COPY.homeServer : serverNameFor(origin)
  return {
    kind: SERVER_KINDS.home,
    key: serverId ?? SERVER_KINDS.home,
    serverId,
    name: names.find((named) => named.serverId === serverId)?.name ?? fallback,
    origin,
    apiBase: '',
  }
}

const accountEntryOf = (row: AccountServer): AccountEntry => ({
  kind: SERVER_KINDS.account,
  key: row.serverId,
  serverId: row.serverId,
  rowId: row.id,
  name: row.name,
  origin: row.origin,
  apiBase: row.origin,
})

/**
 * The viewer's servers: the home one first, then the account's others in the order they were
 * added. A row naming the home server itself (added by another of its addresses) is left out.
 */
export const useServers = (): ServerEntry[] => {
  const home = useHomeServer()
  const rows = useQuery(accountServersQuery(useAccountData())).data ?? []
  return [home, ...rows.filter((row) => row.serverId !== home.serverId).map(accountEntryOf)]
}

/** Whether the account keeps more than the home server, so each place names which one it means. */
export const keepsSeveralServers = (servers: readonly ServerEntry[]): boolean => servers.length > 1

/**
 * The name of the server in use while the account keeps several, which the Libraries page shows
 * on every library whatever the pins' choice; null while there is only the one.
 */
export const useActiveServerName = (): string | null => {
  const servers = useServers()
  const active = useActiveServer((state) => state.active)
  if (!keepsSeveralServers(servers)) return null
  return servers.find((server) => isActiveEntry({ server, active }))?.name ?? null
}

/** The active server's id: the home one's (null for one too old to have one) or the one chosen. */
export const useActiveServerId = (): ServerId | null => {
  const active = useActiveServer((state) => state.active)
  const home = useHomeServer()
  return active?.serverId ?? home.serverId
}

/** `server` as the store holds the one in use: null for the home one. */
const activeOf = (server: ServerEntry): ActiveServer | null =>
  server.kind === SERVER_KINDS.home ? null : { serverId: server.serverId, origin: server.origin }

type IsActiveEntryProps = { server: ServerEntry; active: ActiveServer | null }

/** Whether `server` is the one in use, by the active server the store holds. */
export const isActiveEntry = ({ server, active }: IsActiveEntryProps): boolean =>
  (activeOf(server)?.serverId ?? null) === (active?.serverId ?? null)

/** Uses `server` from now on, which `followActiveServer` (main.tsx) follows. */
export const switchTo = (server: ServerEntry): void =>
  useActiveServer.getState().choose(activeOf(server))

/** Whether the page is on another server than its home one. */
export const useIsAway = (): boolean => useActiveServer((state) => state.active !== null)

/**
 * Opens `server`'s Home on it, since the page open was the last server's; the one in use stays
 * where it is. What every server picker does with a choice.
 */
export const useOpenServer = (): ((server: ServerEntry) => void) => {
  const navigate = useNavigate()
  return (server) => {
    if (isActiveEntry({ server, active: useActiveServer.getState().active })) return
    switchTo(server)
    navigate(APP_PATHS.home)
  }
}

/** Why a new server was not added: core's reasons, and the web's own for an http server an https page could never call. */
export const ADD_PROBLEMS = { ...SERVER_CHECK_PROBLEMS, needsHttps: 'needsHttps' } as const

export type AddProblem = (typeof ADD_PROBLEMS)[keyof typeof ADD_PROBLEMS]

/** Core's check of a new server, or the web's own refusal of an address this page could never call. */
type NewServerCheck =
  | ServerCheck
  | { kind: typeof CHECK_OUTCOMES.refused; problem: typeof ADD_PROBLEMS.needsHttps }

type CheckNewServerProps = {
  address: string
  servers: readonly ServerEntry[]
  /** The page's own protocol, `window.location`'s unless a test names another. */
  pageProtocol?: string
}

/**
 * Reads a typed address the way every client reads one (`serverOriginOf`), refuses one that is no
 * origin and an http one this https page could never call, then checks the rest by core's
 * `checkServerAt`, every client's rules: one already listed, a full list, a server that does not
 * answer (or does not let this page call it) and one too old to have an id are each refused with why.
 */
export const checkNewServer = async ({
  address,
  servers,
  pageProtocol,
}: CheckNewServerProps): Promise<NewServerCheck> => {
  const origin = serverOriginOf(address)
  if (origin === null) return { kind: CHECK_OUTCOMES.refused, problem: ADD_PROBLEMS.address }
  if (!isReachableFromPage({ origin, pageProtocol })) {
    return { kind: CHECK_OUTCOMES.refused, problem: ADD_PROBLEMS.needsHttps }
  }
  const { healthIdAt } = otherServerReadsFor(useDesktopBridge.getState().desktop)
  return checkServerAt({ origin, servers, healthIdAt })
}
