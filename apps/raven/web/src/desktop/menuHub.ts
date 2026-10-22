import type { MenuPlayerAction } from '@raven/core'

export type MenuHub = {
  emit: (action: MenuPlayerAction) => void
  subscribe: (listener: (action: MenuPlayerAction) => void) => () => void
}

/** The Playback menu's actions, from the page that hears them to the player that acts on them. */
export const createMenuHub = (): MenuHub => {
  const listeners = new Set<(action: MenuPlayerAction) => void>()
  return {
    emit: (action) => listeners.forEach((listener) => listener(action)),
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
