import { DESKTOP_REQUESTS, type DownloadAsk } from '@raven/core'
import { create } from 'zustand'
import { createJSONStorage, devtools, persist } from 'zustand/middleware'
import { STORE_KEYS } from '@/stores/storage'
import { handled } from '@/lib/handled'
import { useDownloadsHostStore } from '@/stores/downloadsHost'

type DownloadAskState = {
  /** The ask main sent last; `instance` counts the asks shown, so one sent again opens a dialog of its own. */
  shown: { ask: DownloadAsk; instance: number } | null
  show: (ask: DownloadAsk) => void
  close: () => void
}

/** Tells the host the page said no to an ask, or let it go unanswered, so the host lets it go too. */
export const declineAsk = (ask: DownloadAsk): void => {
  const { host } = useDownloadsHostStore.getState()
  if (host === null) return
  handled(host.request({ type: DESKTOP_REQUESTS.declineDownload, askId: ask.askId }))
}

/**
 * The download ask Raven's dialog shows, from a reply or an event. A new ask replaces
 * one still shown, which is declined, as its dialog goes without answering.
 */
export const useDownloadAsk = create<DownloadAskState>()(
  devtools(
    persist(
      (set, get) => ({
        shown: null,
        show: (ask) => {
          const replaced = get().shown?.ask ?? null
          if (replaced !== null && replaced.askId !== ask.askId) declineAsk(replaced)
          set((last) => ({ shown: { ask, instance: (last.shown?.instance ?? 0) + 1 } }))
        },
        close: () => set({ shown: null }),
      }),
      {
        name: STORE_KEYS.downloadAsk,
        storage: createJSONStorage(() => window.localStorage),
        partialize: ({ shown }) => ({ shown }),
      },
    ),
    { name: 'raven/downloadAsk' },
  ),
)
