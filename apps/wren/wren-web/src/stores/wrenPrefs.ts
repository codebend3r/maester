import {
  DEFAULT_SHARED_PREFS,
  type ThemeChoice,
  WREN_PREFS_KEY,
  WREN_PREFS_VERSION,
  type WrenSharedPrefs,
  sharedPrefsOf,
  themeChoiceIn,
} from '@raven/wren'
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { useShallow } from 'zustand/react/shallow'

/**
 * What this browser keeps of the listener's choices: the ones every Wren has. The apps keep the
 * downloads' and the cellular stream's too, which the web has none of.
 */
type WrenPrefs = WrenSharedPrefs & {
  /** Changes any of the preferences and keeps them in this browser. */
  change: (change: Partial<WrenSharedPrefs>) => void
}

/** Settings' themes, Home's order and Albums' cover size, persisted to localStorage and guarded when read. */
export const useWrenPrefs = create<WrenPrefs>()(
  persist(
    (set) => ({
      ...DEFAULT_SHARED_PREFS,
      change: (change) => set(change),
    }),
    {
      name: WREN_PREFS_KEY,
      storage: createJSONStorage(() => window.localStorage),
      version: WREN_PREFS_VERSION,
      // Whatever an older version kept is read through the same guard.
      migrate: sharedPrefsOf,
      // What is kept is what is read back: every value, through the same guard.
      partialize: (state: WrenPrefs) => sharedPrefsOf(state),
      merge: (saved, current) => ({ ...current, ...sharedPrefsOf(saved) }),
    },
  ),
)

/** The theme choice Settings' Appearance keeps, read whole and redrawn only when a part of it changes. */
export const useThemeChoice = (): ThemeChoice => useWrenPrefs(useShallow(themeChoiceIn))
