import { useId, useLayoutEffect } from 'react'
import { create } from 'zustand'
import { createJSONStorage, devtools, persist } from 'zustand/middleware'
import { STORE_KEYS, UNCONFIGURED_STORAGE } from '@/stores/storage'
import type { PlayerServices } from '@/components/Player/PlayerServices'

type PlayerServicesState = {
  /** The host that set `services`, so a player never starts on the previous host's. */
  host: string | null
  services: PlayerServices | null
}

const EMPTY: PlayerServicesState = { host: null, services: null }

/** What the host on screen gives its player: the title, progress, escape and the rest. */
export const usePlayerServices = create<PlayerServicesState>()(
  devtools(
    persist(() => EMPTY, {
      name: STORE_KEYS.playerServices,
      storage: createJSONStorage(() => UNCONFIGURED_STORAGE),
      partialize: () => ({}),
    }),
    { name: 'raven/playerServices' },
  ),
)

/** The player's own parts read the host's services here; the host sets them before the player renders. */
export const useHostServices = (): PlayerServices => {
  const services = usePlayerServices((state) => state.services)
  if (services === null) throw new Error('The host sets the player services before the player')
  return services
}

/**
 * For the component that renders the player: puts its services in the store
 * after each render that changes them, and answers whether the store holds
 * this host's yet. The host renders the player only once it does, so the
 * player's first render reads them, never the previous host's.
 *
 * A player reads its starting point (where to resume) on its first render, so
 * call this in the component whose lifetime is the player's: a player mounted
 * by a later render of the same host would read the services of the render
 * before.
 */
export const useHostPlayer = (services: PlayerServices): boolean => {
  const host = useId()
  const isHosting = usePlayerServices((state) => state.host === host)
  useLayoutEffect(() => {
    usePlayerServices.setState({ host, services })
  }, [host, services])
  useLayoutEffect(
    () => () => {
      if (usePlayerServices.getState().host === host) usePlayerServices.setState(EMPTY)
    },
    [host],
  )
  return isHosting
}
