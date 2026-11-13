type Listener = () => void

/**
 * Tells whoever listens that something happened to the page's account: its sign-in ended
 * (`accessEnds`), or the account signed in changed (`accountSwitches`). One listener's failure
 * never keeps the rest from hearing it.
 */
export type AccountSignal = {
  /** Returns the function that stops listening. */
  listen: (listener: Listener) => () => void
  notify: () => void
}

export const createAccountSignal = (): AccountSignal => {
  let listeners: readonly Listener[] = []
  return {
    listen: (listener) => {
      listeners = [...listeners, listener]
      return () => {
        listeners = listeners.filter((known) => known !== listener)
      }
    },
    notify: () => {
      listeners.forEach((listener) => {
        try {
          listener()
        } catch {
          // One listener's failure must not keep the rest from hearing it.
        }
      })
    },
  }
}
