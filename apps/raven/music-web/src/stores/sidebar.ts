import { isBoolean, isRecord } from '@raven/core'
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

/** Where this browser keeps whether the sidebar is folded to its icons. */
const SIDEBAR_STORE_KEY = 'wren.sidebar'

type Sidebar = {
  /** Whether the sidebar is down to its icons. */
  isCollapsed: boolean
  toggle: () => void
}

const SIDEBAR_VERSION = 1

/** Whether the sidebar is folded, kept across visits and guarded when read. */
export const useSidebar = create<Sidebar>()(
  persist(
    (set) => ({
      isCollapsed: false,
      toggle: () => set((current) => ({ isCollapsed: !current.isCollapsed })),
    }),
    {
      name: SIDEBAR_STORE_KEY,
      storage: createJSONStorage(() => window.localStorage),
      version: SIDEBAR_VERSION,
      partialize: ({ isCollapsed }) => ({ isCollapsed }),
      merge: (saved, current) => ({
        ...current,
        isCollapsed: isRecord(saved) && isBoolean(saved.isCollapsed) && saved.isCollapsed,
      }),
    },
  ),
)
