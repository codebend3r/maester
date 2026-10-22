import { create } from 'zustand'
import type { DesktopClient } from '@/desktop/client'
import type { MenuHub } from '@/desktop/menuHub'
import type { PlayerConnections } from '@/desktop/playerConnection'

/** raven player's ways to main: its client, the Playback menu's hub and the player connection. */
export type Desktop = { client: DesktopClient; menu: MenuHub; player: PlayerConnections }

type DesktopBridge = {
  /** Set once before the first render inside raven player; null in a browser. */
  desktop: Desktop | null
}

/** The page's bridge to raven player, which only the desktop app's own page has. */
export const useDesktopBridge = create<DesktopBridge>()(() => ({ desktop: null }))

/** Whether the page runs inside raven player. */
export const useIsDesktop = (): boolean => useDesktopBridge((state) => state.desktop !== null)

/** The bridge, for what renders only inside raven player. */
export const useDesktop = (): Desktop => {
  const desktop = useDesktopBridge((state) => state.desktop)
  if (desktop === null) throw new Error('useDesktop needs raven player, and there is none.')
  return desktop
}
