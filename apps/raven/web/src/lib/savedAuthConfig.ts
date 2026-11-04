import { type QueryClient, hashKey } from '@tanstack/react-query'
import { isAuthConfig } from '@raven/core'
import { authConfigQuery } from '@/lib/queries'

/** Where the server's last auth config is kept: its public settings only, never a session. */
export const AUTH_CONFIG_KEY = 'raven-auth-config'

type ConfigStorage = Pick<Storage, 'getItem' | 'setItem'>

type SavedAuthConfigProps = {
  storage: ConfigStorage
  queryClient: QueryClient
}

const readSaved = (storage: ConfigStorage): unknown => {
  try {
    return JSON.parse(storage.getItem(AUTH_CONFIG_KEY) ?? 'null')
  } catch {
    // Storage refused, or a value that is not JSON: nothing saved.
    return null
  }
}

/**
 * Puts the config this device last read in the cache before the app renders,
 * so a return visit starts its session at once instead of after a round trip
 * to the server, and marks it stale so the gate's first read asks the server
 * again. The server's answer replaces it: the session starts only once, and
 * the config only changes when the server restarts with other settings.
 */
export const restoreAuthConfig = ({ storage, queryClient }: SavedAuthConfigProps): void => {
  const saved = readSaved(storage)
  if (!isAuthConfig(saved)) return
  queryClient.setQueryData(authConfigQuery.queryKey, saved)
  queryClient
    .invalidateQueries({ queryKey: authConfigQuery.queryKey, refetchType: 'none' })
    .catch(() => undefined)
}

/** Saves the config each time the server answers for it. Returns what stops it. */
export const keepAuthConfigSaved = ({ storage, queryClient }: SavedAuthConfigProps): (() => void) =>
  queryClient.getQueryCache().subscribe((event) => {
    if (event.type !== 'updated' || event.action.type !== 'success') return
    if (event.query.queryHash !== hashKey(authConfigQuery.queryKey)) return
    try {
      storage.setItem(AUTH_CONFIG_KEY, JSON.stringify(event.action.data))
    } catch {
      // Storage refused, as in a locked-down private window: the next visit asks the server first.
    }
  })
