import { type Query, type QueryClient, hashKey } from '@tanstack/react-query'
import { queryKeys } from '@/query/queryClient'
import { type ActiveServer, onActiveServerChange, useActiveServer } from '@/stores/activeServer'
import { mediaOriginOf, useMediaOrigin } from '@/stores/mediaOrigin'

const AUTH_CONFIG_HASH = hashKey(queryKeys.authConfig)

/**
 * What a change of server leaves in the cache: the account's own rows (its servers and pins,
 * and the other servers' libraries read for them) and the home server's account config, which
 * the session is built from. Everything else was the last server's.
 */
const isKeptAcrossServers = (query: Query): boolean =>
  query.queryKey[0] === queryKeys.accountData[0] || query.queryHash === AUTH_CONFIG_HASH

type FollowActiveServerProps = {
  queryClient: QueryClient
  /** The home server's origin when the page's `/api` is a proxy to it; '' when `/api` is the server. */
  apiOrigin: string
  /** Anything else of the last server's the host keeps outside the cache, dropped on a switch. */
  onSwitch?: () => void
}

/**
 * Keeps the page on the active server: media plays from its origin, and a switch empties the
 * cache of what the last server answered (everything but `isKeptAcrossServers`), so no page
 * shows one server's libraries under another's. Queries are reset, not removed, so whatever is
 * on screen asks the new server at once, and a fetch from the last one still under way is
 * called off. Returns what stops it.
 */
export const followActiveServer = ({
  queryClient,
  apiOrigin,
  onSwitch = () => undefined,
}: FollowActiveServerProps): (() => void) => {
  /*
   * Media plays from the home server as the page names it, or from another server's own origin,
   * which the ticketed media plane opens with no cookie.
   */
  const pickFor = (active: ActiveServer | null): void => {
    const origin = mediaOriginOf({ apiOrigin: active?.origin ?? apiOrigin })
    useMediaOrigin.getState().setPick(origin === null ? null : { origin, at: Date.now() })
  }
  pickFor(useActiveServer.getState().active)
  return onActiveServerChange((active) => {
    pickFor(active)
    onSwitch()
    queryClient
      .resetQueries({ predicate: (query) => !isKeptAcrossServers(query) })
      .catch(() => undefined)
  })
}
