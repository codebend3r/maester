import { DESKTOP_REQUESTS, type DownloadAsk } from '@raven/core'
import { create } from 'zustand'
import { handled } from '@/desktop/handled'
import { useDesktopBridge } from '@/stores/desktop'

type DownloadAskState = {
  /** The ask main sent last; `instance` counts the asks shown, so one sent again opens a dialog of its own. */
  shown: { ask: DownloadAsk; instance: number } | null
  show: (ask: DownloadAsk) => void
  close: () => void
}

/** Tells main the page said no to an ask, or let it go unanswered, so main lets it go too. */
export const declineAsk = (ask: DownloadAsk): void => {
  const client = useDesktopBridge.getState().desktop?.client ?? null
  if (client === null) return
  handled(client.request({ type: DESKTOP_REQUESTS.declineDownload, askId: ask.askId }))
}

/**
 * The download ask Raven's dialog shows, from a reply or an event. A new ask replaces
 * one still shown, which is declined, as its dialog goes without answering.
 */
export const useDownloadAsk = create<DownloadAskState>()((set, get) => ({
  shown: null,
  show: (ask) => {
    const replaced = get().shown?.ask ?? null
    if (replaced !== null && replaced.askId !== ask.askId) declineAsk(replaced)
    set((last) => ({ shown: { ask, instance: (last.shown?.instance ?? 0) + 1 } }))
  },
  close: () => set({ shown: null }),
}))
