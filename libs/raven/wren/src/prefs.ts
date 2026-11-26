import { isRecord, oneOf } from '@raven/core'

import { isLibraryPick } from '@/library/wornLibrary'
import { DEFAULT_THEME_CHOICE, type ThemeChoice, themeChoiceOf } from '@/themes'

/** What makes an album recent on Home: when it was added, or when it came out. */
export const RECENT_SORTS = { added: 'added', release: 'release' } as const

export type RecentSort = (typeof RECENT_SORTS)[keyof typeof RECENT_SORTS]

export const isRecentSort = oneOf(Object.values(RECENT_SORTS))

/** How large Albums draws its covers, smallest first: each is a `--size-cover-*` token's width. */
export const COVER_SIZES = {
  extraSmall: 'extraSmall',
  small: 'small',
  medium: 'medium',
  large: 'large',
  extraLarge: 'extraLarge',
} as const

export type CoverSize = (typeof COVER_SIZES)[keyof typeof COVER_SIZES]

export const isCoverSize = oneOf(Object.values(COVER_SIZES))

/**
 * The key Wren's preferences are stored under: AsyncStorage's on the phone, localStorage's on the
 * web, where `index.html` reads it before first paint.
 */
export const WREN_PREFS_KEY = 'wren.prefs'

/**
 * What every Wren keeps of the listener's choices: the themes, Home's order, Albums' cover size
 * and the music library. The phone keeps its downloads' and cellular stream's beside these.
 */
export type WrenSharedPrefs = ThemeChoice & {
  /** The order of Home's albums. */
  homeSort: RecentSort
  /** How large Albums draws its covers. */
  coverSize: CoverSize
  /** The music library picked in Settings, by its id; null wears the server's first. */
  libraryId: number | null
}

/** A first run: Paper and Night by the device's scheme, Home's albums by when they were added, medium covers. */
export const DEFAULT_SHARED_PREFS: WrenSharedPrefs = {
  ...DEFAULT_THEME_CHOICE,
  homeSort: RECENT_SORTS.added,
  coverSize: COVER_SIZES.medium,
  libraryId: null,
}

/** What was read back, each shared preference kept only where it is one, the default otherwise. */
export const sharedPrefsOf = (saved: unknown): WrenSharedPrefs => {
  const kept = isRecord(saved) ? saved : {}
  return {
    ...themeChoiceOf(saved),
    homeSort: isRecentSort(kept.homeSort) ? kept.homeSort : DEFAULT_SHARED_PREFS.homeSort,
    coverSize: isCoverSize(kept.coverSize) ? kept.coverSize : DEFAULT_SHARED_PREFS.coverSize,
    libraryId: isLibraryPick(kept.libraryId) ? kept.libraryId : DEFAULT_SHARED_PREFS.libraryId,
  }
}

/** The version every Wren keeps its prefs at, so each reads the one shape. */
export const WREN_PREFS_VERSION = 1
