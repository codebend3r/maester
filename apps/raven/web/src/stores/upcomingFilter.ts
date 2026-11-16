import { create } from 'zustand'
import { createJSONStorage, devtools, persist } from 'zustand/middleware'
import { STORE_KEYS } from '@/stores/storage'

type UpcomingFilterState = {
  /** Whether Coming soon's shelf pages leave out what is requested already. */
  isHidingRequested: boolean
  setHidingRequested: (isHidingRequested: boolean) => void
}

/** Coming soon's "Hide requested" choice, kept across its shelf pages and visits. */
export const useUpcomingFilter = create<UpcomingFilterState>()(
  devtools(
    persist(
      (set): UpcomingFilterState => ({
        isHidingRequested: false,
        setHidingRequested: (isHidingRequested) => set({ isHidingRequested }),
      }),
      {
        name: STORE_KEYS.upcomingFilter,
        storage: createJSONStorage(() => window.localStorage),
        partialize: ({ isHidingRequested }) => ({ isHidingRequested }),
      },
    ),
    { name: 'raven/upcomingFilter' },
  ),
)
