import { create } from 'zustand'
import type { DownloadAsk } from '@/shared/protocol'

type DownloadAskState = {
  /** The ask main sent last; `instance` counts the asks shown, so an ask sent again opens a dialog of its own. */
  shown: { ask: DownloadAsk; instance: number } | null
  show: (ask: DownloadAsk) => void
  close: () => void
}

/** The download ask the Shell's dialog shows, from a reply or an event. */
export const useDownloadAsk = create<DownloadAskState>()((set) => ({
  shown: null,
  show: (ask) => set((last) => ({ shown: { ask, instance: (last.shown?.instance ?? 0) + 1 } })),
  close: () => set({ shown: null }),
}))
