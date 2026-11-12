import { create } from 'zustand'
import { createJSONStorage, devtools, persist } from 'zustand/middleware'
import type { DownloadsHost } from '@/downloads/host'
import { STORE_KEYS } from '@/stores/storage'

type DownloadsHostState = {
  /** Set once before the first render: Raven's, the browser's, or null where neither keeps downloads. */
  host: DownloadsHost | null
}

/** Who keeps this page's downloads. */
export const useDownloadsHostStore = create<DownloadsHostState>()(
  devtools(
    persist((): DownloadsHostState => ({ host: null }), {
      name: STORE_KEYS.downloadsHost,
      storage: createJSONStorage(() => window.localStorage),
      partialize: () => ({}),
    }),
    { name: 'raven/downloadsHost' },
  ),
)

/** The host, or null where this page keeps no downloads. */
export const useDownloadsHostOrNone = (): DownloadsHost | null =>
  useDownloadsHostStore((state) => state.host)

/** The host, for what renders only where downloads are kept. */
export const useDownloadsHost = (): DownloadsHost => {
  const host = useDownloadsHostOrNone()
  if (host === null) throw new Error('useDownloadsHost needs a downloads host, and there is none.')
  return host
}
