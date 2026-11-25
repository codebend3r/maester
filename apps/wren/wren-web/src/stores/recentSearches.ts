import {
  RECENT_SEARCHES_KEY,
  type RecentSearch,
  mergedRecentsOf,
  withRecent,
  withoutRecent,
} from '@raven/wren'
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

type RecentSearchesState = {
  recents: RecentSearch[]
  /** Remembers a search submitted, or the artist or album a search opened. */
  remember: (recent: RecentSearch) => void
  forget: (key: string) => void
  clear: () => void
}

/** Search's recent searches in this browser, persisted to localStorage and guarded when read. */
export const useRecentSearches = create<RecentSearchesState>()(
  persist(
    (set) => ({
      recents: [],
      remember: (recent) => set(({ recents }) => ({ recents: withRecent({ recents, recent }) })),
      forget: (key) => set(({ recents }) => ({ recents: withoutRecent({ recents, key }) })),
      clear: () => set({ recents: [] }),
    }),
    {
      name: RECENT_SEARCHES_KEY,
      storage: createJSONStorage(() => window.localStorage),
      partialize: ({ recents }) => ({ recents }),
      // What was searched before the list was read stays on top of what was read.
      merge: (saved, current) => ({
        ...current,
        recents: mergedRecentsOf({ current: current.recents, saved }),
      }),
    },
  ),
)
