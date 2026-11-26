import { accountIdOf } from '@/account/accountChange'
import type { AccountSessionStore } from '@/account/accountSession'
import { IGNORED } from '@/lib/ignore'
import { keepSynced } from '@/servers/keepSynced'
import { deviceActivity } from '@/servers/serverClient'

type FollowAccountServersProps = {
  /** Reads the account's servers and their names into the app's list (`accountServersFor`'s). */
  sync: () => Promise<unknown>
  session: Pick<AccountSessionStore, 'subscribe'>
}

/**
 * Keeps an app's server list the account's, as the device app and Wren both do once their stores
 * are read: it reads the list at once, again whenever the account changes, and while the app is
 * in front every so often and on coming back (`keepSynced`, on React Native's `AppState` and
 * timers), so a server added or renamed on another device shows here too. A read that fails
 * keeps the list kept on the device. Hands back the way to stop.
 */
export const followAccountServers = ({
  sync,
  session,
}: FollowAccountServersProps): (() => void) => {
  sync().catch(IGNORED)
  const stopSyncing = keepSynced({
    sync,
    app: deviceActivity,
    repeat: ({ run, ms }) => {
      const timer = setInterval(run, ms)
      return () => clearInterval(timer)
    },
  })
  const unsubscribe = session.subscribe((state, previous) => {
    if (accountIdOf(state) !== accountIdOf(previous)) sync().catch(IGNORED)
  })
  return () => {
    stopSyncing()
    unsubscribe()
  }
}
