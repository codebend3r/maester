import { isBoolean, isRecord } from '@raven/core'
import { create } from 'zustand'
import { type StateStorage, createJSONStorage, persist } from 'zustand/middleware'

/**
 * The key the side menu's state is stored under. It names the pin, not the fold an older app
 * kept, so every TV starts folded once and keeps only a pin chosen since.
 */
export const SIDE_MENU_KEY = 'raven-side-menu-pin'

/** How long the remote may be between two of the menu's rows before it counts as gone. */
const LEAVE_MS = 150

type SideMenu = {
  /** Whether the viewer keeps a TV's side menu open; folded to its icons otherwise. */
  isPinned: boolean
  /** Whether the remote is on one of the menu's rows, which opens a folded menu over the page. */
  hasFocus: boolean
  toggle: () => void
  /** The remote came onto a row. */
  enter: () => void
  /** The remote left a row; the menu folds unless it lands on another within `LEAVE_MS`. */
  leave: () => void
}

/** Holds the place of the storage until `configureSideMenu`, as the player prefs do. */
const UNCONFIGURED: StateStorage = {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
}

/** Whether what was read back pins the menu open, folded when it says nothing a menu can use. */
const isPinnedIn = (saved: unknown): boolean =>
  isRecord(saved) && isBoolean(saved.isPinned) ? saved.isPinned : false

// Moving between two rows is a leave then an enter; the wait keeps the menu from folding between.
let leaving: ReturnType<typeof setTimeout> | null = null

const stopLeaving = (): void => {
  if (leaving !== null) clearTimeout(leaving)
  leaving = null
}

/**
 * A TV's side menu: folded to its icons unless the viewer pins it open, kept on this device in
 * AsyncStorage and guarded when read, and open over the page while the remote is in it.
 */
export const useSideMenu = create<SideMenu>()(
  persist(
    (set) => ({
      isPinned: false,
      hasFocus: false,
      toggle: () => set((menu) => ({ isPinned: !menu.isPinned })),
      enter: () => {
        stopLeaving()
        set({ hasFocus: true })
      },
      leave: () => {
        stopLeaving()
        leaving = setTimeout(() => {
          leaving = null
          set({ hasFocus: false })
        }, LEAVE_MS)
      },
    }),
    {
      name: SIDE_MENU_KEY,
      storage: createJSONStorage(() => UNCONFIGURED),
      skipHydration: true,
      partialize: ({ isPinned }) => ({ isPinned }),
      merge: (saved, current) => ({ ...current, isPinned: isPinnedIn(saved) }),
    },
  ),
)

type MenuOpenProps = Pick<SideMenu, 'isPinned' | 'hasFocus'>

/** Whether the menu shows its labels: pinned open, or the remote in it. */
export const isMenuOpen = ({ isPinned, hasFocus }: MenuOpenProps): boolean => isPinned || hasFocus

type ConfigureSideMenuProps = { storage: StateStorage }

/** Gives the menu's state its storage, AsyncStorage in the app, and reads it back from it. */
export const configureSideMenu = async ({ storage }: ConfigureSideMenuProps) => {
  useSideMenu.persist.setOptions({ storage: createJSONStorage(() => storage) })
  await useSideMenu.persist.rehydrate()
}
