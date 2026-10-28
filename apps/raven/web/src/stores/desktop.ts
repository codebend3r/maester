import { COMPUTER_NAMES, DESKTOP_PLATFORMS } from '@raven/core'
import { create } from 'zustand'
import { createJSONStorage, devtools, persist } from 'zustand/middleware'
import { STORE_KEYS } from '@/stores/storage'
import type { DesktopClient } from '@/desktop/client'
import type { MenuHub } from '@/desktop/menuHub'
import type { PlayerConnections } from '@/desktop/playerConnection'

/** Raven's ways to main: its client, the Playback menu's hub and the player connection. */
export type Desktop = { client: DesktopClient; menu: MenuHub; player: PlayerConnections }

type DesktopBridge = {
  /** Set once before the first render inside Raven; null in a browser. */
  desktop: Desktop | null
}

/** The page's bridge to Raven, which only the desktop app's own page has. */
export const useDesktopBridge = create<DesktopBridge>()(
  devtools(
    persist((): DesktopBridge => ({ desktop: null }), {
      name: STORE_KEYS.desktop,
      storage: createJSONStorage(() => window.localStorage),
      partialize: () => ({}),
    }),
    { name: 'raven/desktop' },
  ),
)

/** Whether the page runs inside Raven. */
export const useIsDesktop = (): boolean => useDesktopBridge((state) => state.desktop !== null)

/** What the copy calls the computer Raven runs on: "Mac", or "PC" on Windows. */
export const useComputerName = (): (typeof COMPUTER_NAMES)[keyof typeof COMPUTER_NAMES] =>
  useDesktopBridge(
    (state) => COMPUTER_NAMES[state.desktop?.client.platform ?? DESKTOP_PLATFORMS.mac],
  )

/** The bridge, for what renders only inside Raven. */
export const useDesktop = (): Desktop => {
  const desktop = useDesktopBridge((state) => state.desktop)
  if (desktop === null) throw new Error('useDesktop needs Raven, and there is none.')
  return desktop
}
