import { create } from 'zustand'
import { createJSONStorage, devtools, persist } from 'zustand/middleware'

type SideMenu = {
  collapsed: boolean
  /** Whether the tip about the B shortcut has done its job. */
  tipSeen: boolean
  toggle: () => void
  dismissTip: () => void
}

/**
 * Whether the side menu is down to its icons, kept across visits. Using
 * the toggle, by key or by click, counts as having seen the tip about it.
 */
export const useSideMenu = create<SideMenu>()(
  devtools(
    persist(
      (set) => ({
        collapsed: false,
        tipSeen: false,
        toggle: () => set((current) => ({ collapsed: !current.collapsed, tipSeen: true })),
        dismissTip: () => set({ tipSeen: true }),
      }),
      {
        name: 'raven-side-menu',
        storage: createJSONStorage(() => window.localStorage),
        partialize: ({ collapsed, tipSeen }) => ({ collapsed, tipSeen }),
      },
    ),
    { name: 'raven/sideMenu' },
  ),
)
