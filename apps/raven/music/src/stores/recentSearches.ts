import { loadPersisted } from '@raven/native/headless'
import { UNCONFIGURED_STORAGE } from '@raven/ui/headless'
import {
  RECENT_SEARCHES_KEY,
  type RecentSearch,
  mergedRecentsOf,
  withRecent,
  withoutRecent,
} from '@raven/wren'
import { create } from 'zustand'
import { type StateStorage, createJSONStorage, persist } from 'zustand/middleware'

type RecentSearchesState = {
  recents: RecentSearch[]
  /** Remembers a search submitted, or the artist or album a search opened. */
  remember: (recent: RecentSearch) => void
  forget: (key: string) => void
  clear: () => void
}

/** Search's recent searches on this device, persisted to AsyncStorage and guarded when read. */
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
      storage: createJSONStorage(() => UNCONFIGURED_STORAGE),
      skipHydration: true,
      partialize: ({ recents }) => ({ recents }),
      // What was searched before the list was read stays on top of what was read.
      merge: (saved, current) => ({
        ...current,
        recents: mergedRecentsOf({ current: current.recents, saved }),
      }),
    },
  ),
)

type ConfigureRecentSearchesProps = { storage: StateStorage }

/** Gives the recent searches their storage, AsyncStorage in the app, and reads them back from it. */
export const configureRecentSearches = async ({ storage }: ConfigureRecentSearchesProps) => {
  await loadPersisted({ store: useRecentSearches, storage })
}
