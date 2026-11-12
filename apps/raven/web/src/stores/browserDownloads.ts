import { create } from 'zustand'
import { createJSONStorage, devtools, persist } from 'zustand/middleware'
import type { BrowserDownloads } from '@/browserDownloads/engine'
import { STORE_KEYS } from '@/stores/storage'

type BrowserDownloadsState = {
  /** The browser's own downloads, set once before the first render; null inside Raven or where the browser cannot keep any. */
  engine: BrowserDownloads | null
  /**
   * The account that last signed in here. With no server a session cannot be renewed, so its
   * downloads still show; a sign out forgets it, which hides them and keeps their files.
   */
  lastAccountId: string | null
  remember: (accountId: string) => void
  forget: () => void
}

export const useBrowserDownloads = create<BrowserDownloadsState>()(
  devtools(
    persist(
      (set): BrowserDownloadsState => ({
        engine: null,
        lastAccountId: null,
        remember: (lastAccountId) => set({ lastAccountId }),
        forget: () => set({ lastAccountId: null }),
      }),
      {
        name: STORE_KEYS.browserDownloads,
        storage: createJSONStorage(() => window.localStorage),
        partialize: ({ lastAccountId }) => ({ lastAccountId }),
      },
    ),
    { name: 'raven/browserDownloads' },
  ),
)
