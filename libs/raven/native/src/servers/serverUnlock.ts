import { cookieJar } from '@/servers/serverClient'
import { useServerCookies } from '@/servers/useServerCookies'
import { isUnlockedBy } from '@/stores/cookieSnapshots'

type UseServerUnlockProps = { serverId: string }

/**
 * Whether this device holds `serverId`'s PIN unlock: the jar's last word, read as
 * `useServerCookies` reads it. False until the jar answers.
 */
export const useServerUnlock = ({ serverId }: UseServerUnlockProps): boolean =>
  isUnlockedBy(useServerCookies({ serverId, jar: cookieJar }))
