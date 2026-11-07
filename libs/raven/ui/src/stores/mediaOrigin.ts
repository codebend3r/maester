import type { MediaOrigin } from '@raven/core'
import { create } from 'zustand'
import { devtools } from 'zustand/middleware'

/** Where media plays from (null plays through the web host's own address), and when the host set it (epoch ms). */
export type MediaPick = {
  origin: MediaOrigin | null
  at: number
}

type MediaOriginState = {
  /** The host's pick; null until the host sets one. */
  pick: MediaPick | null
  setPick: (pick: MediaPick | null) => void
}

/**
 * The media origin the host sets as it starts. Nothing probes or falls
 * back: a host that names an origin plays every video and track from it,
 * and one that names none plays through its own address.
 */
export const useMediaOrigin = create<MediaOriginState>()(
  devtools(
    (set) => ({
      pick: null,
      setPick: (pick) => set({ pick }),
    }),
    { name: 'raven/mediaOrigin' },
  ),
)
