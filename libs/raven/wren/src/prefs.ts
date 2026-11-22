import { oneOf } from '@raven/core'

/** How Wren picks its palette: the system's, or always light or dark. */
export const APPEARANCES = { system: 'system', light: 'light', dark: 'dark' } as const

export type Appearance = (typeof APPEARANCES)[keyof typeof APPEARANCES]

export const isAppearance = oneOf(Object.values(APPEARANCES))

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
