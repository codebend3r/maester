import { isRecord } from '@raven/core'
import {
  APPEARANCES,
  type Appearance,
  COVER_SIZES,
  type CoverSize,
  RECENT_SORTS,
  type RecentSort,
  WREN_PREFS_KEY,
  isAppearance,
  isCoverSize,
  isRecentSort,
} from '@raven/wren'
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

/**
 * What this browser keeps of the listener's choices: the ones a browser has. The apps keep the
 * downloads' and the cellular stream's too, which the web has none of.
 */
type WrenPrefsValues = {
  /** Whether Wren follows the system's light or dark, or keeps one. */
  appearance: Appearance
  /** The order of Home's albums. */
  homeSort: RecentSort
  /** How large Albums draws its covers. */
  coverSize: CoverSize
}

type WrenPrefs = WrenPrefsValues & {
  /** Changes any of the preferences and keeps them in this browser. */
  change: (change: Partial<WrenPrefsValues>) => void
}

/** A first visit: the system's appearance, Home's albums by when they were added, medium covers. */
export const DEFAULT_WREN_PREFS: WrenPrefsValues = {
  appearance: APPEARANCES.system,
  homeSort: RECENT_SORTS.added,
  coverSize: COVER_SIZES.medium,
}

/** What was read back, each preference kept only where it is one, the default otherwise. */
const prefsOf = (saved: unknown): WrenPrefsValues => {
  const kept = isRecord(saved) ? saved : {}
  return {
    appearance: isAppearance(kept.appearance) ? kept.appearance : DEFAULT_WREN_PREFS.appearance,
    homeSort: isRecentSort(kept.homeSort) ? kept.homeSort : DEFAULT_WREN_PREFS.homeSort,
    coverSize: isCoverSize(kept.coverSize) ? kept.coverSize : DEFAULT_WREN_PREFS.coverSize,
  }
}

/** The version the prefs are kept at, the apps' own, so both read the same shape. */
const WREN_PREFS_VERSION = 1

/** Settings' appearance, Home's order and Albums' cover size, persisted to localStorage and guarded when read. */
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
      partialize: ({ appearance, homeSort, coverSize }) => ({ appearance, homeSort, coverSize }),
      merge: (saved, current) => ({ ...current, ...prefsOf(saved) }),
    },
  ),
)

/** Puts an appearance on the page: Light or Dark as `data-theme`, System as none, so the system's scheme shows. */
const applyAppearance = (appearance: Appearance): void => {
  const root = document.documentElement
  if (appearance === APPEARANCES.system) {
    delete root.dataset.theme
    return
  }
  root.dataset.theme = appearance
}

/** Wears the kept appearance, then follows every change of it. Returns the way to stop. */
export const followAppearance = (): (() => void) => {
  applyAppearance(useWrenPrefs.getState().appearance)
  return useWrenPrefs.subscribe((state) => applyAppearance(state.appearance))
}
