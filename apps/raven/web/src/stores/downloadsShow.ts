import { create } from 'zustand'
import { createJSONStorage, devtools, persist } from 'zustand/middleware'
import { STORE_KEYS } from '@/stores/storage'

/** How Downloads lays out what it holds: every download together, or under its library. */
export const DOWNLOADS_SHOWS = { everything: 'everything', byLibrary: 'byLibrary' } as const

export type DownloadsShow = (typeof DOWNLOADS_SHOWS)[keyof typeof DOWNLOADS_SHOWS]

export const isDownloadsShow = (value: unknown): value is DownloadsShow =>
  Object.values<unknown>(DOWNLOADS_SHOWS).includes(value)

type DownloadsShowState = {
  show: DownloadsShow
  setShow: (show: DownloadsShow) => void
}

/** The Show choice of Downloads, one for its Manage and Watch tabs, kept across visits. */
export const useDownloadsShow = create<DownloadsShowState>()(
  devtools(
    persist(
      (set): DownloadsShowState => ({
        show: DOWNLOADS_SHOWS.everything,
        setShow: (show) => set({ show }),
      }),
      {
        name: STORE_KEYS.downloadsShow,
        storage: createJSONStorage(() => window.localStorage),
        partialize: ({ show }) => ({ show }),
      },
    ),
    { name: 'raven/downloadsShow' },
  ),
)
