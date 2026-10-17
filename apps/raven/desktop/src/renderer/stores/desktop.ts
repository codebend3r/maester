import { create } from 'zustand'
import type { DesktopClient } from '@/renderer/desktop/client'
import type { MenuHub } from '@/renderer/desktop/menuHub'
import type { PlayerConnections } from '@/renderer/desktop/playerConnection'

type Desktop = { client: DesktopClient; menu: MenuHub; player: PlayerConnections }

type DesktopBridge = {
  /** The page's ways to main, set once before the first render; null until then. */
  desktop: Desktop | null
}

/** The page's bridge to main: its client, the Playback menu's hub and the player connection. */
export const useDesktopBridge = create<DesktopBridge>()(() => ({ desktop: null }))

export const useDesktop = (): Desktop => {
  const desktop = useDesktopBridge((state) => state.desktop)
  if (desktop === null) throw new Error('useDesktop needs the bridge set before the first render.')
  return desktop
}
