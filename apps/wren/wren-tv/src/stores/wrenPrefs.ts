import { loadPersisted } from '@raven/native/headless'
import { UNCONFIGURED_STORAGE } from '@raven/ui/headless'
import {
  DEFAULT_SHARED_PREFS,
  type ThemeChoice,
  WREN_PREFS_KEY,
  WREN_PREFS_VERSION,
  type WrenSharedPrefs,
  sharedPrefsOf,
  themeChoiceIn,
} from '@raven/wren'
import { configureLibraryChoice } from '@raven/wren-native/headless'
import { create } from 'zustand'
import { type StateStorage, createJSONStorage, persist } from 'zustand/middleware'
import { useShallow } from 'zustand/react/shallow'

/**
 * What the TV keeps of the listener's choices: the ones every Wren has. The phone keeps the
 * downloads' and the cellular stream's too, which a TV has none of; the web keeps exactly these.
 */
type WrenPrefs = WrenSharedPrefs & {
  /** Changes any of the preferences and keeps them on the TV. */
  change: (change: Partial<WrenSharedPrefs>) => void
}

/** Settings' themes, Home's order, Albums' cover size and the library, persisted to AsyncStorage. */
export const useWrenPrefs = create<WrenPrefs>()(
  persist(
    (set) => ({
      ...DEFAULT_SHARED_PREFS,
      change: (change) => set(change),
    }),
    {
      name: WREN_PREFS_KEY,
      storage: createJSONStorage(() => UNCONFIGURED_STORAGE),
      skipHydration: true,
      version: WREN_PREFS_VERSION,
      // Whatever an older version kept is read through the same guard.
      migrate: sharedPrefsOf,
      partialize: (state: WrenPrefs) => sharedPrefsOf(state),
      merge: (saved, current) => ({ ...current, ...sharedPrefsOf(saved) }),
    },
  ),
)

/** The theme choice Settings' Appearance keeps, read whole and redrawn only when a part of it changes. */
export const useThemeChoice = (): ThemeChoice => useWrenPrefs(useShallow(themeChoiceIn))

type ConfigureWrenPrefsProps = { storage: StateStorage }

/** Gives the preferences their storage, AsyncStorage on the TV, and reads them back from it. */
export const configureWrenPrefs = async ({ storage }: ConfigureWrenPrefsProps) => {
  await loadPersisted({ store: useWrenPrefs, storage })
}

// The shared listings read the music library picked here, in this app's own prefs.
configureLibraryChoice({ prefs: useWrenPrefs })
