import { isRecord } from '@raven/core'
import {
  COVER_SIZES,
  type CoverSize,
  DEFAULT_THEME_CHOICE,
  RECENT_SORTS,
  STATUS_COPY,
  type RecentSort,
  type ThemeChoice,
  WREN_PREFS_KEY,
  isCoverSize,
  isLibraryPick,
  isRecentSort,
  isServerNamePick,
  themeChoiceIn,
  themeChoiceOf,
} from '@raven/wren'
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { useShallow } from 'zustand/react/shallow'

/**
 * What this browser keeps of the listener's choices: the ones a browser has. The apps keep the
 * downloads' and the cellular stream's too, which the web has none of.
 */
type WrenPrefsValues = ThemeChoice & {
  /** The order of Home's albums. */
  homeSort: RecentSort
  /** How large Albums draws its covers. */
  coverSize: CoverSize
  /** The music library picked in Settings, by its id; null wears the server's first. */
  libraryId: number | null
  /** The name given the server on this device; null wears the server's own. */
  serverName: string | null
}

type WrenPrefs = WrenPrefsValues & {
  /** Changes any of the preferences and keeps them in this browser. */
  change: (change: Partial<WrenPrefsValues>) => void
}

/** A first visit: Paper and Night by the device's scheme, Home's albums by when they were added, medium covers. */
export const DEFAULT_WREN_PREFS: WrenPrefsValues = {
  ...DEFAULT_THEME_CHOICE,
  homeSort: RECENT_SORTS.added,
  coverSize: COVER_SIZES.medium,
  libraryId: null,
  serverName: null,
}

/** What was read back, each preference kept only where it is one, the default otherwise. */
const prefsOf = (saved: unknown): WrenPrefsValues => {
  const kept = isRecord(saved) ? saved : {}
  return {
    ...themeChoiceOf(saved),
    homeSort: isRecentSort(kept.homeSort) ? kept.homeSort : DEFAULT_WREN_PREFS.homeSort,
    coverSize: isCoverSize(kept.coverSize) ? kept.coverSize : DEFAULT_WREN_PREFS.coverSize,
    libraryId: isLibraryPick(kept.libraryId) ? kept.libraryId : DEFAULT_WREN_PREFS.libraryId,
    serverName: isServerNamePick(kept.serverName) ? kept.serverName : DEFAULT_WREN_PREFS.serverName,
  }
}

/** The version the prefs are kept at, the apps' own, so both read the same shape. */
const WREN_PREFS_VERSION = 1

/** Settings' themes, Home's order and Albums' cover size, persisted to localStorage and guarded when read. */
export const useWrenPrefs = create<WrenPrefs>()(
  persist(
    (set) => ({
      ...DEFAULT_WREN_PREFS,
      change: (change) => set(change),
    }),
    {
      name: WREN_PREFS_KEY,
      storage: createJSONStorage(() => window.localStorage),
      version: WREN_PREFS_VERSION,
      // Whatever an older version kept is read through the same guard.
      migrate: prefsOf,
      // What is kept is what is read back: every value, through the same guard.
      partialize: (state: WrenPrefs) => prefsOf(state),
      merge: (saved, current) => ({ ...current, ...prefsOf(saved) }),
    },
  ),
)

/** The theme choice Settings' Appearance keeps, read whole and redrawn only when a part of it changes. */
export const useThemeChoice = (): ThemeChoice => useWrenPrefs(useShallow(themeChoiceIn))

/** The name Wren shows for its server: the one given in Settings, else raven's own. */
export const useServerName = (): string =>
  useWrenPrefs((state) => state.serverName ?? STATUS_COPY.raven)
