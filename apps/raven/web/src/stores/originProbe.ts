import { create } from 'zustand'
import { createJSONStorage, devtools, persist } from 'zustand/middleware'
import { STORE_KEYS } from '@/stores/storage'

type OriginProbe = {
  /** Probes the media origins again; null until `MediaOriginProbe` mounts. */
  reprobe: (() => void) | null
}

/** The media origin probe the app runs near its root, for a player that could not reach the origin picked. */
export const useOriginProbe = create<OriginProbe>()(
  devtools(
    persist((): OriginProbe => ({ reprobe: null }), {
      name: STORE_KEYS.originProbe,
      storage: createJSONStorage(() => window.localStorage),
      partialize: () => ({}),
    }),
    { name: 'raven/originProbe' },
  ),
)
