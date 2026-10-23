import { create } from 'zustand'
import { createJSONStorage, devtools, persist } from 'zustand/middleware'
import { STORE_KEYS, UNCONFIGURED_STORAGE } from '@/stores/storage'

type UnlockPrompt = {
  open: boolean
  ask: () => void
  close: () => void
}

/** Whether the PIN is being asked for: by a page refused for a locked library, or by an Unlock button. */
export const useUnlockPrompt = create<UnlockPrompt>()(
  devtools(
    persist(
      (set) => ({
        open: false,
        ask: () => set({ open: true }),
        close: () => set({ open: false }),
      }),
      {
        name: STORE_KEYS.unlockPrompt,
        storage: createJSONStorage(() => UNCONFIGURED_STORAGE),
        partialize: ({ open }) => ({ open }),
      },
    ),
    { name: 'raven/unlockPrompt' },
  ),
)
