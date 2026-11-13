import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import type { DownloadsHost } from '@/downloads/host'

type DownloadsHostState = {
  /** Set once before the first render: Raven's, the browser's, or null where neither keeps downloads. */
  host: DownloadsHost | null
}

/** Who keeps this page's downloads. */
export const useDownloadsHostStore = create<DownloadsHostState>()(
  devtools((): DownloadsHostState => ({ host: null }), { name: 'raven/downloadsHost' }),
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
