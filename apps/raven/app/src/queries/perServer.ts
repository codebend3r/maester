import type { AppServer } from '@raven/native/headless'

type LastPerServerProps<T extends object> = {
  make: (server: AppServer) => T
  drop?: (value: T) => void
}

/**
 * `make` memoised on the active server: the same value while it stays active, a new one once
 * another is, when the last one is handed to `drop` to let go of what it holds. One is kept at
 * a time, since the app talks to one server at a time.
 */
export const lastPerServer = <T extends object>({
  make,
  drop = () => undefined,
}: LastPerServerProps<T>): ((server: AppServer) => T) => {
  const kept = new Map<string, T>()
  return (server) => {
    const known = kept.get(server.id)
    if (known !== undefined) return known
    const value = make(server)
    kept.forEach(drop)
    kept.clear()
    kept.set(server.id, value)
    return value
  }
}
