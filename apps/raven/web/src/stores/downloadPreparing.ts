import { create } from 'zustand'
import { createJSONStorage, devtools, persist } from 'zustand/middleware'
import { STORE_KEYS } from '@/stores/storage'

type DownloadPreparing = {
  /**
   * How far along the server's copy of each download is, from 0 to 1, by `downloadId`. A browser
   * waits for a copy it can play before any byte comes; Raven keeps the original and has none.
   */
  progress: Readonly<Record<string, number>>
}

/** The server copies being made for downloads that wait on one, as their host reports them. */
export const useDownloadPreparing = create<DownloadPreparing>()(
  devtools(
    persist((): DownloadPreparing => ({ progress: {} }), {
      name: STORE_KEYS.downloadPreparing,
      storage: createJSONStorage(() => window.localStorage),
      partialize: () => ({}),
    }),
    { name: 'raven/downloadPreparing' },
  ),
)
