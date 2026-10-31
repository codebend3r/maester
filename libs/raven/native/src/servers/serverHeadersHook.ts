import type { AccountSessionStore } from '@/account/accountSession'
import type { CookieJar } from '@/servers/cookieJar'
import { cookieHeadersFor } from '@/servers/serverHeaders'
import type { AppServer } from '@/servers/serverList'
import { useServerCookies } from '@/servers/useServerCookies'

type ServerHeadersForProps = {
  session: AccountSessionStore
  jar: Pick<CookieJar, 'read'>
}

type UseServerHeadersProps = { server: AppServer }

/**
 * The hook that gives the headers a request made outside `fetch` (a picture) carries: the
 * server's cookies from `jar` and the account's token, on its own API only. Null until the jar
 * has first answered, so nothing is asked for twice; it follows the jar's changes (an unlock)
 * and the token's refresh. Made per store at module scope, as `tokenRenewalFor` is.
 */
export const serverHeadersFor = ({ session, jar }: ServerHeadersForProps) => {
  const useServerHeaders = ({
    server,
  }: UseServerHeadersProps): ((url: string) => Record<string, string>) | null => {
    const cookies = useServerCookies({ server, jar })
    const accessToken = session((state) => state.session?.accessToken ?? null)
    return cookies === null ? null : cookieHeadersFor({ server, cookies, accessToken })
  }
  return useServerHeaders
}
