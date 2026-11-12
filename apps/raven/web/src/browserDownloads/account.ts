import { AUTH_CONFIG_STATES, type AuthConfig } from '@raven/core'
import { isAccountId, LOCAL_ACCOUNT } from '@/browserDownloads/entries'

type DownloadsAccountOfProps = {
  /** What the server last said of its accounts; null when this browser never heard. */
  authState: AuthConfig['state'] | null
  /** The signed-in account, or null when nobody is. */
  userId: string | null
  isOffline: boolean
  /** The account that last signed in here and has not signed out since. */
  remembered: string | null
}

/**
 * Whose downloads the browser shows and runs. With accounts off every viewer shares one; with
 * them on it is the signed-in account's, and while the server is out of reach, where a session
 * that ran out cannot be renewed, the account that last signed in and never signed out. Nobody's
 * otherwise: another account sees none of them, and a sign out hides them.
 */
export const downloadsAccountOf = ({
  authState,
  userId,
  isOffline,
  remembered,
}: DownloadsAccountOfProps): string | null => {
  if (authState === AUTH_CONFIG_STATES.off) return LOCAL_ACCOUNT
  if (authState !== AUTH_CONFIG_STATES.ready) return null
  const accountId = userId ?? (isOffline ? remembered : null)
  return isAccountId(accountId) ? accountId : null
}
