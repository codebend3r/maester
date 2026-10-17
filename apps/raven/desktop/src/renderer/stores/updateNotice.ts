import { create } from 'zustand'

type UpdateNotice = {
  /** The newer version main announced, until See what's new or Dismiss; kept for the session only. */
  version: string | null
  announce: (version: string) => void
  /** Hides the Shell's update notice for the session, as its own Dismiss does. */
  hide: () => void
}

export const useUpdateNotice = create<UpdateNotice>()((set) => ({
  version: null,
  announce: (version) => set({ version }),
  hide: () => set({ version: null }),
}))
