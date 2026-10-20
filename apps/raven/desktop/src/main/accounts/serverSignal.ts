type ServerListener = (input: { serverId: string }) => void

/**
 * Tells whoever listens that something happened to a server: a sign-in ended (`accessEnds`), or
 * the account signed in changed (`accountSwitches`). One listener's failure never keeps the rest
 * from hearing it.
 */
export type ServerSignal = {
  /** Returns the function that stops listening. */
  listen: (listener: ServerListener) => () => void
  notify: ServerListener
}

export const createServerSignal = (): ServerSignal => {
  let listeners: readonly ServerListener[] = []
  return {
    listen: (listener) => {
      listeners = [...listeners, listener]
      return () => {
        listeners = listeners.filter((known) => known !== listener)
      }
    },
    notify: (input) => {
      listeners.forEach((listener) => {
        try {
          listener(input)
        } catch {
          // One listener's failure must not keep the rest from hearing it.
        }
      })
    },
  }
}
