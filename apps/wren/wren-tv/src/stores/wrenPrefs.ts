import { isRecord } from '@raven/core'
import { loadPersisted } from '@raven/native/headless'
import { UNCONFIGURED_STORAGE } from '@raven/ui/headless'
import {
  COVER_SIZES,
  type CoverSize,
  DEFAULT_THEME_CHOICE,
  RECENT_SORTS,
  type RecentSort,
  type ThemeChoice,
  WREN_PREFS_KEY,
  isCoverSize,
  isLibraryPick,
  isRecentSort,
  themeChoiceIn,
  themeChoiceOf,
} from '@raven/wren'
import { configureLibraryChoice } from '@raven/wren-native/headless'
import { create } from 'zustand'
import { type StateStorage, createJSONStorage, persist } from 'zustand/middleware'
import { useShallow } from 'zustand/react/shallow'

/**
 * What the TV keeps of the listener's choices: the ones a TV has. The phone keeps the downloads'
 * and the cellular stream's too, which a TV has none of; the web keeps exactly these.
 */
type WrenPrefsValues = ThemeChoice & {
  /** The order of Home's albums. */
  homeSort: RecentSort
  /** How large Albums draws its covers. */
  coverSize: CoverSize
  /** The music library picked in Settings, by its id; null wears the server's first. */
  libraryId: number | null
}

type WrenPrefs = WrenPrefsValues & {
  /** Changes any of the preferences and keeps them on the TV. */
  change: (change: Partial<WrenPrefsValues>) => void
}

/** A first run: Paper and Night by the TV's scheme, Home's albums by when they were added, medium covers. */
export const DEFAULT_WREN_PREFS: WrenPrefsValues = {
  ...DEFAULT_THEME_CHOICE,
  homeSort: RECENT_SORTS.added,
  coverSize: COVER_SIZES.medium,
  libraryId: null,
}

/** What was read back, each preference kept only where it is one, the default otherwise. */
export const wrenPrefsOf = (saved: unknown): WrenPrefsValues => {
  const kept = isRecord(saved) ? saved : {}
  return {
    ...themeChoiceOf(saved),
    homeSort: isRecentSort(kept.homeSort) ? kept.homeSort : DEFAULT_WREN_PREFS.homeSort,
    coverSize: isCoverSize(kept.coverSize) ? kept.coverSize : DEFAULT_WREN_PREFS.coverSize,
    libraryId: isLibraryPick(kept.libraryId) ? kept.libraryId : DEFAULT_WREN_PREFS.libraryId,
  }
}

/** The version the prefs are kept at, the phone's and the web's, so every Wren reads one shape. */
const WREN_PREFS_VERSION = 1

/** Settings' themes, Home's order, Albums' cover size and the library, persisted to AsyncStorage. */
export const useWrenPrefs = create<WrenPrefs>()(
  persist(
    (set) => ({
      ...DEFAULT_WREN_PREFS,
      change: (change) => set(change),
    }),
    {
      name: WREN_PREFS_KEY,
      storage: createJSONStorage(() => UNCONFIGURED_STORAGE),
      skipHydration: true,
      version: WREN_PREFS_VERSION,
      // Whatever an older version kept is read through the same guard.
      migrate: wrenPrefsOf,
      partialize: (state: WrenPrefs) => wrenPrefsOf(state),
      merge: (saved, current) => ({ ...current, ...wrenPrefsOf(saved) }),
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
