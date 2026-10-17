import { createContext, type ReactNode, useContext } from 'react'
import type { PlayerAction } from '@/lib/shortcuts'

export type ProgressSink = {
  started: () => void
  save: (position: number) => void
  left: (position: number) => void
  /** The engine learned how long the video is. */
  duration?: (seconds: number) => void
}

/** A host (the desktop menu, say) that sends the player actions of its own. */
export type HostActions = {
  subscribe: (listener: (action: PlayerAction) => void) => () => void
}

/** The playing video's favourite, for a host that keeps them; the host owns the change. */
export type PlayerFavourite = {
  isFavourite: boolean
  toggle: () => void
}

export type PlayerTitle = {
  label: string
  duration: number | null
  resumeAt: number
  backTo: string
  next: { to: string; state: unknown; label: string } | null
}

export type PlayerServices = {
  title: PlayerTitle
  progress: ProgressSink
  posterUrl: string | null
  escape: { label: string; run: () => void } | null
  /** The host owns feedback from its escape action, including clipboard failures. */
  escapeFeedback?: string | null
  hostActions?: HostActions
  /** Without it the player shows no heart, as a local file has no favourite. */
  favourite?: PlayerFavourite
}

const Services = createContext<PlayerServices | null>(null)

export const PlayerServicesProvider = ({
  services,
  children,
}: {
  services: PlayerServices
  children: ReactNode
}) => <Services.Provider value={services}>{children}</Services.Provider>

export const usePlayerServices = (): PlayerServices => {
  const services = useContext(Services)
  if (!services) throw new Error('PlayerServicesProvider is required')
  return services
}
