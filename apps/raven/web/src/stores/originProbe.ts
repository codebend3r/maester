import { create } from 'zustand'

type OriginProbe = {
  /** Probes the media origins again; null until `MediaOriginProbe` mounts. */
  reprobe: (() => void) | null
}

/** The media origin probe the app runs near its root, for a player that could not reach the origin picked. */
export const useOriginProbe = create<OriginProbe>()(() => ({ reprobe: null }))
