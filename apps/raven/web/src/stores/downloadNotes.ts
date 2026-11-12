import { create } from 'zustand'
import { createJSONStorage, devtools, persist } from 'zustand/middleware'
import { STORE_KEYS } from '@/stores/storage'

type DownloadNotesState = {
  /** Whether this browser has been told, and has answered, that it keeps no Dolby Vision only title. */
  hasSeenDolbyVision: boolean
  seeDolbyVision: () => void
}

/** What Download has explained once, kept across visits so it opens by itself the first time only. */
export const useDownloadNotes = create<DownloadNotesState>()(
  devtools(
    persist(
      (set): DownloadNotesState => ({
        hasSeenDolbyVision: false,
        seeDolbyVision: () => set({ hasSeenDolbyVision: true }),
      }),
      {
        name: STORE_KEYS.downloadNotes,
        storage: createJSONStorage(() => window.localStorage),
        partialize: ({ hasSeenDolbyVision }) => ({ hasSeenDolbyVision }),
      },
    ),
    { name: 'raven/downloadNotes' },
  ),
)
