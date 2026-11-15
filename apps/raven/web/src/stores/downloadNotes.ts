import { create } from 'zustand'
import { keptInStorage, STORE_KEYS } from '@/stores/storage'

type DownloadNotesState = {
  /** Whether this browser has been told, and has answered, that it keeps no Dolby Vision only title. */
  hasSeenDolbyVision: boolean
  seeDolbyVision: () => void
}

/** What Download has explained once, kept across visits so it opens by itself the first time only. */
export const useDownloadNotes = create<DownloadNotesState>()(
  keptInStorage({
    key: STORE_KEYS.downloadNotes,
    name: 'raven/downloadNotes',
    state: (set) => ({
      hasSeenDolbyVision: false,
      seeDolbyVision: () => set({ hasSeenDolbyVision: true }),
    }),
    keep: ({ hasSeenDolbyVision }) => ({ hasSeenDolbyVision }),
  }),
)
