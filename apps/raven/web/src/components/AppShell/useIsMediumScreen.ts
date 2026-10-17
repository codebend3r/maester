import { useSyncExternalStore } from 'react'

/**
 * Under this width the side menu is down to its icons whatever the toggle
 * says. The stylesheet lays the menu out by the same `max-width: 64rem`, so
 * the two always agree.
 */
const MEDIUM_SCREEN = '(max-width: 64rem)'

const followScreen = (onChange: () => void) => {
  const query = window.matchMedia(MEDIUM_SCREEN)
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}

/** Whether the screen is too narrow for the open side menu, following it as the window resizes. */
export const useIsMediumScreen = (): boolean =>
  useSyncExternalStore(followScreen, () => window.matchMedia(MEDIUM_SCREEN).matches)
