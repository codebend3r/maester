import { create } from 'zustand'
import { createJSONStorage, devtools, persist } from 'zustand/middleware'

/** The key that collapses or expands the side menu. */
export const SIDE_MENU_KEY = 'b'

type SideMenu = {
  collapsed: boolean
  /** Whether the tip about the B shortcut has done its job. */
  tipSeen: boolean
  /** Whether the group under Manage (Libraries, Streams and the rest) is folded away. */
  isManageFolded: boolean
  toggle: () => void
  dismissTip: () => void
  toggleManage: () => void
}

/**
 * Whether the side menu is down to its icons, and whether its Manage group
 * is folded away, kept across visits. Using the toggle, by key or by click,
 * counts as having seen the tip about it.
 */
export const useSideMenu = create<SideMenu>()(
  devtools(
    persist(
      (set) => ({
        collapsed: false,
        tipSeen: false,
        isManageFolded: false,
        toggle: () => set((current) => ({ collapsed: !current.collapsed, tipSeen: true })),
        dismissTip: () => set({ tipSeen: true }),
        toggleManage: () => set((current) => ({ isManageFolded: !current.isManageFolded })),
      }),
      {
        name: 'raven-side-menu',
        storage: createJSONStorage(() => window.localStorage),
        partialize: ({ collapsed, tipSeen, isManageFolded }) => ({
          collapsed,
          tipSeen,
          isManageFolded,
        }),
      },
    ),
    { name: 'raven/sideMenu' },
  ),
)
