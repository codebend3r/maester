import { create } from 'zustand'

type UnlockPrompt = {
  open: boolean
  ask: () => void
  close: () => void
}

/** Whether the PIN is being asked for: by a page refused for a locked library, or by an Unlock button. */
export const useUnlockPrompt = create<UnlockPrompt>()((set) => ({
  open: false,
  ask: () => set({ open: true }),
  close: () => set({ open: false }),
}))
