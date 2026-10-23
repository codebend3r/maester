import type { AppServer } from '@/servers/serverList'

/**
 * `make` memoised on the active server: the same value while it stays active, a new one once
 * another is. One is kept at a time, since the app talks to one server at a time.
 */
export const lastPerServer = <T extends object>(
  make: (server: AppServer) => T,
): ((server: AppServer) => T) => {
  const kept = new Map<string, T>()
  return (server) => {
    const known = kept.get(server.id)
    if (known !== undefined) return known
    const value = make(server)
    kept.clear()
    kept.set(server.id, value)
    return value
  }
}
