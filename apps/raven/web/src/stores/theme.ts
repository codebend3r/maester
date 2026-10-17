import { DEFAULT_THEME, type ThemeId, isThemeId } from '@raven/ui'
import { create } from 'zustand'

/** Where the choice is kept, as the bare id; index.html reads it before first paint. */
export const THEME_KEY = 'raven-theme'

const readTheme = (): ThemeId => {
  try {
    const saved = window.localStorage.getItem(THEME_KEY)
    return isThemeId(saved) ? saved : DEFAULT_THEME
  } catch {
    // Storage refused, as in a locked-down private window: the default it is.
    return DEFAULT_THEME
  }
}

/** Puts a theme on the page, and its ground on the browser's own chrome. */
export const applyTheme = (theme: ThemeId) => {
  const root = document.documentElement
  root.dataset.theme = theme
  const ground = getComputedStyle(root).getPropertyValue('--color-night').trim()
  if (ground) document.querySelector('meta[name="theme-color"]')?.setAttribute('content', ground)
}

type ThemeState = {
  theme: ThemeId
  /** Wears a theme at once and keeps it on this device. */
  pick: (theme: ThemeId) => void
}

/** The theme this device wears, kept across visits. */
export const useTheme = create<ThemeState>()((set) => ({
  theme: readTheme(),
  pick: (theme) => {
    try {
      window.localStorage.setItem(THEME_KEY, theme)
    } catch {
      // Storage refused: the theme still changes, for this visit only.
    }
    applyTheme(theme)
    set({ theme })
  },
}))

/**
 * Wears the saved theme, then follows a theme picked in another tab, which
 * the browser announces with a `storage` event. Returns the way to stop.
 */
export const followTheme = (): (() => void) => {
  applyTheme(useTheme.getState().theme)
  const onStorage = (event: StorageEvent) => {
    if (event.key !== THEME_KEY) return
    const theme = isThemeId(event.newValue) ? event.newValue : DEFAULT_THEME
    applyTheme(theme)
    useTheme.setState({ theme })
  }
  window.addEventListener('storage', onStorage)
  return () => window.removeEventListener('storage', onStorage)
}
