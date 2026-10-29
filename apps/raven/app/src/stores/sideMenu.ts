import { isBoolean, isRecord } from '@raven/core'
import { create } from 'zustand'
import { type StateStorage, createJSONStorage, persist } from 'zustand/middleware'

/** The key the side menu's state is stored under. */
export const SIDE_MENU_KEY = 'raven-side-menu'

type SideMenu = {
  /** Whether a TV's side menu is down to its icons, as the web's collapses. */
  isCollapsed: boolean
  toggle: () => void
}

/** Holds the place of the storage until `configureSideMenu`, as the player prefs do. */
const UNCONFIGURED: StateStorage = {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
}

/** Whether what was read back folds the menu, open when it says nothing a menu can use. */
const isCollapsedIn = (saved: unknown): boolean =>
  isRecord(saved) && isBoolean(saved.isCollapsed) ? saved.isCollapsed : false

/**
 * Whether a TV's side menu is folded to its icons, kept on this device in AsyncStorage and
 * guarded when read, as the web keeps its own in local storage.
 */
export const useSideMenu = create<SideMenu>()(
  persist(
    (set) => ({
      isCollapsed: false,
      toggle: () => set((menu) => ({ isCollapsed: !menu.isCollapsed })),
    }),
    {
      name: SIDE_MENU_KEY,
      storage: createJSONStorage(() => UNCONFIGURED),
      skipHydration: true,
      partialize: ({ isCollapsed }) => ({ isCollapsed }),
      merge: (saved, current) => ({ ...current, isCollapsed: isCollapsedIn(saved) }),
    },
  ),
)

type ConfigureSideMenuProps = { storage: StateStorage }

/** Gives the menu's state its storage, AsyncStorage in the app, and reads it back from it. */
export const configureSideMenu = async ({ storage }: ConfigureSideMenuProps) => {
  useSideMenu.persist.setOptions({ storage: createJSONStorage(() => storage) })
  await useSideMenu.persist.rehydrate()
}
