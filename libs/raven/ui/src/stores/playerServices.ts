import { useId, useLayoutEffect } from 'react'
import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import { useAudioQueue } from '@/stores/audioQueue'
import type { PlayerServices } from '@/components/Player/PlayerServices'

type PlayerServicesState = {
  /** The host that set `services`, so a player never starts on the previous host's. */
  host: string | null
  services: PlayerServices | null
}

const EMPTY: PlayerServicesState = { host: null, services: null }

/** What the host on screen gives its player: the title, progress, escape and the rest. */
export const usePlayerServices = create<PlayerServicesState>()(
  devtools(() => EMPTY, { name: 'raven/playerServices' }),
)

/** Reads one part of the host's services. */
type ServiceSelector<T> = (services: PlayerServices) => T

const UNSET = new Error('The host sets the player services before the player')

/**
 * The player's own parts read one of the host's services here, by selector, so each
 * re-renders only when its part changes; the host sets them before the player renders.
 */
export const useHostServices = <T>(select: ServiceSelector<T>): T =>
  usePlayerServices((state) => {
    if (state.services === null) throw UNSET
    return select(state.services)
  })

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
  // Starting a video pauses the music; starting music closes nothing.
  useLayoutEffect(() => {
    useAudioQueue.getState().pause()
  }, [])
  useLayoutEffect(
    () => () => {
      if (usePlayerServices.getState().host === host) usePlayerServices.setState(EMPTY)
    },
    [host],
  )
  return isHosting
}
