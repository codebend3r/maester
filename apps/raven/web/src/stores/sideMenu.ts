import { create } from 'zustand'
import { keptInStorage, STORE_KEYS } from '@/stores/storage'

/** The key that collapses or expands the side menu. */
export const SIDE_MENU_KEY = 'b'

type SideMenu = {
  collapsed: boolean
  /** Whether the tip about the B shortcut has done its job. */
  tipSeen: boolean
  /**
   * Whether the group under Manage (Libraries, Streams and the rest) is
   * showing. It replaced `isManageFolded`, whose old default of open every
   * browser had saved, so a new name starts them all closed.
   */
  isManageOpen: boolean
  toggle: () => void
  dismissTip: () => void
  toggleManage: () => void
}

/**
 * Whether the side menu is down to its icons, and whether its Manage group
 * is showing, kept across visits. Using the toggle, by key or by click,
 * counts as having seen the tip about it.
 */
export const useSideMenu = create<SideMenu>()(
  keptInStorage({
    key: STORE_KEYS.sideMenu,
    name: 'raven/sideMenu',
    state: (set) => ({
      collapsed: false,
      tipSeen: false,
      isManageOpen: false,
      toggle: () => set((current) => ({ collapsed: !current.collapsed, tipSeen: true })),
      dismissTip: () => set({ tipSeen: true }),
      toggleManage: () => set((current) => ({ isManageOpen: !current.isManageOpen })),
    }),
    keep: ({ collapsed, tipSeen, isManageOpen }) => ({ collapsed, tipSeen, isManageOpen }),
  }),
)
