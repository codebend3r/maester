import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

type PlayerPrefs = {
  volume: number
  muted: boolean
  setVolume: ({ volume, muted }: { volume: number; muted: boolean }) => void
}

/** Volume carries over from one video to the next, and across visits. */
export const usePlayerPrefs = create<PlayerPrefs>()(
  persist(
    (set) => ({
      volume: 1,
      muted: false,
      setVolume: ({ volume, muted }) => set({ volume, muted }),
    }),
    {
      name: 'raven-player',
      storage: createJSONStorage(() => window.localStorage),
      partialize: ({ volume, muted }) => ({ volume, muted }),
    },
  ),
)
